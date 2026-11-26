import mammoth from "mammoth";
import type { UploadKind } from "../security/upload-guard";

export const SCANNED_PDF_MIN_NON_WHITESPACE_CHARS = 40;

export type DocumentExtractionErrorCode =
  | "ENCRYPTED_PDF"
  | "CORRUPT_PDF"
  | "CORRUPT_DOCX"
  | "INVALID_TEXT_ENCODING";

export class DocumentExtractionError extends Error {
  readonly code: DocumentExtractionErrorCode;

  constructor(
    code: DocumentExtractionErrorCode,
    message: string,
    options?: { cause?: unknown }
  ) {
    super(message, options);
    this.name = "DocumentExtractionError";
    this.code = code;
  }
}

export type DocumentExtractionResult =
  | {
      status: "extracted";
      text: string;
      pageCount: number | null;
      parserVersion: string;
    }
  | {
      status: "scanned_pdf";
      text: "";
      pageCount: number;
      parserVersion: string;
    };

function normalizeExtractedText(raw: string): string {
  return raw
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function extractPdfText(buffer: Buffer): Promise<DocumentExtractionResult> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const parserVersion = `pdfjs-dist@${pdfjs.version ?? "unknown"}`;

  // pdfjs-dist v6 rejects Node Buffer instances; provide an independent Uint8Array copy.
  const data = Uint8Array.from(buffer);

  const loadingTask = pdfjs.getDocument({
    data,
    verbosity: 0,
    isEvalSupported: false,
    useSystemFonts: true,
    disableFontFace: true,
    useWorkerFetch: false,
    disableWorkerRendering: true,
    disableWorker: true,
  } as Parameters<typeof pdfjs.getDocument>[0] & { disableWorker?: boolean });

  try {
    const doc = await loadingTask.promise;
    const pageCount = doc.numPages;
    const pageTexts: string[] = [];

    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber++) {
      const page = await doc.getPage(pageNumber);
      try {
        const textContent = await page.getTextContent();
        const parts: string[] = [];
        for (const item of textContent.items) {
          if (!("str" in item)) continue;
          const textItem = item as { str: string; hasEOL?: boolean };
          parts.push(textItem.str);
          parts.push(textItem.hasEOL ? "\n" : " ");
        }
        const cleanedPage = normalizeExtractedText(
          parts.join("").replace(/ {2,}/g, " ")
        );
        if (cleanedPage) {
          pageTexts.push(cleanedPage);
        }
      } finally {
        page.cleanup();
      }
    }

    const combinedText = normalizeExtractedText(pageTexts.join("\n\n"));
    const nonWhitespaceCount = combinedText.replace(/\s+/g, "").length;

    if (
      pageCount >= 1 &&
      nonWhitespaceCount < SCANNED_PDF_MIN_NON_WHITESPACE_CHARS
    ) {
      return {
        status: "scanned_pdf",
        text: "",
        pageCount,
        parserVersion,
      };
    }

    return {
      status: "extracted",
      text: combinedText,
      pageCount,
      parserVersion,
    };
  } catch (err) {
    const errName = err instanceof Error ? err.name : "";
    const errMessage = err instanceof Error ? err.message.toLowerCase() : "";
    if (
      errName === "PasswordException" ||
      errMessage.includes("password")
    ) {
      throw new DocumentExtractionError(
        "ENCRYPTED_PDF",
        "Password-protected or encrypted PDFs cannot be extracted. Please provide an unencrypted text-based PDF or DOCX.",
        { cause: err }
      );
    }
    throw new DocumentExtractionError(
      "CORRUPT_PDF",
      "Could not extract text from PDF. The file may be corrupted or use an unsupported PDF structure.",
      { cause: err }
    );
  } finally {
    await loadingTask.destroy().catch(() => {
      // Ignore cleanup errors after completion or failure
    });
  }
}

async function extractDocxText(buffer: Buffer): Promise<DocumentExtractionResult> {
  try {
    const result = await mammoth.extractRawText({ buffer });
    const normalized = normalizeExtractedText(result.value ?? "");
    return {
      status: "extracted",
      text: normalized,
      pageCount: null,
      parserVersion: "mammoth@1.13.0",
    };
  } catch (err) {
    throw new DocumentExtractionError(
      "CORRUPT_DOCX",
      "Could not extract text from DOCX file. The document may be corrupted.",
      { cause: err }
    );
  }
}

function extractPlainText(
  buffer: Buffer,
  kind: "txt" | "md"
): DocumentExtractionResult {
  let decoded: string;
  try {
    decoded = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch (err) {
    throw new DocumentExtractionError(
      "INVALID_TEXT_ENCODING",
      "Text document is not valid UTF-8.",
      { cause: err }
    );
  }

  return {
    status: "extracted",
    text: normalizeExtractedText(decoded),
    pageCount: null,
    parserVersion: kind === "md" ? "utf8-markdown@1" : "utf8-text@1",
  };
}

/**
 * Extracts normalized plain text from a validated PDF, DOCX, TXT, or Markdown buffer.
 * Detects scanned/image-only PDFs rather than returning an empty extracted result.
 */
export async function extractDocumentText(
  buffer: Buffer,
  kind: UploadKind
): Promise<DocumentExtractionResult> {
  switch (kind) {
    case "pdf":
      return extractPdfText(buffer);
    case "docx":
      return extractDocxText(buffer);
    case "txt":
    case "md":
      return extractPlainText(buffer, kind);
  }
}
