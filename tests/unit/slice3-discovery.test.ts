import { describe, expect, it } from "vitest";
import { createTestDatabase } from "@/server/db/client";
import { applications, searchProfiles } from "@/server/db/schema/index";
import { greenhouseConnector } from "@/server/connectors/greenhouse/index";
import { leverConnector } from "@/server/connectors/lever/index";
import { ashbyConnector } from "@/server/connectors/ashby/index";
import { genericCareersConnector } from "@/server/connectors/generic-careers/index";
import {
  isRestrictedAutomatedSourceUrl,
  parseManualJobImport,
} from "@/server/connectors/manual-import/index";
import { createSource, deleteSource } from "@/server/services/sources";
import {
  dismissDuplicateCandidate,
  getJobDetail,
  ingestManualJob,
  ingestSourceBatch,
  listDuplicateCandidates,
  mergeDuplicateCandidate,
  searchJobs,
  setUserJobState,
} from "@/server/services/jobs";

describe("Slice 3 Connectors, Ingestion, Closure & Deduplication", () => {
  it("normalizes Greenhouse, Lever, Ashby, Generic JSON-LD/RSS/Atom, and blocks LinkedIn/Naukri scraping", async () => {
    expect(isRestrictedAutomatedSourceUrl("https://www.linkedin.com/jobs/view/123")).toBe(true);
    expect(isRestrictedAutomatedSourceUrl("https://www.naukri.com/job-listings-abc")).toBe(true);
    expect(isRestrictedAutomatedSourceUrl("https://boards.greenhouse.io/acme/jobs/1")).toBe(false);

    const ghBatch = await greenhouseConnector.fetch({
      id: "src-gh",
      sourceType: "greenhouse",
      displayName: "Acme GH",
      sourceIdentifier: "acme",
      baseUrl: null,
      config: {},
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            jobs: [
              {
                id: 101,
                title: "Backend Engineer",
                updated_at: "2026-11-26T10:00:00Z",
                first_published: "2026-11-20T08:00:00Z",
                absolute_url: "https://boards.greenhouse.io/acme/jobs/101?utm_source=x",
                location: { name: "Remote - US" },
                content: "&lt;p&gt;Build &lt;script&gt;alert(1)&lt;/script&gt;SQLite services.&lt;/p&gt;",
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json", etag: '"v1"' } }
        ),
      lookup: (async () => [{ address: "104.18.0.1", family: 4 }]) as never,
    });
    expect(ghBatch.isCompleteSnapshot).toBe(true);
    const ghJobs = greenhouseConnector.normalize(ghBatch.jobs, {
      id: "src-gh",
      sourceType: "greenhouse",
      displayName: "Acme GH",
      sourceIdentifier: "acme",
      baseUrl: null,
      config: {},
    });
    expect(ghJobs).toHaveLength(1);
    expect(ghJobs[0].employerPostedAt).toBe("2026-11-20T08:00:00.000Z");
    expect(ghJobs[0].sourceUpdatedAt).toBe("2026-11-26T10:00:00.000Z");
    expect(ghJobs[0].descriptionHtmlSanitized).not.toContain("<script");
    expect(ghJobs[0].descriptionText).toContain("Build SQLite services.");

    let leverCall = 0;
    const leverBatch = await leverConnector.fetch({
      id: "src-lever",
      sourceType: "lever",
      displayName: "Acme Lever",
      sourceIdentifier: "acme",
      baseUrl: null,
      config: {},
      fetchImpl: async () => {
        leverCall += 1;
        if (leverCall === 1) {
          const page1 = Array.from({ length: 100 }, (_, i) => ({
            id: `lev-${i}`,
            text: `Role ${i}`,
            createdAt: 1795000000000,
            hostedUrl: `https://jobs.lever.co/acme/${i}`,
            descriptionPlain: "Backend work",
          }));
          return new Response(JSON.stringify(page1), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        return new Response("Rate limit", { status: 429 });
      },
      lookup: (async () => [{ address: "104.18.0.2", family: 4 }]) as never,
    });
    expect(leverBatch.isCompleteSnapshot).toBe(false);
    expect(leverBatch.jobs).toHaveLength(100);

    const ashbyNorm = ashbyConnector.normalize(
      [
        {
          id: "ash-1",
          title: "Platform Engineer",
          publishedAt: "2026-11-25T12:00:00Z",
          jobUrl: "https://jobs.ashbyhq.com/acme/ash-1",
          location: "New York",
          workplaceType: "Hybrid",
          descriptionPlain: "Build distributed APIs",
          compensation: {
            compensationTierSummary: "$180K – $220K • Equity",
            scrapeableCompensationSalarySummary: "$180K – $220K",
            summaryComponents: [
              {
                compensationType: "Salary",
                interval: "1 YEAR",
                currencyCode: "USD",
                minValue: 180000,
                maxValue: 220000,
              },
            ],
          },
        },
      ],
      {
        id: "src-ashby",
        sourceType: "ashby",
        displayName: "Acme Ashby",
        sourceIdentifier: "acme",
        baseUrl: null,
        config: {},
      }
    );
    expect(ashbyNorm[0].salaryMin).toBe(180000);
    expect(ashbyNorm[0].salaryMax).toBe(220000);
    expect(ashbyNorm[0].salaryCurrency).toBe("USD");
    expect(ashbyNorm[0].salaryPeriod).toBe("year");

    const jsonLdBatch = await genericCareersConnector.fetch({
      id: "src-gen",
      sourceType: "generic_career_page",
      displayName: "Generic JSON-LD",
      sourceIdentifier: null,
      baseUrl: "https://careers.example.com/jobs",
      config: {},
      fetchImpl: async () =>
        new Response(
          `<html><head><script type="application/ld+json">${JSON.stringify({
            "@context": "https://schema.org",
            "@type": "JobPosting",
            title: "Systems Engineer",
            hiringOrganization: { name: "Example Inc" },
            datePosted: "2026-11-24",
            url: "https://careers.example.com/jobs/sys-1",
            description: "<p>Write reliable TypeScript services.</p>",
          })}</script></head><body></body></html>`,
          { status: 200, headers: { "content-type": "text/html" } }
        ),
      lookup: (async () => [{ address: "93.184.216.34", family: 4 }]) as never,
    });
    expect(jsonLdBatch.jobs).toHaveLength(1);

    await expect(
      genericCareersConnector.fetch({
        id: "src-bad",
        sourceType: "generic_career_page",
        displayName: "Plain HTML",
        sourceIdentifier: null,
        baseUrl: "https://careers.example.com/custom",
        config: {},
        fetchImpl: async () =>
          new Response("<html><body><div>Open roles coming soon</div></body></html>", {
            status: 200,
            headers: { "content-type": "text/html" },
          }),
        lookup: (async () => [{ address: "93.184.216.34", family: 4 }]) as never,
      })
    ).rejects.toMatchObject({ code: "UNSUPPORTED_STRUCTURE" });

    await expect(
      parseManualJobImport({ url: "https://www.linkedin.com/jobs/view/999" })
    ).rejects.toMatchObject({ code: "RESTRICTED_SOURCE" });

    const manualLinkedIn = await parseManualJobImport({
      url: "https://www.linkedin.com/jobs/view/999",
      title: "Staff Engineer",
      companyName: "Orbital",
      descriptionText: "Pasted JD text for manual tracking.",
    });
    expect(manualLinkedIn.canonicalUrl).toBe("https://www.linkedin.com/jobs/view/999");
  });

  it("handles two-snapshot closure, reopening, FTS5 search, duplicate candidates, and transactional merge", async () => {
    const { db, sqlite } = createTestDatabase();
    try {
      const src = createSource(
        {
          sourceType: "greenhouse",
          displayName: "Northstar GH",
          sourceIdentifier: "northstar",
          refreshIntervalMinutes: 360,
          enabled: true,
        },
        db
      );

      const sourceMeta = {
        id: src.id,
        sourceType: "greenhouse" as const,
        displayName: "Northstar GH",
        companyId: src.companyId,
        refreshIntervalMinutes: 360,
        lastSuccessfulFullScanAt: null,
      };

      const t0 = new Date("2026-11-20T00:00:00.000Z");
      const firstIngest = ingestSourceBatch({
        db,
        sqlite,
        source: sourceMeta,
        now: t0,
        batch: {
          isCompleteSnapshot: true,
          fetchedAt: t0.toISOString(),
          jobs: [
            {
              externalId: "gh-1",
              title: "Senior Backend Engineer",
              companyName: "Northstar",
              descriptionText: "Build distributed SQLite pipelines in TypeScript.",
              descriptionHtmlSanitized: "<p>Build distributed SQLite pipelines in TypeScript.</p>",
              locationText: "Remote",
              countryCode: "US",
              workplaceType: "remote",
              employmentType: "full_time",
              employerPostedAt: "2026-11-19T10:00:00.000Z",
              canonicalUrl: "https://boards.greenhouse.io/northstar/jobs/1",
              applyUrl: "https://boards.greenhouse.io/northstar/jobs/1#app",
            },
          ],
        },
      });
      expect(firstIngest.newCount).toBe(1);
      const job1Id = firstIngest.touchedJobIds[0];

      // Missing from 1 complete snapshot -> possibly_closed
      const t1 = new Date("2026-11-20T06:00:00.000Z");
      ingestSourceBatch({
        db,
        sqlite,
        source: sourceMeta,
        now: t1,
        batch: { isCompleteSnapshot: true, fetchedAt: t1.toISOString(), jobs: [] },
      });
      expect(getJobDetail(job1Id, db)?.job.status).toBe("possibly_closed");

      // Missing from 2nd complete snapshot >= 360m later -> closed
      const t2 = new Date("2026-11-20T12:30:00.000Z");
      ingestSourceBatch({
        db,
        sqlite,
        source: sourceMeta,
        now: t2,
        batch: { isCompleteSnapshot: true, fetchedAt: t2.toISOString(), jobs: [] },
      });
      expect(getJobDetail(job1Id, db)?.job.status).toBe("closed");

      // Reappears -> reopened, preserving original firstSeenAt
      const t3 = new Date("2026-11-21T00:00:00.000Z");
      ingestSourceBatch({
        db,
        sqlite,
        source: sourceMeta,
        now: t3,
        batch: {
          isCompleteSnapshot: true,
          fetchedAt: t3.toISOString(),
          jobs: [
            {
              externalId: "gh-1",
              title: "Senior Backend Engineer",
              companyName: "Northstar",
              descriptionText: "Build distributed SQLite pipelines in TypeScript.",
              locationText: "Remote",
              countryCode: "US",
              workplaceType: "remote",
              employmentType: "full_time",
              employerPostedAt: "2026-11-19T10:00:00.000Z",
              canonicalUrl: "https://boards.greenhouse.io/northstar/jobs/1",
              applyUrl: "https://boards.greenhouse.io/northstar/jobs/1#app",
            },
          ],
        },
      });
      const reopened = getJobDetail(job1Id, db);
      expect(reopened?.job.status).toBe("open");
      expect(reopened?.job.firstSeenAt).toBe(t0.toISOString());

      // Manual import with identical company+title+location proposes a duplicate candidate
      const manualDup = await ingestManualJob(
        {
          title: "Senior Backend Engineer",
          companyName: "Northstar",
          locationText: "Remote",
          descriptionText: "Build distributed SQLite pipelines in TypeScript and Node.",
          url: "https://www.linkedin.com/jobs/view/5555",
        },
        db,
        sqlite
      );
      expect(manualDup.job).not.toBeNull();
      const dupJobId = manualDup.job!.id;
      expect(dupJobId).not.toBe(job1Id);
      const candidates = listDuplicateCandidates(db);
      expect(candidates.length).toBeGreaterThanOrEqual(1);

      const beforeSearch = searchJobs({ q: "SQLite" }, db, sqlite);
      expect(beforeSearch.items.length).toBe(2);

      const spId = "sp-1";
      db.insert(searchProfiles)
        .values({
          id: spId,
          name: "Backend",
          createdAt: t0.toISOString(),
          updatedAt: t0.toISOString(),
        })
        .run();
      setUserJobState({ jobId: job1Id, searchProfileId: spId, state: "dismissed", notes: "n1" }, db);
      setUserJobState({ jobId: dupJobId, searchProfileId: spId, state: "saved", notes: "n2" }, db);

      const merged = mergeDuplicateCandidate(candidates[0].id, { keepJobId: job1Id }, db);
      expect(merged.keepJobId).toBe(job1Id);
      const mergedDetail = getJobDetail(dupJobId, db, { searchProfileId: spId });
      expect(mergedDetail?.job.id).toBe(job1Id);
      expect(mergedDetail?.userJobState?.discoveryState).toBe("saved");

      const afterSearch = searchJobs({ q: "SQLite" }, db, sqlite);
      expect(afterSearch.items.length).toBe(1);

      const delRes = deleteSource(src.id, db);
      expect(delRes?.archived).toBe(true);
      expect(getJobDetail(job1Id, db)?.job.id).toBe(job1Id);

      // Verify abort on duplicate application conflict + dismissCandidate helper works
      const dup2 = await ingestManualJob(
        {
          title: "Staff Platform Engineer",
          companyName: "Helios",
          locationText: "Remote",
          descriptionText: "Rust and TypeScript platform engineering.",
          url: "https://helios.example/jobs/a",
        },
        db,
        sqlite
      );
      const dup3 = await ingestManualJob(
        {
          title: "Staff Platform Engineer",
          companyName: "Helios",
          locationText: "Remote",
          descriptionText: "Rust and TypeScript platform engineering.",
          url: "https://helios.example/jobs/b",
        },
        db,
        sqlite
      );
      const dup2Id = dup2.job!.id;
      const dup3Id = dup3.job!.id;
      const c2 = listDuplicateCandidates(db).find(
        (c) =>
          (c.jobAId === dup2Id && c.jobBId === dup3Id) ||
          (c.jobAId === dup3Id && c.jobBId === dup2Id)
      );
      expect(c2).toBeDefined();
      db.insert(applications)
        .values([
          { id: "app-a", jobId: dup2Id, searchProfileId: spId, status: "preparing", createdAt: t0.toISOString(), updatedAt: t0.toISOString() },
          { id: "app-b", jobId: dup3Id, searchProfileId: spId, status: "preparing", createdAt: t0.toISOString(), updatedAt: t0.toISOString() },
        ])
        .run();
      expect(() => mergeDuplicateCandidate(c2!.id, { keepJobId: dup2Id }, db)).toThrow();
      const dismissed = dismissDuplicateCandidate(c2!.id, db);
      expect(dismissed.state).toBe("dismissed");
    } finally {
      sqlite.close();
    }
  });
});
