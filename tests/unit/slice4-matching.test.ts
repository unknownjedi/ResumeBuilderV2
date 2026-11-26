import { describe, expect, it } from "vitest";
import { createTestDatabase } from "@/server/db/client";
import { createSkill, updateEntityVerification } from "@/server/services/profile";
import { ingestManualJob } from "@/server/services/jobs";
import {
  addSearchProfileSkill,
  createSearchProfile,
} from "@/server/services/search-profiles";
import {
  analyzeJobWithBudget,
  runDeterministicJobAnalysis,
} from "@/server/ai/workflows/analyze-job";
import {
  computeJobMatch,
  updateJobRequirementOverride,
  upsertCompensationOverride,
} from "@/server/services/matching";
import { getOverviewData } from "@/server/services/overview";
import { updateSettings } from "@/server/services/settings";

describe("Slice 4 Search Profiles, Analysis & Matching", () => {
  it("validates ranking weights sum to 100%, compensation range, and independent profile skills", () => {
    const { db, sqlite } = createTestDatabase();
    try {
      expect(() =>
        createSearchProfile(
          {
            name: "Bad Weights",
            rankingWeights: {
              documentedFit: 50,
              searchSkillAlignment: 50,
              freshness: 10,
              locationWorkMode: 0,
              compensation: 0,
              companyIndustry: 0,
            },
          },
          db
        )
      ).toThrow();

      expect(() =>
        createSearchProfile(
          {
            name: "Bad Comp",
            minCompensation: 200000,
            targetCompensation: 150000,
            compensationCurrency: "USD",
            compensationPeriod: "year",
          },
          db
        )
      ).toThrow();

      const profile = createSearchProfile(
        {
          name: "Backend Systems",
          targetTitles: ["Backend Engineer", "Systems Engineer"],
          workplaceTypes: ["remote"],
          hardFilters: { workplaceTypesHard: true },
        },
        db
      );
      expect(profile.rankingWeights.documentedFit).toBe(45);

      const added = addSearchProfileSkill(
        profile.id,
        {
          displayLabel: "Kubernetes",
          aliases: ["k8s"],
          preference: "must_have",
        },
        db
      );
      expect(added.filterMode).toBe("weighted");
      expect(added.normalizedSkillKey).toBe("kubernetes");
    } finally {
      sqlite.close();
    }
  });

  it("uses verified career facts only, evaluates hard/weighted skills, renormalizes factors, and preserves overrides across re-analysis", async () => {
    const { db, sqlite } = createTestDatabase();
    try {
      const tsSkill = createSkill(
        { canonicalName: "TypeScript", verificationStatus: "needs_review" },
        db
      );
      const profile = createSearchProfile(
        {
          name: "Platform Engineer",
          targetTitles: ["Platform Engineer"],
          workplaceTypes: ["remote"],
          minCompensation: 150000,
          targetCompensation: 180000,
          compensationCurrency: "USD",
          compensationPeriod: "year",
        },
        db
      );
      addSearchProfileSkill(
        profile.id,
        { displayLabel: "TypeScript", preference: "must_have", filterMode: "weighted" },
        db
      );
      addSearchProfileSkill(
        profile.id,
        { displayLabel: "PHP", preference: "excluded", filterMode: "weighted" },
        db
      );

      const imported = await ingestManualJob(
        {
          title: "Senior Platform Engineer",
          companyName: "Signal Labs",
          locationText: "Remote",
          workplaceType: "remote",
          descriptionText: [
            "Requirements:",
            "- Must have TypeScript and SQLite production experience",
            "- Preferred experience with PHP legacy maintenance",
          ].join("\n"),
        },
        db,
        sqlite
      );
      const jobId = imported.job!.id;

      // Before analysis, overview runs in basic-relevance / pending mode cleanly
      const preOverview = getOverviewData({ searchProfileId: profile.id, db, sqlite });
      expect(preOverview.recommendations).toHaveLength(1);

      // Run deterministic baseline analysis (No-AI mode)
      const det = runDeterministicJobAnalysis(jobId, db, sqlite);
      expect(det.analysisStatus).toBe("deterministic");
      expect(det.requirementCount).toBeGreaterThanOrEqual(2);

      // Before TypeScript skill is verified, documentedFitScore must NOT credit needs_review skill
      const matchUnverified = computeJobMatch({
        jobId,
        searchProfileId: profile.id,
        db,
        sqlite,
      });
      const beforeFit = matchUnverified.documentedFitScore ?? 0;

      // Verify TypeScript skill -> documentedFitScore increases deterministically
      updateEntityVerification("skill", tsSkill.id, "verified", db);
      const matchVerified = computeJobMatch({
        jobId,
        searchProfileId: profile.id,
        db,
        sqlite,
      });
      expect(matchVerified.documentedFitScore ?? 0).toBeGreaterThan(beforeFit);

      // Weighted excluded skill (PHP) applies -25 penalty to searchSkillAlignmentScore (clamped 0..100)
      expect(matchVerified.searchSkillAlignmentScore).toBeLessThan(100);
      expect(matchVerified.searchSkillAlignmentScore).toBeGreaterThanOrEqual(0);

      // Add user compensation override and verify priority renormalization picks it up without mutating source salary
      const compRes = upsertCompensationOverride(
        {
          jobId,
          minAmount: 190000,
          maxAmount: 220000,
          currency: "USD",
          period: "year",
          note: "Recruiter confirmed",
        },
        db,
        sqlite
      );
      expect(compRes.override.provenance).toBe("user_supplied");

      // Record candidate override on a requirement and verify re-analysis marks unmatched overrides orphaned rather than silently deleting
      const reqId = matchVerified.evidence[0]?.jobRequirementId;
      expect(reqId).toBeTruthy();
      updateJobRequirementOverride(
        {
          jobId,
          requirementId: reqId!,
          candidateResponse: "candidate_confirms_does_not_have",
          userPriorityOverride: "preferred",
        },
        db,
        sqlite
      );

      // AI budget cap & deduplication test
      updateSettings(
        {
          ai: {
            provider: "custom",
            cliCommand: "node",
            cliArgsTemplate: "",
            model: "mock-model",
            dataSharingAccepted: true,
            actionAnalysisCap: 1,
            dailyAnalysisCap: 1,
          },
        },
        db
      );

      const aiRes = await analyzeJobWithBudget({
        jobIds: [jobId],
        mode: "ai_required",
        db,
        sqlite,
        generateStructured: async <T,>() => ({
          model: "mock-model",
          provider: "custom",
          latencyMs: 10,
          data: {
            roleTitle: "Senior Platform Engineer",
            locations: ["Remote"],
            workplaceType: "remote",
            requirements: [
              {
                id: "r1",
                text: "Build high-reliability Go microservices",
                normalizedSkill: "go",
                category: "skill",
                priority: "must_have",
                extractionConfidence: 0.95,
              },
            ],
            explicitConstraints: [],
            analysisVersion: "1.0.0",
          } as unknown as T,
        }),
      });
      expect(aiRes.aiAnalyzedJobIds).toHaveLength(1);

      // Second call on same description hash hits cache/dedup without burning another AI call!
      const cachedRes = await analyzeJobWithBudget({
        jobIds: [jobId],
        mode: "ai_required",
        db,
        sqlite,
        generateStructured: async () => {
          throw new Error("Should not invoke LLM on unchanged description hash");
        },
      });
      expect(cachedRes.deduplicatedJobIds).toHaveLength(1);

      // Old requirement override that didn't match new requirements is preserved as orphaned
      const orphaned = sqlite
        .prepare("SELECT COUNT(*) as c FROM job_requirements WHERE job_id = ? AND override_state = 'orphaned'")
        .get(jobId) as { c: number };
      expect(orphaned.c).toBe(1);

      const overviewAfter = getOverviewData({ searchProfileId: profile.id, db, sqlite });
      expect(overviewAfter.recommendations).toHaveLength(1);
      expect(overviewAfter.recommendations[0].salary?.source).toBe("user_supplied");
    } finally {
      sqlite.close();
    }
  });
});
