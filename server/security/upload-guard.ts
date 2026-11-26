import zlib from "node:zlib";

export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024; // 15 MiB
export const MAX_DOCX_ENTRIES = 5_000;
export const MAX_DOCX_EXPANDED_BYTES = 50 * 1024 * 1024; // 50 MiB
export const MAX_DOCX_EXPANSION_RATIO = 100;

export type UploadKind = "pdf" | "docx" | "txt" | "md";

export type UploadValidationErrorCode =
  | "EMPTY_FILE"
  | "FILE_TOO_LARGE"
  | "UNSUPPORTED_FORMAT"
  | "MALFORMED_CONTAINER"
  | "PATH_TRAVERSAL"
  | "MACRO_ENABLED_REJECTED"
  | "ENCRYPTED_DOCUMENT"
  | "EXPANSION_LIMIT_EXCEEDED"
  | "INVALID_DOCX_STRUCTURE"
  | "INVALID_TEXT_ENCODING";

export class UploadValidationError extends Error {
  readonly code: UploadValidationErrorCode;
  readonly status: number;

  constructor(
    code: UploadValidationErrorCode,
    message: string,
    status = 400
  ) {
    super(message);
    this.name = "UploadValidationError";
    this.code = code;
    this.status = status;
  }
}

export interface ValidatedUpload {
  kind: UploadKind;
  mimeType: string;
  extension: string;
}

export interface UploadGuardOptions {
  fileName?: string;
  mimeType?: string;
}

const PDF_SIGNATURE = Buffer.from("%PDF-", "ascii");
const OLE2_SIGNATURE = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
const ZIP_LOCAL_FILE_HEADER_SIG = 0x04034b50;
const ZIP_CENTRAL_DIR_HEADER_SIG = 0x02014b50;
const ZIP_EOCD_SIG = 0x06054b50;
const ZIP64_EOCD_LOCATOR_SIG = 0x07064b50;

const ALLOWED_EXTENSIONS = new Set([".pdf", ".docx", ".txt", ".md", ".markdown"]);
// Disallow NUL and binary control characters while permitting TAB (0x09), LF (0x0A), CR (0x0D).
const BINARY_CONTROL_CHAR_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

function extractExtension(fileName?: string): string {
  if (!fileName) return "";
  const trimmed = fileName.trim();
  if (!trimmed) return "";
  const base = trimmed.split(/[\\/]/).pop() ?? "";
  const dotIdx = base.lastIndexOf(".");
  if (dotIdx <= 0 || dotIdx === base.length - 1) {
    return "";
  }
  return base.slice(dotIdx).toLowerCase();
}

function findEocdOffset(buffer: Buffer): number {
  const minOffset = Math.max(0, buffer.length - 22 - 65_535);
  for (let offset = buffer.length - 22; offset >= minOffset; offset--) {
    if (buffer.readUInt32LE(offset) === ZIP_EOCD_SIG) {
      const commentLength = buffer.readUInt16LE(offset + 20);
      if (offset + 22 + commentLength === buffer.length) {
        return offset;
      }
    }
  }
  return -1;
}

function assertSafeZipEntryName(entryName: string): string {
  if (!entryName || entryName.includes("\0")) {
    throw new UploadValidationError(
      "PATH_TRAVERSAL",
      "DOCX archive contains an invalid or null-byte entry path."
    );
  }
  if (
    entryName.startsWith("/") ||
    entryName.startsWith("\\") ||
    entryName.includes("\\") ||
    /^[A-Za-z]:/.test(entryName)
  ) {
    throw new UploadValidationError(
      "PATH_TRAVERSAL",
      "DOCX archive contains an unsafe absolute or backslash path."
    );
  }

  const normalized = entryName.endsWith("/") ? entryName.slice(0, -1) : entryName;
  const segments = normalized.split("/");
  if (segments.some((seg) => seg === ".." || seg === ".")) {
    throw new UploadValidationError(
      "PATH_TRAVERSAL",
      "DOCX archive contains a path traversal segment."
    );
  }

  return normalized;
}

function isMacroOrEncryptedEntry(entryName: string): "macro" | "encrypted" | null {
  const lower = entryName.toLowerCase();
  if (
    lower.endsWith(".docm") ||
    lower.includes("vbaproject.bin") ||
    lower.includes("vbadata.xml")
  ) {
    return "macro";
  }
  if (lower === "encryptioninfo" || lower === "encryptedpackage") {
    return "encrypted";
  }
  return null;
}

