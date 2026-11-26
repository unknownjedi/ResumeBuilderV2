import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import mammoth from "mammoth";
import { afterEach, describe, expect, it } from "vitest";
import { createTestDatabase } from "@/server/db/client";
import {
  buildVerifiedFactCatalog,
  isSensitiveApplicationPrompt,
  validateStructuredResumeFactuality,
} from "@/server/ai/schemas/resume-generation";
import {
  createExperience,
  createProject,
  createSkill,
  getFullCareerProfile,
  updateEntityVerification,
  upsertProfile,
} from "@/server/services/profile";
import { ingestManualJob } from "@/server/services/jobs";
import { createSearchProfile } from "@/server/services/search-profiles";
import {
  createImmutableResumeVersion,
  createOrTailorResumeDraft,
  exportResumeDocument,
  getExportDownloadInfo,
  getResumeDraftDetail,
  updateResumeClaim,
  updateResumeDraft,
} from "@/server/services/resumes";
import {
  createOrPrepareApplication,
  generateAndSaveApplicationAnswers,
  generateAndSaveCoverLetter,
  transitionApplicationStatus,
} from "@/server/services/applications";

const tempDirs: string[] = [];

function makeTempDataDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pjc-slice5-unit-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir && fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

async function extractTextFromPdfBuffer(buffer: Buffer): Promise<string> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loadingTask = pdfjs.getDocument({
    data: Uint8Array.from(buffer),
    verbosity: 0,
    isEvalSupported: false,
    useSystemFonts: true,
    disableFontFace: true,
    useWorkerFetch: false,
    disableWorkerRendering: true,
    disableWorker: true,
  } as Parameters<typeof pdfjs.getDocument>[0] & { disableWorker?: boolean });
  const pdfDoc = await loadingTask.promise;
  try {
    const pages: string[] = [];
    for (let p = 1; p <= pdfDoc.numPages; p++) {
      const page = await pdfDoc.getPage(p);
      const tc = await page.getTextContent();
      const strings = tc.items
        .map((item) => ("str" in item && typeof item.str === "string" ? item.str : ""))
        .filter(Boolean);
      pages.push(strings.join(" "));
    }
    return pages.join("\n").trim();
  } finally {
    await pdfDoc.cleanup();
  }
}

