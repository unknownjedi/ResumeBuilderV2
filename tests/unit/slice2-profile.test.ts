import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { describe, expect, it } from "vitest";
import { createTestDatabase } from "@/server/db/client";
import { validateResumeUpload } from "@/server/security/upload-guard";
import { extractDocumentText } from "@/server/documents/extract";
import { importResumeDocument } from "@/server/ai/workflows/parse-resume";
import { updateSettings } from "@/server/services/settings";
import {
  createExperience,
  createProject,
  createSkill,
  getFullCareerProfile,
  getSourceDocumentWithText,
  mergeSkills,
  updateEntityVerification,
  upsertProfile,
} from "@/server/services/profile";

function buildMinimalZip(entries: Array<{ name: string; content: Buffer }>): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, "utf8");
    const compressed = zlib.deflateRawSync(entry.content);
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(8, 8);
    localHeader.writeUInt32LE(0, 14);
    localHeader.writeUInt32LE(compressed.length, 18);
    localHeader.writeUInt32LE(entry.content.length, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28);

    localParts.push(localHeader, nameBuf, compressed);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(8, 10);
    centralHeader.writeUInt32LE(0, 16);
    centralHeader.writeUInt32LE(compressed.length, 20);
    centralHeader.writeUInt32LE(entry.content.length, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt32LE(offset, 42);

    centralParts.push(centralHeader, nameBuf);
    offset += localHeader.length + nameBuf.length + compressed.length;
  }

  const centralSize = centralParts.reduce((s, b) => s + b.length, 0);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(offset, 16);

  return Buffer.concat([...localParts, ...centralParts, eocd]);
}