function validateDocxContainer(buffer: Buffer): void {
  if (buffer.length < 22 || buffer.readUInt32LE(0) !== ZIP_LOCAL_FILE_HEADER_SIG) {
    throw new UploadValidationError(
      "MALFORMED_CONTAINER",
      "DOCX file is not a valid ZIP container."
    );
  }

  const eocdOffset = findEocdOffset(buffer);
  if (eocdOffset < 0) {
    throw new UploadValidationError(
      "MALFORMED_CONTAINER",
      "DOCX archive is missing a valid ZIP end-of-central-directory record."
    );
  }

  if (
    eocdOffset >= 20 &&
    buffer.readUInt32LE(eocdOffset - 20) === ZIP64_EOCD_LOCATOR_SIG
  ) {
    throw new UploadValidationError(
      "MALFORMED_CONTAINER",
      "ZIP64 DOCX containers are not supported."
    );
  }

  const diskNumber = buffer.readUInt16LE(eocdOffset + 4);
  const cdStartDisk = buffer.readUInt16LE(eocdOffset + 6);
  const entriesOnDisk = buffer.readUInt16LE(eocdOffset + 8);
  const totalEntries = buffer.readUInt16LE(eocdOffset + 10);
  const cdSize = buffer.readUInt32LE(eocdOffset + 12);
  const cdOffset = buffer.readUInt32LE(eocdOffset + 16);

  if (
    diskNumber !== 0 ||
    cdStartDisk !== 0 ||
    entriesOnDisk !== totalEntries ||
    totalEntries === 0xffff ||
    cdSize === 0xffffffff ||
    cdOffset === 0xffffffff
  ) {
    throw new UploadValidationError(
      "MALFORMED_CONTAINER",
      "Multi-disk or ZIP64 DOCX archives are not supported."
    );
  }

  if (totalEntries > MAX_DOCX_ENTRIES) {
    throw new UploadValidationError(
      "EXPANSION_LIMIT_EXCEEDED",
      `DOCX archive exceeds the maximum of ${MAX_DOCX_ENTRIES} entries.`
    );
  }

  if (cdOffset > eocdOffset || cdOffset + cdSize > eocdOffset) {
    throw new UploadValidationError(
      "MALFORMED_CONTAINER",
      "DOCX central directory bounds are malformed."
    );
  }

  const maxAllowedExpanded = Math.min(
    MAX_DOCX_EXPANDED_BYTES,
    buffer.byteLength * MAX_DOCX_EXPANSION_RATIO
  );

  let cursor = cdOffset;
  let declaredTotalExpanded = 0;
  let actualTotalExpanded = 0;
  const seenPaths = new Set<string>();
  let contentTypesXml: string | null = null;
  let wordDocumentXml: string | null = null;

  for (let i = 0; i < totalEntries; i++) {
    if (cursor + 46 > cdOffset + cdSize) {
      throw new UploadValidationError(
        "MALFORMED_CONTAINER",
        "DOCX central directory entry is truncated."
      );
    }

    if (buffer.readUInt32LE(cursor) !== ZIP_CENTRAL_DIR_HEADER_SIG) {
      throw new UploadValidationError(
        "MALFORMED_CONTAINER",
        "DOCX central directory contains an invalid entry signature."
      );
    }

    const flags = buffer.readUInt16LE(cursor + 8);
    const method = buffer.readUInt16LE(cursor + 10);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const uncompressedSize = buffer.readUInt32LE(cursor + 24);
    const nameLen = buffer.readUInt16LE(cursor + 28);
    const extraLen = buffer.readUInt16LE(cursor + 30);
    const commentLen = buffer.readUInt16LE(cursor + 32);
    const localHeaderOffset = buffer.readUInt32LE(cursor + 42);

    const nextCursor = cursor + 46 + nameLen + extraLen + commentLen;
    if (nextCursor > cdOffset + cdSize) {
      throw new UploadValidationError(
        "MALFORMED_CONTAINER",
        "DOCX central directory entry exceeds central directory bounds."
      );
    }

    if ((flags & 0x0001) !== 0 || (flags & 0x0040) !== 0 || method === 99) {
      throw new UploadValidationError(
        "ENCRYPTED_DOCUMENT",
        "Encrypted DOCX archives cannot be inspected and are rejected."
      );
    }

    if (method !== 0 && method !== 8) {
      throw new UploadValidationError(
        "MALFORMED_CONTAINER",
        `Unsupported ZIP compression method (${method}) in DOCX archive.`
      );
    }

    const nameSlice = buffer.subarray(cursor + 46, cursor + 46 + nameLen);
    const rawName = (flags & 0x0800) !== 0
      ? nameSlice.toString("utf8")
      : nameSlice.toString("latin1");

    const normalizedPath = assertSafeZipEntryName(rawName);
    const lowerPath = normalizedPath.toLowerCase();
    if (seenPaths.has(lowerPath)) {
      throw new UploadValidationError(
        "MALFORMED_CONTAINER",
        "DOCX archive contains duplicate entry paths."
      );
    }
    seenPaths.add(lowerPath);

    const securityIssue = isMacroOrEncryptedEntry(normalizedPath);
    if (securityIssue === "macro") {
      throw new UploadValidationError(
        "MACRO_ENABLED_REJECTED",
        "Macro-enabled Word documents (.docm / vbaProject.bin) are rejected."
      );
    }
    if (securityIssue === "encrypted") {
      throw new UploadValidationError(
        "ENCRYPTED_DOCUMENT",
        "Encrypted Office documents cannot be inspected and are rejected."
      );
    }

    if (method === 0 && compressedSize !== uncompressedSize) {
      throw new UploadValidationError(
        "MALFORMED_CONTAINER",
        "Stored ZIP entry has mismatched compressed and uncompressed sizes."
      );
    }

    declaredTotalExpanded += uncompressedSize;
    if (declaredTotalExpanded > MAX_DOCX_EXPANDED_BYTES) {
      throw new UploadValidationError(
        "EXPANSION_LIMIT_EXCEEDED",
        "DOCX expanded content exceeds the 50 MiB limit."
      );
    }
    if (declaredTotalExpanded > buffer.byteLength * MAX_DOCX_EXPANSION_RATIO) {
      throw new UploadValidationError(
        "EXPANSION_LIMIT_EXCEEDED",
        "DOCX expansion ratio exceeds the maximum 100:1 limit."
      );
    }

    if (localHeaderOffset + 30 > cdOffset) {
      throw new UploadValidationError(
        "MALFORMED_CONTAINER",
        "DOCX local file header offset is out of bounds."
      );
    }
    if (buffer.readUInt32LE(localHeaderOffset) !== ZIP_LOCAL_FILE_HEADER_SIG) {
      throw new UploadValidationError(
        "MALFORMED_CONTAINER",
        "DOCX entry is missing a valid local file header."
      );
    }

    const localNameLen = buffer.readUInt16LE(localHeaderOffset + 26);
    const localExtraLen = buffer.readUInt16LE(localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + localNameLen + localExtraLen;
    const dataEnd = dataStart + compressedSize;

    if (dataEnd > cdOffset) {
      throw new UploadValidationError(
        "MALFORMED_CONTAINER",
        "DOCX compressed entry payload exceeds archive bounds."
      );
    }

    const remainingAllowed = maxAllowedExpanded - actualTotalExpanded;
    if (remainingAllowed < 0) {
      throw new UploadValidationError(
        "EXPANSION_LIMIT_EXCEEDED",
        "DOCX expanded content exceeds allowed limits."
      );
    }

    const payload = buffer.subarray(dataStart, dataEnd);
    let inflated: Buffer;
    if (method === 0) {
      if (payload.byteLength > remainingAllowed) {
        throw new UploadValidationError(
          "EXPANSION_LIMIT_EXCEEDED",
          "DOCX expanded content exceeds allowed limits."
        );
      }
      inflated = payload;
    } else {
      try {
        inflated = zlib.inflateRawSync(payload, {
          maxOutputLength: remainingAllowed,
        });
      } catch (err) {
        const nodeErr = err as NodeJS.ErrnoException;
        if (nodeErr.code === "ERR_BUFFER_TOO_LARGE") {
          throw new UploadValidationError(
            "EXPANSION_LIMIT_EXCEEDED",
            "DOCX archive exceeded expansion size or ratio limits."
          );
        }
        throw new UploadValidationError(
          "MALFORMED_CONTAINER",
          "DOCX archive contains corrupt compressed entry data."
        );
      }
    }

    if (inflated.byteLength !== uncompressedSize) {
      throw new UploadValidationError(
        "MALFORMED_CONTAINER",
        "DOCX entry size does not match its central directory metadata."
      );
    }

    actualTotalExpanded += inflated.byteLength;

    if (normalizedPath === "[Content_Types].xml") {
      contentTypesXml = inflated.toString("utf8");
    } else if (normalizedPath === "word/document.xml") {
      wordDocumentXml = inflated.toString("utf8");
    }

    cursor = nextCursor;
  }

  if (cursor !== cdOffset + cdSize) {
    throw new UploadValidationError(
      "MALFORMED_CONTAINER",
      "DOCX central directory size does not match parsed entries."
    );
  }

  if (!contentTypesXml || !wordDocumentXml) {
    throw new UploadValidationError(
      "INVALID_DOCX_STRUCTURE",
      "DOCX archive is missing required [Content_Types].xml or word/document.xml."
    );
  }

  const lowerContentTypes = contentTypesXml.toLowerCase();
  if (
    lowerContentTypes.includes("macroenabled") ||
    lowerContentTypes.includes("vbaproject")
  ) {
    throw new UploadValidationError(
      "MACRO_ENABLED_REJECTED",
      "Macro-enabled Word content types are rejected."
    );
  }

  if (!contentTypesXml.includes("<Types") || !wordDocumentXml.includes("<")) {
    throw new UploadValidationError(
      "INVALID_DOCX_STRUCTURE",
      "DOCX XML parts do not contain valid document markup."
    );
  }
}

function validateUtf8PlainText(buffer: Buffer): void {
  let decoded: string;
  try {
    decoded = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    throw new UploadValidationError(
      "INVALID_TEXT_ENCODING",
      "Plain text and Markdown uploads must be valid UTF-8."
    );
  }

  if (BINARY_CONTROL_CHAR_RE.test(decoded)) {
    throw new UploadValidationError(
      "INVALID_TEXT_ENCODING",
      "Text and Markdown uploads must not contain null bytes or binary control characters."
    );
  }
}

/**
 * Validates an uploaded resume/document buffer using size bounds, magic bytes,
 * ZIP/DOCX container inspection, and strict UTF-8 text checks.
 */
export function validateResumeUpload(
  buffer: Buffer,
  options: UploadGuardOptions = {}
): ValidatedUpload {
  if (!Buffer.isBuffer(buffer) || buffer.byteLength === 0) {
    throw new UploadValidationError("EMPTY_FILE", "Uploaded file is empty.", 400);
  }

  if (buffer.byteLength > MAX_UPLOAD_BYTES) {
    throw new UploadValidationError(
      "FILE_TOO_LARGE",
      "Uploaded file exceeds the 15 MiB maximum size.",
      413
    );
  }

  const ext = extractExtension(options.fileName);
  if (ext === ".docm") {
    throw new UploadValidationError(
      "MACRO_ENABLED_REJECTED",
      "Macro-enabled Word documents (.docm) are not allowed."
    );
  }
  if (ext && !ALLOWED_EXTENSIONS.has(ext)) {
    throw new UploadValidationError(
      "UNSUPPORTED_FORMAT",
      `Unsupported file extension '${ext}'. Supported formats: PDF, DOCX, TXT, Markdown.`
    );
  }

  if (
    buffer.byteLength >= PDF_SIGNATURE.byteLength &&
    buffer.subarray(0, PDF_SIGNATURE.byteLength).equals(PDF_SIGNATURE)
  ) {
    if (ext && ext !== ".pdf") {
      throw new UploadValidationError(
        "UNSUPPORTED_FORMAT",
        "File content is PDF, which does not match its declared file extension."
      );
    }
    return {
      kind: "pdf",
      mimeType: "application/pdf",
      extension: "pdf",
    };
  }

  if (
    buffer.byteLength >= OLE2_SIGNATURE.byteLength &&
    buffer.subarray(0, OLE2_SIGNATURE.byteLength).equals(OLE2_SIGNATURE)
  ) {
    throw new UploadValidationError(
      ext === ".docx" ? "ENCRYPTED_DOCUMENT" : "UNSUPPORTED_FORMAT",
      "Encrypted or legacy binary Office (.doc) files cannot be inspected. Please upload an unencrypted DOCX, text-based PDF, TXT, or Markdown file."
    );
  }

  if (buffer.byteLength >= 4) {
    const first4 = buffer.readUInt32LE(0);
    if (first4 === ZIP_LOCAL_FILE_HEADER_SIG) {
      if (ext && ext !== ".docx") {
        throw new UploadValidationError(
          "UNSUPPORTED_FORMAT",
          "File content is a ZIP/DOCX container, which does not match its declared file extension."
        );
      }
      validateDocxContainer(buffer);
      return {
        kind: "docx",
        mimeType:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        extension: "docx",
      };
    }
    if (first4 === ZIP_EOCD_SIG || first4 === 0x08074b50) {
      throw new UploadValidationError(
        "MALFORMED_CONTAINER",
        "Empty or spanned ZIP containers are not valid DOCX files."
      );
    }
  }

  if (ext === ".pdf" || ext === ".docx") {
    throw new UploadValidationError(
      "UNSUPPORTED_FORMAT",
      `File does not have a valid ${ext.slice(1).toUpperCase()} signature.`
    );
  }

  validateUtf8PlainText(buffer);

  const isMarkdown =
    ext === ".md" ||
    ext === ".markdown" ||
    options.mimeType?.trim().toLowerCase() === "text/markdown";

  return isMarkdown
    ? { kind: "md", mimeType: "text/markdown", extension: "md" }
    : { kind: "txt", mimeType: "text/plain", extension: "txt" };
}