describe("Slice 5 Resume Tailoring, Exports & Applications", () => {
  it("excludes unverified facts and rejects fabricated numeric claims in factuality validation", () => {
    const { db, sqlite } = createTestDatabase();
    try {
      upsertProfile(
        {
          fullName: "Avery Chen",
          email: "avery@example.com",
          headline: "Staff Systems Engineer",
          summary: "Built low-latency storage engines with 99.95% availability.",
          verificationStatus: "verified",
          origin: "manual",
        },
        db
      );

      const verifiedExp = createExperience(
        {
          employer: "Lattice Systems",
          title: "Principal Engineer",
          startDate: "2022-01",
          isCurrent: true,
          description: "Reduced query latency by 42% across 12 production shards.",
          verificationStatus: "verified",
          origin: "manual",
        },
        db
      );

      const unverifiedExp = createExperience(
        {
          employer: "Stealth Draft Co",
          title: "Advisor",
          description: "Helped seed stage roadmap.",
          verificationStatus: "needs_review",
          origin: "resume_import",
        },
        db
      );

      const skill = createSkill(
        {
          canonicalName: "TypeScript",
          verificationStatus: "verified",
          origin: "manual",
        },
        db
      );

      const full = getFullCareerProfile(db);
      const catalog = buildVerifiedFactCatalog(full);

      expect(catalog.byKey[`experience:${verifiedExp.id}`]).toBeDefined();
      expect(catalog.byKey[`skill:${skill.id}`]).toBeDefined();
      expect(catalog.byKey[`experience:${unverifiedExp.id}`]).toBeUndefined();

      // Valid document referencing verified fact and exact metric
      const validResult = validateStructuredResumeFactuality(
        {
          version: 1,
          header: {
            fullName: "Avery Chen",
            headline: "Staff Systems Engineer",
            email: "avery@example.com",
            phone: null,
            location: null,
            links: [],
          },
          sections: [
            {
              id: "sec-exp",
              type: "experience",
              title: "Experience",
              sortOrder: 0,
              summaryText: null,
              summaryClaimId: null,
              summaryEvidenceRefs: [],
              skillGroups: [],
              entries: [
                {
                  id: "entry-1",
                  heading: "Principal Engineer",
                  subheading: "Lattice Systems",
                  location: null,
                  dateRange: "2022-01 - Present",
                  sortOrder: 0,
                  bullets: [
                    {
                      id: "claim-1",
                      sectionId: "sec-exp",
                      stableEntryId: "entry-1",
                      text: "Reduced query latency by 42% across 12 production shards.",
                      sortOrder: 0,
                      userEditedState: "generated",
                      verificationStatus: "verified",
                      evidenceRefs: [
                        {
                          factType: "experience",
                          factId: verifiedExp.id,
                          excerpt: "Reduced query latency by 42%",
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
        catalog
      );
      expect(validResult.valid).toBe(true);
      expect(validResult.violations).toEqual([]);

      // Invalid document: uncited bullet + fabricated 85% / $10M metric + needs_review fact citation
      const invalidResult = validateStructuredResumeFactuality(
        {
          version: 1,
          header: {
            fullName: "Avery Chen",
            headline: null,
            email: null,
            phone: null,
            location: null,
            links: [],
          },
          sections: [
            {
              id: "sec-exp",
              type: "experience",
              title: "Experience",
              sortOrder: 0,
              summaryText: null,
              summaryClaimId: null,
              summaryEvidenceRefs: [],
              skillGroups: [],
              entries: [
                {
                  id: "entry-1",
                  heading: "Principal Engineer",
                  subheading: "Lattice Systems",
                  location: null,
                  dateRange: null,
                  sortOrder: 0,
                  bullets: [
                    {
                      id: "claim-uncited",
                      sectionId: "sec-exp",
                      stableEntryId: "entry-1",
                      text: "Built distributed consensus engine.",
                      sortOrder: 0,
                      userEditedState: "generated",
                      verificationStatus: "verified",
                      evidenceRefs: [],
                    },
                    {
                      id: "claim-fabricated-num",
                      sectionId: "sec-exp",
                      stableEntryId: "entry-1",
                      text: "Saved $10M and improved speed by 85% across 12 shards.",
                      sortOrder: 1,
                      userEditedState: "generated",
                      verificationStatus: "verified",
                      evidenceRefs: [
                        {
                          factType: "experience",
                          factId: verifiedExp.id,
                        },
                      ],
                    },
                    {
                      id: "claim-unverified-ref",
                      sectionId: "sec-exp",
                      stableEntryId: "entry-1",
                      text: "Advised Stealth Draft Co.",
                      sortOrder: 2,
                      userEditedState: "generated",
                      verificationStatus: "verified",
                      evidenceRefs: [
                        {
                          factType: "experience",
                          factId: unverifiedExp.id,
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
        catalog
      );

      expect(invalidResult.valid).toBe(false);
      expect(invalidResult.violations.length).toBeGreaterThanOrEqual(3);
    } finally {
      sqlite.close();
    }
  });

  it("blocks sensitive legal/work-auth/demographic questions from auto-answering", () => {
    expect(
      isSensitiveApplicationPrompt(
        "Are you legally authorized to work in the United States and will you require H-1B visa sponsorship?"
      ).sensitive
    ).toBe(true);
    expect(
      isSensitiveApplicationPrompt(
        "Please select your gender, race/ethnicity, and veteran status for EEO reporting."
      ).sensitive
    ).toBe(true);
    expect(
      isSensitiveApplicationPrompt(
        "Describe a distributed systems debugging challenge you led."
      ).sensitive
    ).toBe(false);
  });

  it("tailors draft, preserves claim IDs across reorder, versions immutably, exports DOCX & PDF, and freezes applied snapshots", async () => {
    const appDataDir = makeTempDataDir();
    const { db, sqlite } = createTestDatabase();
    try {
      upsertProfile(
        {
          fullName: "Jordan Patel",
          email: "jordan@example.com",
          location: "Seattle, WA",
          headline: "Senior Full-Stack Engineer",
          summary: "Built TypeScript and SQLite local-first applications.",
          verificationStatus: "verified",
          origin: "manual",
        },
        db
      );

      const exp = createExperience(
        {
          employer: "Northwind Labs",
          title: "Senior Software Engineer",
          startDate: "2021-04",
          isCurrent: true,
          description: "Architected Next.js and SQLite sync engine serving 15k weekly users.",
          verificationStatus: "verified",
          origin: "manual",
        },
        db
      );
      createProject(
        {
          name: "LocalDoc Engine",
          roleContribution: "Creator",
          description: "Deterministic DOCX and PDF rendering pipeline in Node.",
          verificationStatus: "verified",
          origin: "manual",
        },
        db
      );
      const tsSkill = createSkill(
        {
          canonicalName: "TypeScript",
          verificationStatus: "verified",
          origin: "manual",
        },
        db
      );
      updateEntityVerification("experience", exp.id, "verified", db);

      const searchProfile = createSearchProfile(
        { name: "Local-First Platform" },
        db
      );
      const ingested = await ingestManualJob(
        {
          title: "Staff Local-First Software Engineer",
          companyName: "Cascade Tools",
          applyUrl: "https://example.com/jobs/cascade-staff",
          descriptionText:
            "Requirements:\n- Deep TypeScript and SQLite experience.\n- Experience building document export pipelines.",
        },
        db
      );
      const job = ingested.job!;
      expect(job).toBeTruthy();

      const draft = await createOrTailorResumeDraft({
        jobId: job.id,
        searchProfileId: searchProfile.id,
        mode: "deterministic",
        db,
      });

      expect(draft.claims.length).toBeGreaterThanOrEqual(2);
      const expSection = draft.structuredContent.sections.find(
        (s) => s.type === "experience"
      );
      expect(expSection?.entries[0]?.bullets.length).toBeGreaterThanOrEqual(1);
      const originalClaimId = expSection!.entries[0]!.bullets[0]!.id;

      // Reorder sections & edit claim preserving stableClaimId
      const reorderedSections = [...draft.structuredContent.sections].reverse().map((s, idx) => ({
        ...s,
        sortOrder: idx,
      }));
      const afterReorder = updateResumeDraft(
        draft.id,
        {
          structuredContent: {
            ...draft.structuredContent,
            sections: reorderedSections,
          },
          templateSettings: { paperSize: "Letter" },
        },
        db
      );
      expect(afterReorder.templateSettings.paperSize).toBe("Letter");
      const preservedClaim = afterReorder.claims.find(
        (c) => c.stableClaimId === originalClaimId
      );
      expect(preservedClaim).toBeDefined();

      const editedClaimDraft = updateResumeClaim(
        {
          resumeDraftId: draft.id,
          claimId: originalClaimId,
          text: "Architected Next.js and SQLite sync engine for Cascade-scale reliability serving 15k weekly users.",
          userEditedState: "user_verified",
          evidenceRefs: [
            { factType: "experience", factId: exp.id },
            { factType: "skill", factId: tsSkill.id },
          ],
        },
        db
      );
      const updatedClaim = editedClaimDraft.claims.find(
        (c) => c.stableClaimId === originalClaimId
      );
      expect(updatedClaim?.userEditedState).toBe("user_verified");
      expect(updatedClaim?.evidence.length).toBe(2);

      // Immutable versions: v1, then edit -> v2, while v1 snapshot stays unchanged
      const v1 = createImmutableResumeVersion(draft.id, db);
      expect(v1.created).toBe(true);
      expect(v1.version.versionNumber).toBe(1);

      // Idempotent if nothing changed
      const v1Reuse = createImmutableResumeVersion(draft.id, db);
      expect(v1Reuse.created).toBe(false);
      expect(v1Reuse.version.versionNumber).toBe(1);

      // Export DOCX and verify readable text via mammoth
      const docxExport = await exportResumeDocument({
        resumeDraftId: draft.id,
        format: "docx",
        appDataDir,
        db,
      });
      const docxInfo = getExportDownloadInfo(docxExport.exportRecord.id, db, {
        appDataDir,
      });
      const docxBuf = fs.readFileSync(docxInfo.filePath);
      const docxText = await mammoth.extractRawText({ buffer: docxBuf });
      expect(docxText.value).toContain("Jordan Patel");
      expect(docxText.value).toContain("Cascade-scale reliability");

      // Export PDF via installed Playwright Chromium & verify text extraction via pdfjs-dist
      const browsersPath = path.join(
        os.homedir(),
        "Library/Application Support/PersonalJobCopilot/runtime/playwright-browsers"
      );
      if (fs.existsSync(browsersPath)) {
        process.env.PLAYWRIGHT_BROWSERS_PATH = browsersPath;
        const pdfExport = await exportResumeDocument({
          resumeDraftId: draft.id,
          format: "pdf",
          appDataDir,
          db,
        });
        const pdfInfo = getExportDownloadInfo(pdfExport.exportRecord.id, db, {
          appDataDir,
        });
        const pdfBuf = fs.readFileSync(pdfInfo.filePath);
        const extractedPdf = await extractTextFromPdfBuffer(pdfBuf);
        expect(extractedPdf).toContain("Jordan Patel");
        expect(extractedPdf).toContain("Northwind Labs");
      }

      // Edit draft again -> v2 must not mutate v1
      updateResumeClaim(
        {
          resumeDraftId: draft.id,
          claimId: originalClaimId,
          text: "Architected local-first SQLite sync engine serving 15k weekly users.",
          evidenceRefs: [{ factType: "experience", factId: exp.id }],
        },
        db
      );
      const v2 = createImmutableResumeVersion(draft.id, db);
      expect(v2.version.versionNumber).toBe(2);
      const refreshedDetail = getResumeDraftDetail(draft.id, db)!;
      const storedV1 = refreshedDetail.versions.find((v) => v.versionNumber === 1)!;
      expect(JSON.stringify(storedV1.structuredContent)).toContain(
        "Cascade-scale reliability"
      );

      // Applications, Cover Letter & Sensitive Answer withholding
      const app = createOrPrepareApplication(
        {
          jobId: job.id,
          searchProfileId: searchProfile.id,
          resumeVersionId: storedV1.id,
          originalApplyUrl: job.applyUrl,
        },
        db
      );
      expect(app.status).toBe("preparing");

      const letter = await generateAndSaveCoverLetter({
        jobId: job.id,
        searchProfileId: searchProfile.id,
        applicationId: app.id,
        mode: "deterministic",
        db,
      });
      expect(letter.structuredContent.paragraphs.length).toBeGreaterThan(0);

      const answers = await generateAndSaveApplicationAnswers({
        jobId: job.id,
        searchProfileId: searchProfile.id,
        applicationId: app.id,
        prompts: [
          {
            promptKey: "work_auth",
            promptText: "Will you now or in the future require visa sponsorship?",
          },
          {
            promptKey: "why_good_fit",
            promptText: "Why are you a strong fit for this role?",
          },
        ],
        mode: "deterministic",
        db,
      });
      const sensitiveAns = answers.items.find((a) => a.promptKey === "work_auth");
      const fitAns = answers.items.find((a) => a.promptKey === "why_good_fit");
      expect(sensitiveAns?.answerText).toBe("");
      expect(sensitiveAns?.requiresHumanInput).toBe(true);
      expect(fitAns?.answerText.length).toBeGreaterThan(10);

      // Cannot mark applied without confirmSubmission === true
      expect(() =>
        transitionApplicationStatus(
          {
            applicationId: app.id,
            newStatus: "applied",
            confirmSubmission: false,
          },
          db
        )
      ).toThrow(/confirmation/i);

      // Confirmed mark applied freezes submittedMaterialsSnapshot
      const applied = transitionApplicationStatus(
        {
          applicationId: app.id,
          newStatus: "applied",
          resumeVersionId: storedV1.id,
          confirmSubmission: true,
          note: "Submitted via company portal.",
        },
        db
      );
      expect(applied.status).toBe("applied");
      expect(applied.appliedAt).toBeTruthy();
      expect(applied.submittedMaterialsHash).toBeTruthy();
      expect(JSON.stringify(applied.submittedMaterialsSnapshot)).toContain(
        "Cascade-scale reliability"
      );
      expect(applied.events.some((e) => e.newStatus === "applied")).toBe(true);
    } finally {
      sqlite.close();
    }
  });
});