describe("Slice 2 Career Profile & Document Import", () => {
  it("validates uploads by magic bytes and rejects macros/traversal/oversize", () => {
    expect(() =>
      validateResumeUpload(Buffer.alloc(0), { fileName: "empty.txt" })
    ).toThrow();

    expect(() =>
      validateResumeUpload(Buffer.from("NOT_A_PDF_HEADER"), {
        fileName: "resume.pdf",
      })
    ).toThrow();

    const macroDocx = buildMinimalZip([
      { name: "[Content_Types].xml", content: Buffer.from("<Types/>") },
      { name: "word/document.xml", content: Buffer.from("<w:document/>") },
      { name: "word/vbaProject.bin", content: Buffer.from("macro") },
    ]);
    expect(() =>
      validateResumeUpload(macroDocx, { fileName: "macro.docx" })
    ).toThrow();

    const validDocx = buildMinimalZip([
      { name: "[Content_Types].xml", content: Buffer.from("<Types/>") },
      { name: "word/document.xml", content: Buffer.from("<w:document/>") },
    ]);
    const checked = validateResumeUpload(validDocx, { fileName: "resume.docx" });
    expect(checked.kind).toBe("docx");

    const md = validateResumeUpload(
      Buffer.from("# Jane Doe\nBackend Engineer\n"),
      { fileName: "resume.md" }
    );
    expect(md.kind).toBe("md");
  });

  it("extracts text and detects scanned PDFs without crashing", async () => {
    const mdText = await extractDocumentText(
      Buffer.from("# Experience\r\nBuilt SQLite queue.\r\n"),
      "md"
    );
    expect(mdText.status).toBe("extracted");
    expect(mdText.text).toContain("Built SQLite queue.");

    const blankPdf = Buffer.from(
      "%PDF-1.4\n1 0 obj<< /Type /Catalog /Pages 2 0 R >>endobj\n2 0 obj<< /Type /Pages /Kids [3 0 R] /Count 1 >>endobj\n3 0 obj<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>endobj\nxref\n0 4\n0000000000 65535 f \n0000000009 00000 n \n0000000058 00000 n \n0000000115 00000 n \ntrailer<< /Size 4 /Root 1 0 R >>\nstartxref\n190\n%%EOF"
    );
    const pdfRes = await extractDocumentText(blankPdf, "pdf");
    expect(pdfRes.status).toBe("scanned_pdf");
  });

  it("imports resume in No-AI mode and AI mode while never auto-verifying extracted facts", async () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pjc-import-"));
    const prevAppData = process.env.APP_DATA_DIR;
    process.env.APP_DATA_DIR = tmpRoot;
    const { db, sqlite } = createTestDatabase();

    try {
      const noAiRes = await importResumeDocument(
        {
          fileName: "my-resume.md",
          buffer: Buffer.from(
            "# Alex Rivera\nSenior Backend Engineer at Northstar Labs (2022-2026)\nBuilt distributed SQLite worker queue.\n"
          ),
          useAi: false,
        },
        { db }
      );
      expect(noAiRes.extractionStatus).toBe("extracted");
      expect(noAiRes.aiStatus).toBe("raw_text_only");
      expect(noAiRes.extractedText).toContain("Northstar Labs");

      const loadedDoc = getSourceDocumentWithText(noAiRes.sourceDocument.id, db);
      expect(loadedDoc).not.toBeNull();
      expect(loadedDoc!.extractedText).toContain("Northstar Labs");

      updateSettings(
        {
          ai: {
            provider: "custom",
            cliCommand: "node",
            cliArgsTemplate: "",
            model: "mock-model",
            dataSharingAccepted: true,
          },
        },
        db
      );

      const aiRes = await importResumeDocument(
        {
          fileName: "my-resume-ai.txt",
          buffer: Buffer.from(
            "Alex Rivera\nExperience: Staff Engineer at Acme Systems (2021-2025). Reduced p99 latency by 42%.\nSkill: TypeScript\n"
          ),
          useAi: true,
        },
        {
          db,
          generateStructured: async <T,>() => ({
            model: "mock-model",
            provider: "custom",
            latencyMs: 12,
            data: {
              experiences: [
                {
                  employer: "Acme Systems",
                  title: "Staff Engineer",
                  startDate: "2021",
                  endDate: "2025",
                  isCurrent: false,
                  description: "Reduced p99 latency by 42%.",
                  skills: ["TypeScript"],
                  sourceExcerpt:
                    "Staff Engineer at Acme Systems (2021-2025). Reduced p99 latency by 42%.",
                  confidence: 0.94,
                },
              ],
              projects: [],
              achievements: [
                {
                  text: "Reduced p99 latency by 42%",
                  metricValue: 42,
                  metricUnit: "%",
                  skills: ["TypeScript"],
                  sourceExcerpt: "Reduced p99 latency by 42%.",
                  confidence: 0.91,
                },
              ],
              skills: [
                {
                  canonicalName: "TypeScript",
                  category: "Language",
                  sourceExcerpt: "Skill: TypeScript",
                  confidence: 0.99,
                },
              ],
              education: [],
              certifications: [],
              languages: [],
            } as unknown as T,
          }),
        }
      );

      expect(aiRes.aiStatus).toBe("extracted");
      expect(aiRes.createdCounts.experiences).toBe(1);
      expect(aiRes.createdCounts.achievements).toBe(1);

      const full = getFullCareerProfile(db, { includeRejected: true });
      expect(full.experiences).toHaveLength(1);
      expect(full.experiences[0].verificationStatus).toBe("needs_review");
      expect(full.evidenceLinks.length).toBeGreaterThanOrEqual(2);
      expect(full.needsReviewCount).toBeGreaterThanOrEqual(3);

      const verified = updateEntityVerification(
        "experience",
        full.experiences[0].id,
        "verified",
        db
      );
      expect((verified as { verificationStatus: string }).verificationStatus).toBe("verified");
    } finally {
      if (prevAppData === undefined) delete process.env.APP_DATA_DIR;
      else process.env.APP_DATA_DIR = prevAppData;
      sqlite.close();
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  it("supports full career profile CRUD, skill normalization, and skill merging", () => {
    const { db, sqlite } = createTestDatabase();
    try {
      const p = upsertProfile(
        { fullName: "Jordan Lee", headline: "Distributed Systems Engineer", location: "Remote" },
        db
      );
      expect(p.fullName).toBe("Jordan Lee");

      const ts1 = createSkill({ canonicalName: "TypeScript", verificationStatus: "verified" }, db);
      const ts2 = createSkill({ canonicalName: "TS Lang", verificationStatus: "verified" }, db);

      const exp = createExperience(
        {
          employer: "Beacon Corp",
          title: "Principal Engineer",
          skillIds: [ts2.id],
          verificationStatus: "verified",
        },
        db
      );
      const proj = createProject(
        {
          name: "Queue Engine",
          experienceId: exp.id,
          problem: "Duplicate background work",
          outcomes: "Zero duplicate runs",
          skillIds: [ts1.id],
          verificationStatus: "verified",
        },
        db
      );
      expect(proj.experienceId).toBe(exp.id);

      mergeSkills(ts2.id, ts1.id, db);
      const full = getFullCareerProfile(db);
      expect(full.skills).toHaveLength(1);
      expect(full.experiences[0].skills[0].id).toBe(ts1.id);
    } finally {
      sqlite.close();
    }
  });
});
