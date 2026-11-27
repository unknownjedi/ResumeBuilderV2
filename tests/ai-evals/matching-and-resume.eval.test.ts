import { describe, expect, it } from "vitest";
import { createTestDatabase } from "@/server/db/client";
import {
  buildVerifiedFactCatalog,
  makeFactCatalogKey,
  validateStructuredResumeFactuality,
} from "@/server/ai/schemas/resume-generation";
import {
  expandSkillAliases,
  normalizeSkillTerm,
  runDeterministicJobAnalysis,
  textContainsSkillAlias,
} from "@/server/ai/workflows/analyze-job";
import { generateTailoredResume } from "@/server/ai/workflows/generate-materials";
import { jobRequirements, jobs } from "@/server/db/schema/jobs";
import { eq } from "drizzle-orm";
import { ingestManualJob } from "@/server/services/jobs";
import { computeJobMatch } from "@/server/services/matching";
import {
  createAchievement,
  createEducation,
  createExperience,
  createProject,
  createSkill,
  getFullCareerProfile,
  upsertProfile,
} from "@/server/services/profile";
import {
  addSearchProfileSkill,
  createSearchProfile,
} from "@/server/services/search-profiles";

interface SeedJobSpec {
  key: string;
  title: string;
  companyName: string;
  locationText: string;
  workplaceType: "remote" | "hybrid" | "onsite";
  salaryMin: number | null;
  salaryMax: number | null;
  employerPostedAt: string | null;
  mustSkills: string[];
  preferredSkills: string[];
  extraLines: string[];
}

interface SeedProfileSpec {
  id: string;
  fullName: string;
  headline: string;
  summary: string;
  location: string;
  targetTitles: string[];
  workplaceTypes: Array<"remote" | "hybrid" | "onsite">;
  minCompensation: number;
  targetCompensation: number;
  verifiedSkills: string[];
  unverifiedSkills: string[];
  experiences: Array<{
    employer: string;
    title: string;
    startDate: string;
    endDate?: string;
    isCurrent?: boolean;
    description: string;
  }>;
  unverifiedExperience: {
    employer: string;
    title: string;
    description: string;
  };
  project: {
    name: string;
    description: string;
    outcomes: string;
  };
  achievement: {
    text: string;
    metricValue: number;
    metricUnit: string;
    metricContext: string;
  };
  mustHaveSearchSkills: string[];
  preferredSearchSkills: string[];
  excludedSearchSkills: string[];
}

const REFERENCE_NOW = new Date("2026-11-20T12:00:00.000Z");

const DOMAIN_TEMPLATES: Array<{
  domain: string;
  titles: string[];
  companies: string[];
  mustPools: string[][];
  prefPools: string[][];
}> = [
  {
    domain: "Backend Systems",
    titles: [
      "Senior Backend Engineer",
      "Staff Distributed Systems Engineer",
      "Principal API Platform Engineer",
      "Backend Infrastructure Engineer",
      "Core Services Engineer",
    ],
    companies: ["Vortex Systems", "Northstar Data", "Kestrel Cloud", "Arbor Compute", "RelayWorks"],
    mustPools: [
      ["Go", "PostgreSQL", "Distributed Systems"],
      ["Rust", "gRPC", "Linux"],
      ["Go", "Kafka", "Redis"],
      ["PostgreSQL", "Microservices", "Docker"],
      ["Go", "Kubernetes", "PostgreSQL"],
    ],
    prefPools: [
      ["Redis", "Docker"],
      ["Kafka", "AWS"],
      ["PHP", "MySQL"],
      ["Terraform", "CI/CD"],
      ["Python", "gRPC"],
    ],
  },
  {
    domain: "Fullstack TypeScript",
    titles: [
      "Senior Full-Stack TypeScript Engineer",
      "Product Infrastructure Engineer",
      "Staff Web Platform Engineer",
      "Full-Stack Application Engineer",
      "Lead TypeScript Developer",
    ],
    companies: ["Canvas Studio", "Linearity Labs", "Harbor Apps", "Fieldnote Tech", "SignalGrid"],
    mustPools: [
      ["TypeScript", "React", "Next.js"],
      ["TypeScript", "Node.js", "PostgreSQL"],
      ["TypeScript", "SQLite", "Drizzle ORM"],
      ["React", "Node.js", "REST"],
      ["Next.js", "Tailwind CSS", "PostgreSQL"],
    ],
    prefPools: [
      ["Playwright", "Vitest"],
      ["Docker", "CI/CD"],
      ["Angular", "PHP"],
      ["GraphQL", "Redis"],
      ["Prisma", "AWS"],
    ],
  },
  {
    domain: "Cloud & SRE",
    titles: [
      "Senior Site Reliability Engineer",
      "Staff Cloud Platform Engineer",
      "Kubernetes Infrastructure Engineer",
      "DevOps Automation Engineer",
      "Cloud Reliability Architect",
    ],
    companies: ["Stratus Ops", "Mesa Cloud", "Beacon Infra", "Anchor Systems", "Summit Grid"],
    mustPools: [
      ["Kubernetes", "Terraform", "AWS"],
      ["Docker", "Linux", "CI/CD"],
      ["AWS", "Python", "Terraform"],
      ["GCP", "Kubernetes", "Go"],
      ["Azure", "Terraform", "Docker"],
    ],
    prefPools: [
      ["Ansible", "Linux"],
      ["PostgreSQL", "Redis"],
      ["Ruby on Rails", "MySQL"],
      ["Git", "Python"],
      ["Kafka", "Microservices"],
    ],
  },
  {
    domain: "Data Engineering",
    titles: [
      "Senior Data Engineer",
      "Staff Analytics Platform Engineer",
      "Streaming Data Engineer",
      "Data Infrastructure Engineer",
      "Lead Pipeline Engineer",
    ],
    companies: ["Quarry Analytics", "Riverbend Data", "MetricFlow", "Cascadia AI", "Lumen Warehousing"],
    mustPools: [
      ["Python", "SQL", "Spark"],
      ["Airflow", "dbt", "Snowflake"],
      ["Kafka", "Python", "PostgreSQL"],
      ["SQL", "Snowflake", "AWS"],
      ["Spark", "Kafka", "Docker"],
    ],
    prefPools: [
      ["Terraform", "CI/CD"],
      ["Cassandra", "Redis"],
      ["PHP", "Laravel"],
      ["Kubernetes", "Linux"],
      ["GCP", "dbt"],
    ],
  },
  {
    domain: "Machine Learning",
    titles: [
      "Senior Machine Learning Engineer",
      "Applied AI Systems Engineer",
      "LLM Platform Engineer",
      "ML Infrastructure Engineer",
      "Staff Inference Engineer",
    ],
    companies: ["TensorForge", "Aether Labs", "Helix ML", "Cortex Foundry", "Foundry AI"],
    mustPools: [
      ["Python", "PyTorch", "LLM"],
      ["Python", "Machine Learning", "FastAPI"],
      ["PyTorch", "Docker", "AWS"],
      ["TensorFlow", "Scikit-Learn", "Python"],
      ["LLM", "FastAPI", "PostgreSQL"],
    ],
    prefPools: [
      ["Kubernetes", "Linux"],
      ["Redis", "TypeScript"],
      ["Ruby", "PHP"],
      ["Spark", "SQL"],
      ["gRPC", "Go"],
    ],
  },
  {
    domain: "Frontend Engineering",
    titles: [
      "Senior Frontend Engineer",
      "Design Systems Engineer",
      "UI Architecture Engineer",
      "Lead React Engineer",
      "Frontend Performance Engineer",
    ],
    companies: ["Prism UI", "Craftwork Web", "Atelier Software", "Glasshouse Co", "FrameWorks"],
    mustPools: [
      ["TypeScript", "React", "CSS"],
      ["Next.js", "Tailwind CSS", "HTML"],
      ["JavaScript", "React", "GraphQL"],
      ["Vue.js", "TypeScript", "HTML"],
      ["Angular", "TypeScript", "CSS"],
    ],
    prefPools: [
      ["Playwright", "Jest"],
      ["Vitest", "CI/CD"],
      ["Cypress", "Node.js"],
      ["Svelte", "REST"],
      ["Docker", "Git"],
    ],
  },
  {
    domain: "Mobile Engineering",
    titles: [
      "Senior iOS Engineer",
      "Senior Android Engineer",
      "Staff Mobile Platform Engineer",
      "Cross-Platform Mobile Engineer",
      "Mobile Release Engineer",
    ],
    companies: ["PocketLabs", "Orbit Mobile", "TransitApp Co", "Pulse Devices", "Nomad Soft"],
    mustPools: [
      ["Swift", "REST", "CI/CD"],
      ["Kotlin", "GraphQL", "Git"],
      ["TypeScript", "React", "GraphQL"],
      ["Swift", "Kotlin", "REST"],
      ["Kotlin", "Docker", "CI/CD"],
    ],
    prefPools: [
      ["SQLite", "Python"],
      ["Playwright", "Jest"],
      ["PHP", "Angular"],
      ["Firebase", "AWS"],
      ["Linux", "Git"],
    ],
  },
  {
    domain: "Enterprise JVM & .NET",
    titles: [
      "Senior Java Backend Engineer",
      "Spring Boot Platform Engineer",
      "Principal .NET Engineer",
      "Enterprise Integration Engineer",
      "Financial Systems Engineer",
    ],
    companies: ["Meridian FinTech", "LedgerCore", "ClearVault", "Silverline BankTech", "TrustBridge"],
    mustPools: [
      ["Java", "Spring Boot", "PostgreSQL"],
      ["Java", "Kafka", "Microservices"],
      ["C#", ".NET", "SQL"],
      ["Java", "Kubernetes", "Docker"],
      ["Scala", "Kafka", "Cassandra"],
    ],
    prefPools: [
      ["Redis", "REST"],
      ["RabbitMQ", "AWS"],
      ["Elasticsearch", "Linux"],
      ["Azure", "CI/CD"],
      ["MySQL", "Git"],
    ],
  },
  {
    domain: "Security Engineering",
    titles: [
      "Senior Application Security Engineer",
      "Cloud Security Engineer",
      "Platform Security Architect",
      "Detection & Response Engineer",
      "Infrastructure Security Engineer",
    ],
    companies: ["Bastion Security", "ZeroTrust Corp", "Keystone Defense", "Sentinel Ops", "Aegis Cloud"],
    mustPools: [
      ["Python", "AWS", "Linux"],
      ["Go", "Kubernetes", "Docker"],
      ["Terraform", "AWS", "CI/CD"],
      ["TypeScript", "Node.js", "PostgreSQL"],
      ["Rust", "Linux", "C++"],
    ],
    prefPools: [
      ["Git", "REST"],
      ["GCP", "Python"],
      ["PHP", "Ruby"],
      ["Elasticsearch", "Kafka"],
      ["Docker", "Ansible"],
    ],
  },
  {
    domain: "QA & Test Automation",
    titles: [
      "Senior SDET",
      "Quality Infrastructure Engineer",
      "Test Automation Lead",
      "Release Quality Engineer",
      "End-to-End Testing Architect",
    ],
    companies: ["Veritas QA", "GreenCheck", "ShipSafe Labs", "SpecRunner", "Assertive Inc"],
    mustPools: [
      ["TypeScript", "Playwright", "CI/CD"],
      ["Vitest", "Jest", "Node.js"],
      ["Cypress", "JavaScript", "Docker"],
      ["Python", "Pytest", "Linux"],
      ["Playwright", "Docker", "PostgreSQL"],
    ],
    prefPools: [
      ["React", "Next.js"],
      ["AWS", "Git"],
      ["Ruby on Rails", "PHP"],
      ["SQLite", "REST"],
      ["Kubernetes", "Python"],
    ],
  },
];

function build50RealisticJobs(): SeedJobSpec[] {
  const specs: SeedJobSpec[] = [];
  const workplaces: Array<"remote" | "hybrid" | "onsite"> = ["remote", "hybrid", "onsite"];
  const locations = [
    "Remote, US",
    "San Francisco, CA",
    "New York, NY",
    "Seattle, WA",
    "Austin, TX",
    "London, UK",
  ];

  let idx = 0;
  for (const group of DOMAIN_TEMPLATES) {
    for (let i = 0; i < 5; i++) {
      const workplaceType = workplaces[(idx + i) % workplaces.length];
      const hasSalary = idx % 4 !== 3;
      const baseSalary = 135_000 + ((idx * 7_500) % 90_000);
      const daysAgo = (idx * 2) % 18;
      const postedDate =
        idx % 7 === 0
          ? null
          : new Date(REFERENCE_NOW.getTime() - daysAgo * 86_400_000).toISOString();

      const mustSkills = group.mustPools[i];
      const preferredSkills = group.prefPools[i];

      specs.push({
        key: `jd-${idx + 1}`,
        title: group.titles[i],
        companyName: group.companies[i],
        locationText: workplaceType === "remote" ? "Remote, US" : locations[(idx + 1) % locations.length],
        workplaceType,
        salaryMin: hasSalary ? baseSalary : null,
        salaryMax: hasSalary ? baseSalary + 35_000 : null,
        employerPostedAt: postedDate,
        mustSkills,
        preferredSkills,
        extraLines: [
          `- Required: Production experience with ${mustSkills[0]} and ${mustSkills[1]}`,
          `- Required: Strong fundamentals in ${mustSkills[2]} and system reliability`,
          `- Preferred: Hands-on background with ${preferredSkills[0]} and ${preferredSkills[1]}`,
          `- Collaborate closely with engineering teams on scalable delivery`,
        ],
      });
      idx++;
    }
  }
  return specs;
}

function build20CandidateProfiles(): SeedProfileSpec[] {
  const rawProfiles: Array<{
    fullName: string;
    headline: string;
    location: string;
    workplaceTypes: Array<"remote" | "hybrid" | "onsite">;
    targetTitles: string[];
    verifiedSkills: string[];
    unverifiedSkills: string[];
    mustSearch: string[];
    prefSearch: string[];
    excludedSearch: string[];
    employer1: string;
    role1: string;
    metric1: string;
    employer2: string;
    role2: string;
    projectName: string;
  }> = [
    {
      fullName: "Elena Vance",
      headline: "Staff Backend Systems Engineer",
      location: "San Francisco, CA",
      workplaceTypes: ["remote", "hybrid"],
      targetTitles: ["Senior Backend Engineer", "Staff Distributed Systems Engineer"],
      verifiedSkills: ["Go", "PostgreSQL", "Distributed Systems", "Kafka", "Redis", "Docker"],
      unverifiedSkills: ["Rust", "Terraform"],
      mustSearch: ["Go", "PostgreSQL"],
      prefSearch: ["Kafka", "Redis"],
      excludedSearch: ["PHP", "Angular"],
      employer1: "Nimbus Core",
      role1: "Staff Backend Engineer",
      metric1: "Reduced tail p99 query latency by 38% across 16 Go microservices.",
      employer2: "Clearstream Labs",
      role2: "Senior Systems Engineer",
      projectName: "ShardRouter Engine",
    },
    {
      fullName: "Marcus Sterling",
      headline: "Principal Full-Stack TypeScript Engineer",
      location: "New York, NY",
      workplaceTypes: ["remote"],
      targetTitles: ["Senior Full-Stack TypeScript Engineer", "Staff Web Platform Engineer"],
      verifiedSkills: ["TypeScript", "React", "Next.js", "Node.js", "PostgreSQL", "SQLite"],
      unverifiedSkills: ["Drizzle ORM", "GraphQL"],
      mustSearch: ["TypeScript", "React"],
      prefSearch: ["Next.js", "PostgreSQL"],
      excludedSearch: ["PHP", "Ruby on Rails"],
      employer1: "Mosaic Software",
      role1: "Principal Full-Stack Engineer",
      metric1: "Delivered Next.js workspace cutting build times by 44% across 120 modules.",
      employer2: "Harbor Financial",
      role2: "Senior Web Engineer",
      projectName: "LocalSync Studio",
    },
    {
      fullName: "Priya Natarajan",
      headline: "Senior Site Reliability & Cloud Engineer",
      location: "Seattle, WA",
      workplaceTypes: ["remote", "hybrid"],
      targetTitles: ["Senior Site Reliability Engineer", "Staff Cloud Platform Engineer"],
      verifiedSkills: ["Kubernetes", "Terraform", "AWS", "Docker", "Linux", "CI/CD"],
      unverifiedSkills: ["GCP", "Ansible"],
      mustSearch: ["Kubernetes", "Terraform"],
      prefSearch: ["AWS", "Docker"],
      excludedSearch: ["Ruby on Rails", "PHP"],
      employer1: "Cascade Cloud",
      role1: "Senior SRE",
      metric1: "Automated multi-region Kubernetes failover achieving 99.99% uptime across 24 clusters.",
      employer2: "Northwind Ops",
      role2: "Infrastructure Engineer",
      projectName: "ZeroDowntime Provisioner",
    },
    {
      fullName: "Daniel Okafor",
      headline: "Staff Data Platform Engineer",
      location: "Austin, TX",
      workplaceTypes: ["remote", "onsite"],
      targetTitles: ["Senior Data Engineer", "Staff Analytics Platform Engineer"],
      verifiedSkills: ["Python", "SQL", "Spark", "Airflow", "dbt", "Snowflake"],
      unverifiedSkills: ["Kafka", "Cassandra"],
      mustSearch: ["Python", "SQL"],
      prefSearch: ["Spark", "Snowflake"],
      excludedSearch: ["PHP", "Cypress"],
      employer1: "DeltaMetrics",
      role1: "Staff Data Engineer",
      metric1: "Scaled daily Spark ETL pipelines processing 14 TB with 41% lower compute cost.",
      employer2: "Pulse Commerce",
      role2: "Data Engineer",
      projectName: "StreamWarehouse Core",
    },
    {
      fullName: "Sofia Alvarez",
      headline: "Applied Machine Learning Engineer",
      location: "San Francisco, CA",
      workplaceTypes: ["hybrid", "remote"],
      targetTitles: ["Senior Machine Learning Engineer", "LLM Platform Engineer"],
      verifiedSkills: ["Python", "PyTorch", "LLM", "FastAPI", "Machine Learning", "Docker"],
      unverifiedSkills: ["TensorFlow", "Scikit-Learn"],
      mustSearch: ["Python", "PyTorch"],
      prefSearch: ["LLM", "FastAPI"],
      excludedSearch: ["PHP", "Ruby"],
      employer1: "Cognition Foundry",
      role1: "Senior ML Engineer",
      metric1: "Reduced transformer inference latency by 52% for 8 production model endpoints.",
      employer2: "Signal Vision",
      role2: "ML Scientist",
      projectName: "GroundedEval Suite",
    },
    {
      fullName: "Lucas Lindqvist",
      headline: "Senior Frontend Architecture Engineer",
      location: "Remote, US",
      workplaceTypes: ["remote"],
      targetTitles: ["Senior Frontend Engineer", "Design Systems Engineer"],
      verifiedSkills: ["TypeScript", "React", "Next.js", "HTML", "CSS", "Tailwind CSS"],
      unverifiedSkills: ["Vue.js", "Svelte"],
      mustSearch: ["TypeScript", "React"],
      prefSearch: ["Tailwind CSS", "Playwright"],
      excludedSearch: ["Angular", "Cypress"],
      employer1: "Atelier Digital",
      role1: "Senior Frontend Engineer",
      metric1: "Built accessible component library improving Lighthouse score from 74 to 99.",
      employer2: "Brightline Media",
      role2: "UI Engineer",
      projectName: "TokenKit UI",
    },
    {
      fullName: "Hannah Cho",
      headline: "Mobile Platform Engineer",
      location: "New York, NY",
      workplaceTypes: ["hybrid", "remote"],
      targetTitles: ["Senior iOS Engineer", "Senior Android Engineer"],
      verifiedSkills: ["Swift", "Kotlin", "REST", "GraphQL", "CI/CD", "Git"],
      unverifiedSkills: ["TypeScript", "SQLite"],
      mustSearch: ["Swift", "Kotlin"],
      prefSearch: ["GraphQL", "CI/CD"],
      excludedSearch: ["PHP", "Angular"],
      employer1: "Stride Mobility",
      role1: "Lead Mobile Engineer",
      metric1: "Cut mobile cold-start time by 34% across 400000 monthly active devices.",
      employer2: "Beacon Health",
      role2: "iOS Developer",
      projectName: "OfflineSync SDK",
    },
    {
      fullName: "Rajesh Kulkarni",
      headline: "Principal Enterprise Java Engineer",
      location: "Seattle, WA",
      workplaceTypes: ["hybrid", "onsite"],
      targetTitles: ["Senior Java Backend Engineer", "Spring Boot Platform Engineer"],
      verifiedSkills: ["Java", "Spring Boot", "Kafka", "PostgreSQL", "Microservices", "Docker"],
      unverifiedSkills: ["Scala", "Cassandra"],
      mustSearch: ["Java", "Spring Boot"],
      prefSearch: ["Kafka", "PostgreSQL"],
      excludedSearch: ["MySQL", "PHP"],
      employer1: "Apex Clearing",
      role1: "Principal Java Engineer",
      metric1: "Processed 18000 ledger events per second with zero reconciliation drift.",
      employer2: "Crescent Payments",
      role2: "Software Engineer",
      projectName: "SettlementBus",
    },
    {
      fullName: "Nadia Petrov",
      headline: "Cloud & Application Security Engineer",
      location: "Austin, TX",
      workplaceTypes: ["remote"],
      targetTitles: ["Senior Application Security Engineer", "Cloud Security Engineer"],
      verifiedSkills: ["Python", "AWS", "Linux", "Docker", "Kubernetes", "Terraform"],
      unverifiedSkills: ["Rust", "Go"],
      mustSearch: ["AWS", "Linux"],
      prefSearch: ["Kubernetes", "Terraform"],
      excludedSearch: ["PHP", "Ruby"],
      employer1: "ShieldNet Corp",
      role1: "Senior Security Engineer",
      metric1: "Eliminated 92% of high-severity container CVEs across 65 production services.",
      employer2: "Vault Systems",
      role2: "Security Analyst",
      projectName: "PolicyGuard CLI",
    },
    {
      fullName: "Owen Gallagher",
      headline: "Lead Quality & Test Automation Engineer",
      location: "Remote, US",
      workplaceTypes: ["remote"],
      targetTitles: ["Senior SDET", "Quality Infrastructure Engineer"],
      verifiedSkills: ["TypeScript", "Playwright", "Vitest", "Jest", "CI/CD", "Node.js"],
      unverifiedSkills: ["Cypress", "Python"],
      mustSearch: ["TypeScript", "Playwright"],
      prefSearch: ["Vitest", "CI/CD"],
      excludedSearch: ["Ruby on Rails", "PHP"],
      employer1: "ShipRight Labs",
      role1: "Lead SDET",
      metric1: "Reduced flaky E2E test retries by 81% across 320 browser specs.",
      employer2: "CraftOps",
      role2: "QA Automation Engineer",
      projectName: "DeterministicHarness",
    },
    {
      fullName: "Claire Moreau",
      headline: "Distributed Systems & Rust Engineer",
      location: "San Francisco, CA",
      workplaceTypes: ["remote", "hybrid"],
      targetTitles: ["Staff Distributed Systems Engineer", "Backend Infrastructure Engineer"],
      verifiedSkills: ["Rust", "Go", "gRPC", "Linux", "Distributed Systems", "PostgreSQL"],
      unverifiedSkills: ["C++", "Kubernetes"],
      mustSearch: ["Rust", "Go"],
      prefSearch: ["gRPC", "Linux"],
      excludedSearch: ["PHP", "MySQL"],
      employer1: "Helios Storage",
      role1: "Senior Systems Engineer",
      metric1: "Improved WAL compaction throughput by 3.2x under sustained write workloads.",
      employer2: "Foundry Compute",
      role2: "Systems Developer",
      projectName: "ZeroCopy RPC",
    },
    {
      fullName: "Tariq Al-Mansoor",
      headline: "Full-Stack Product & Database Engineer",
      location: "New York, NY",
      workplaceTypes: ["hybrid", "remote"],
      targetTitles: ["Product Infrastructure Engineer", "Full-Stack Application Engineer"],
      verifiedSkills: ["TypeScript", "SQLite", "Drizzle ORM", "React", "Next.js", "Node.js"],
      unverifiedSkills: ["Prisma", "Playwright"],
      mustSearch: ["TypeScript", "SQLite"],
      prefSearch: ["Next.js", "Drizzle ORM"],
      excludedSearch: ["Angular", "PHP"],
      employer1: "LedgerNote",
      role1: "Senior Product Engineer",
      metric1: "Migrated 14 core workflows to local SQLite cutting page load latency by 61%.",
      employer2: "CivicTech",
      role2: "Full-Stack Developer",
      projectName: "LocalFirst Engine",
    },
    {
      fullName: "Grace Kim",
      headline: "GCP & Kubernetes Platform Architect",
      location: "Seattle, WA",
      workplaceTypes: ["remote"],
      targetTitles: ["Kubernetes Infrastructure Engineer", "Cloud Reliability Architect"],
      verifiedSkills: ["GCP", "Kubernetes", "Go", "Terraform", "Docker", "Linux"],
      unverifiedSkills: ["Azure", "AWS"],
      mustSearch: ["GCP", "Kubernetes"],
      prefSearch: ["Go", "Terraform"],
      excludedSearch: ["MySQL", "Ruby on Rails"],
      employer1: "Pacific Cloud",
      role1: "Platform Architect",
      metric1: "Consolidated 19 regional clusters saving 29% in monthly cloud spend.",
      employer2: "Vertex Ops",
      role2: "Site Reliability Engineer",
      projectName: "ClusterScaler",
    },
    {
      fullName: "Mateo Silva",
      headline: "Streaming & Warehouse Data Engineer",
      location: "Austin, TX",
      workplaceTypes: ["remote", "hybrid"],
      targetTitles: ["Streaming Data Engineer", "Lead Pipeline Engineer"],
      verifiedSkills: ["Kafka", "Python", "PostgreSQL", "Spark", "Docker", "SQL"],
      unverifiedSkills: ["Airflow", "dbt"],
      mustSearch: ["Kafka", "Python"],
      prefSearch: ["PostgreSQL", "Spark"],
      excludedSearch: ["PHP", "Cassandra"],
      employer1: "StreamPulse",
      role1: "Senior Data Engineer",
      metric1: "Maintained sub-second ingestion SLA for 450 million daily telemetry events.",
      employer2: "Gridline Analytics",
      role2: "Analytics Engineer",
      projectName: "EventBackfill",
    },
    {
      fullName: "Amina Diallo",
      headline: "MLOps & Inference Infrastructure Engineer",
      location: "San Francisco, CA",
      workplaceTypes: ["hybrid", "remote"],
      targetTitles: ["ML Infrastructure Engineer", "Staff Inference Engineer"],
      verifiedSkills: ["Python", "PyTorch", "Docker", "AWS", "FastAPI", "Kubernetes"],
      unverifiedSkills: ["LLM", "gRPC"],
      mustSearch: ["Python", "Docker"],
      prefSearch: ["PyTorch", "AWS"],
      excludedSearch: ["Ruby", "PHP"],
      employer1: "InferenceGrid",
      role1: "Staff MLOps Engineer",
      metric1: "Cut GPU cold-boot provisioning from 190 seconds to 22 seconds.",
      employer2: "VectorScale",
      role2: "Backend ML Engineer",
      projectName: "ModelRouter",
    },
    {
      fullName: "Liam O'Connor",
      headline: "Vue & TypeScript UI Engineer",
      location: "Remote, US",
      workplaceTypes: ["remote"],
      targetTitles: ["Senior Frontend Engineer", "UI Architecture Engineer"],
      verifiedSkills: ["Vue.js", "TypeScript", "JavaScript", "HTML", "CSS", "REST"],
      unverifiedSkills: ["React", "Vitest"],
      mustSearch: ["TypeScript", "Vue.js"],
      prefSearch: ["CSS", "REST"],
      excludedSearch: ["Angular", "Cypress"],
      employer1: "StudioNord",
      role1: "Senior UI Engineer",
      metric1: "Shipped interactive table grid handling 50000 rows at 60 fps.",
      employer2: "BrightWeb",
      role2: "Frontend Developer",
      projectName: "VirtualGrid",
    },
    {
      fullName: "Yuki Takahashi",
      headline: "Enterprise .NET & C# Systems Engineer",
      location: "New York, NY",
      workplaceTypes: ["onsite", "hybrid"],
      targetTitles: ["Principal .NET Engineer", "Enterprise Integration Engineer"],
      verifiedSkills: ["C#", ".NET", "SQL", "Azure", "Docker", "REST"],
      unverifiedSkills: ["Java", "Kubernetes"],
      mustSearch: ["C#", ".NET"],
      prefSearch: ["SQL", "Azure"],
      excludedSearch: ["PHP", "Ruby"],
      employer1: "Vanguard Ledger",
      role1: "Principal .NET Engineer",
      metric1: "Modernized legacy monolith into 11 .NET services with 47% faster response times.",
      employer2: "Harbor Systems",
      role2: "Backend Engineer",
      projectName: "AsyncBatchQueue",
    },
    {
      fullName: "Noah Goldstein",
      headline: "DevSecOps & Systems Hardening Engineer",
      location: "Seattle, WA",
      workplaceTypes: ["remote", "hybrid"],
      targetTitles: ["Infrastructure Security Engineer", "Platform Security Architect"],
      verifiedSkills: ["Terraform", "AWS", "CI/CD", "Python", "Linux", "Docker"],
      unverifiedSkills: ["Elasticsearch", "Ansible"],
      mustSearch: ["Terraform", "AWS"],
      prefSearch: ["CI/CD", "Python"],
      excludedSearch: ["PHP", "Ruby"],
      employer1: "Ironclad Cloud",
      role1: "DevSecOps Engineer",
      metric1: "Blocked 100% of unencrypted storage deployments via automated policy gates.",
      employer2: "Kestrel Security",
      role2: "Cloud Engineer",
      projectName: "DriftGuard",
    },
    {
      fullName: "Zara Ahmed",
      headline: "Full-Stack Node & GraphQL Engineer",
      location: "Austin, TX",
      workplaceTypes: ["remote"],
      targetTitles: ["Full-Stack Application Engineer", "Lead TypeScript Developer"],
      verifiedSkills: ["TypeScript", "Node.js", "React", "GraphQL", "PostgreSQL", "Docker"],
      unverifiedSkills: ["Redis", "Next.js"],
      mustSearch: ["TypeScript", "Node.js"],
      prefSearch: ["GraphQL", "PostgreSQL"],
      excludedSearch: ["PHP", "Angular"],
      employer1: "GraphCraft",
      role1: "Lead Full-Stack Engineer",
      metric1: "Reduced GraphQL N+1 database queries by 73% with batched loaders.",
      employer2: "Summit Digital",
      role2: "Software Engineer",
      projectName: "SchemaFederation",
    },
    {
      fullName: "Victor Novak",
      headline: "Backend Reliability & Caching Engineer",
      location: "San Francisco, CA",
      workplaceTypes: ["remote", "hybrid"],
      targetTitles: ["Core Services Engineer", "Senior Backend Engineer"],
      verifiedSkills: ["Go", "PostgreSQL", "Redis", "Microservices", "Docker", "CI/CD"],
      unverifiedSkills: ["Kafka", "AWS"],
      mustSearch: ["Go", "Microservices"],
      prefSearch: ["PostgreSQL", "Docker"],
      excludedSearch: ["PHP", "MySQL"],
      employer1: "FastLane Systems",
      role1: "Senior Backend Engineer",
      metric1: "Designed multi-tier Redis cache achieving 96% hit ratio under peak load.",
      employer2: "CoreStack",
      role2: "Backend Developer",
      projectName: "RateLimiter Mesh",
    },
  ];

  return rawProfiles.map((p, i) => ({
    id: `profile-${i + 1}`,
    fullName: p.fullName,
    headline: p.headline,
    summary: `${p.headline} focused on reliable production software delivery and measurable latency reductions.`,
    location: p.location,
    targetTitles: p.targetTitles,
    workplaceTypes: p.workplaceTypes,
    minCompensation: 140_000 + (i % 4) * 10_000,
    targetCompensation: 185_000 + (i % 4) * 10_000,
    verifiedSkills: p.verifiedSkills,
    unverifiedSkills: p.unverifiedSkills,
    experiences: [
      {
        employer: p.employer1,
        title: p.role1,
        startDate: "2023-01",
        isCurrent: true,
        description: p.metric1,
      },
      {
        employer: p.employer2,
        title: p.role2,
        startDate: "2020-03",
        endDate: "2022-12",
        isCurrent: false,
        description: `Architected core ${p.verifiedSkills[0]} and ${p.verifiedSkills[1]} services in production.`,
      },
    ],
    unverifiedExperience: {
      employer: "Unverified Draft Consulting",
      title: "External Advisor",
      description: `Unverified advisory work touching ${p.unverifiedSkills.join(" and ")} prototypes.`,
    },
    project: {
      name: p.projectName,
      description: `Production tool built with ${p.verifiedSkills[0]} and ${p.verifiedSkills[1]}.`,
      outcomes: "Adopted across 5 internal engineering teams with zero regressions.",
    },
    achievement: {
      text: `Delivered 99.9% service reliability across core ${p.verifiedSkills[0]} workloads.`,
      metricValue: 99.9,
      metricUnit: "%",
      metricContext: `${p.verifiedSkills[0]} uptime`,
    },
    mustHaveSearchSkills: p.mustSearch,
    preferredSearchSkills: p.prefSearch,
    excludedSearchSkills: p.excludedSearch,
  }));
}

function doesSpecSkillMatchJob(
  skillName: string,
  jobTitle: string,
  jobDescriptionText: string,
  reqs: Array<{ normalizedSkill: string | null; requirementText: string }>
): boolean {
  const canonical = normalizeSkillTerm(skillName);
  const aliases = expandSkillAliases(canonical, [skillName]);
  const normalizedAliasSet = new Set(aliases.map((a) => normalizeSkillTerm(a)));

  if (textContainsSkillAlias(jobTitle, aliases)) {
    return true;
  }
  for (const req of reqs) {
    if (req.normalizedSkill && normalizedAliasSet.has(normalizeSkillTerm(req.normalizedSkill))) {
      return true;
    }
    if (textContainsSkillAlias(req.requirementText, aliases)) {
      return true;
    }
  }
  return textContainsSkillAlias(jobDescriptionText, aliases);
}

describe("Slice 6 AI Evals: 20x50 Matching Benchmark & Resume Grounding", () => {
  const jobSpecs = build50RealisticJobs();
  const profileSpecs = build20CandidateProfiles();

  it("verifies unverified (needs_review) career facts contribute 0% to documentedFitScore when verified alternatives are absent", async () => {
    // Evaluate all 20 unverified-only profiles across 5 diverse JDs (100 pairs)
    const sampleJds = [jobSpecs[0], jobSpecs[10], jobSpecs[20], jobSpecs[30], jobSpecs[45]];

    for (const profileSpec of profileSpecs) {
      const { db, sqlite } = createTestDatabase();
      try {
        upsertProfile(
          {
            fullName: profileSpec.fullName,
            email: `${profileSpec.id}@example.com`,
            location: profileSpec.location,
            headline: profileSpec.headline,
            summary: profileSpec.summary,
            verificationStatus: "needs_review",
            origin: "resume_import",
          },
          db
        );

        for (const exp of profileSpec.experiences) {
          createExperience(
            {
              ...exp,
              verificationStatus: "needs_review",
              origin: "resume_import",
            },
            db
          );
        }

        for (const skillName of [...profileSpec.verifiedSkills, ...profileSpec.unverifiedSkills]) {
          createSkill(
            {
              canonicalName: skillName,
              verificationStatus: "needs_review",
              origin: "resume_import",
            },
            db
          );
        }

        const sp = createSearchProfile(
          {
            name: `${profileSpec.fullName} Search`,
            targetTitles: profileSpec.targetTitles,
            workplaceTypes: profileSpec.workplaceTypes,
          },
          db
        );

        for (const jd of sampleJds) {
          const imported = await ingestManualJob(
            {
              title: jd.title,
              companyName: jd.companyName,
              locationText: jd.locationText,
              workplaceType: jd.workplaceType,
              salaryMin: jd.salaryMin,
              salaryMax: jd.salaryMax,
              salaryCurrency: jd.salaryMin ? "USD" : null,
              salaryPeriod: jd.salaryMin ? "year" : null,
              employerPostedAt: jd.employerPostedAt,
              descriptionText: jd.extraLines.join("\n"),
            },
            db,
            sqlite
          );
          const jobId = imported.job!.id;
          runDeterministicJobAnalysis(jobId, db, sqlite, () => REFERENCE_NOW);

          const match = computeJobMatch({
            jobId,
            searchProfileId: sp.id,
            db,
            sqlite,
            now: () => REFERENCE_NOW,
          });

          // With zero verified facts in the profile, documentedFitScore must be 0 (or null if 0 assessable reqs)
          if (match.documentedFitScore !== null) {
            expect(match.documentedFitScore).toBe(0);
          }
          for (const ev of match.evidence) {
            expect(ev.supportState).not.toBe("supported");
            expect(ev.supportState).not.toBe("partially_supported");
            expect(ev.linkedFactId).toBeNull();
          }
        }
      } finally {
        sqlite.close();
      }
    }
  });

  it("evaluates 20 profiles x 50 JDs (1,000 pairs) preserving unverified-fact exclusion, weighted preferences, and -25 excluded-skill penalty", async () => {
    expect(profileSpecs).toHaveLength(20);
    expect(jobSpecs).toHaveLength(50);

    let totalPairsEvaluated = 0;
    let penaltyPairsObserved = 0;
    const sampledResumeChecks: Array<{
      profileSpec: SeedProfileSpec;
      jdIndex: number;
    }> = [];

    for (let pIdx = 0; pIdx < profileSpecs.length; pIdx++) {
      const profileSpec = profileSpecs[pIdx];
      const { db, sqlite } = createTestDatabase();

      try {
        upsertProfile(
          {
            fullName: profileSpec.fullName,
            email: `${profileSpec.id}@example.com`,
            location: profileSpec.location,
            headline: profileSpec.headline,
            summary: profileSpec.summary,
            verificationStatus: "verified",
            origin: "manual",
          },
          db
        );

        const unverifiedFactIds = new Set<string>();

        for (const exp of profileSpec.experiences) {
          createExperience(
            {
              ...exp,
              verificationStatus: "verified",
              origin: "manual",
            },
            db
          );
        }

        const unverifiedExp = createExperience(
          {
            ...profileSpec.unverifiedExperience,
            verificationStatus: "needs_review",
            origin: "resume_import",
          },
          db
        );
        unverifiedFactIds.add(unverifiedExp.id);

        createProject(
          {
            ...profileSpec.project,
            verificationStatus: "verified",
            origin: "manual",
          },
          db
        );

        createAchievement(
          {
            ...profileSpec.achievement,
            verificationStatus: "verified",
            origin: "manual",
          },
          db
        );

        createEducation(
          {
            institution: "State University of Engineering",
            qualification: "B.S. Computer Science",
            startDate: "2015-09",
            endDate: "2019-05",
            verificationStatus: "verified",
            origin: "manual",
          },
          db
        );

        for (const skillName of profileSpec.verifiedSkills) {
          createSkill(
            {
              canonicalName: skillName,
              verificationStatus: "verified",
              origin: "manual",
            },
            db
          );
        }

        for (const unverifiedSkill of profileSpec.unverifiedSkills) {
          const sk = createSkill(
            {
              canonicalName: unverifiedSkill,
              verificationStatus: "needs_review",
              origin: "resume_import",
            },
            db
          );
          unverifiedFactIds.add(sk.id);
        }

        const searchProfile = createSearchProfile(
          {
            name: `${profileSpec.fullName} Target`,
            targetTitles: profileSpec.targetTitles,
            workplaceTypes: profileSpec.workplaceTypes,
            minCompensation: profileSpec.minCompensation,
            targetCompensation: profileSpec.targetCompensation,
            compensationCurrency: "USD",
            compensationPeriod: "year",
          },
          db
        );

        const baselineProfile = createSearchProfile(
          {
            name: `${profileSpec.fullName} NoExcluded`,
            targetTitles: profileSpec.targetTitles,
            workplaceTypes: profileSpec.workplaceTypes,
            minCompensation: profileSpec.minCompensation,
            targetCompensation: profileSpec.targetCompensation,
            compensationCurrency: "USD",
            compensationPeriod: "year",
          },
          db
        );

        for (const s of profileSpec.mustHaveSearchSkills) {
          addSearchProfileSkill(
            searchProfile.id,
            { displayLabel: s, preference: "must_have", filterMode: "weighted" },
            db
          );
          addSearchProfileSkill(
            baselineProfile.id,
            { displayLabel: s, preference: "must_have", filterMode: "weighted" },
            db
          );
        }

        for (const s of profileSpec.preferredSearchSkills) {
          addSearchProfileSkill(
            searchProfile.id,
            { displayLabel: s, preference: "preferred", filterMode: "weighted" },
            db
          );
          addSearchProfileSkill(
            baselineProfile.id,
            { displayLabel: s, preference: "preferred", filterMode: "weighted" },
            db
          );
        }

        for (const s of profileSpec.excludedSearchSkills) {
          addSearchProfileSkill(
            searchProfile.id,
            { displayLabel: s, preference: "excluded", filterMode: "weighted" },
            db
          );
        }

        // Ingest and deterministically analyze all 50 JDs in this candidate DB
        const ingestedJobIds: string[] = [];
        for (const jd of jobSpecs) {
          const imported = await ingestManualJob(
            {
              title: jd.title,
              companyName: jd.companyName,
              locationText: jd.locationText,
              workplaceType: jd.workplaceType,
              salaryMin: jd.salaryMin,
              salaryMax: jd.salaryMax,
              salaryCurrency: jd.salaryMin ? "USD" : null,
              salaryPeriod: jd.salaryMin ? "year" : null,
              employerPostedAt: jd.employerPostedAt,
              descriptionText: jd.extraLines.join("\n"),
            },
            db,
            sqlite
          );
          const jobId = imported.job!.id;
          runDeterministicJobAnalysis(jobId, db, sqlite, () => REFERENCE_NOW);
          ingestedJobIds.push(jobId);
        }

        for (let jIdx = 0; jIdx < ingestedJobIds.length; jIdx++) {
          const jobId = ingestedJobIds[jIdx];
          const jobRow = db.select().from(jobs).where(eq(jobs.id, jobId)).get()!;
          const activeReqs = db
            .select()
            .from(jobRequirements)
            .where(eq(jobRequirements.jobId, jobId))
            .all();

          const match = computeJobMatch({
            jobId,
            searchProfileId: searchProfile.id,
            db,
            sqlite,
            now: () => REFERENCE_NOW,
          });
          totalPairsEvaluated++;

          // Invariant 1: No unverified fact may ever be linked in match evidence
          for (const ev of match.evidence) {
            if (ev.linkedFactId) {
              expect(unverifiedFactIds.has(ev.linkedFactId)).toBe(false);
            }
          }

          // Invariant 2: Score bounds
          if (match.documentedFitScore !== null) {
            expect(match.documentedFitScore).toBeGreaterThanOrEqual(0);
            expect(match.documentedFitScore).toBeLessThanOrEqual(100);
          }
          expect(match.priorityScore).toBeGreaterThanOrEqual(0);
          expect(match.priorityScore).toBeLessThanOrEqual(100);

          // Invariant 3: Weighted preference & -25 excluded-skill penalty formula
          let positiveWeightTotal = 0;
          let positiveWeightMatched = 0;
          for (const s of profileSpec.mustHaveSearchSkills) {
            positiveWeightTotal += 2;
            if (doesSpecSkillMatchJob(s, jobRow.title, jobRow.descriptionText, activeReqs)) {
              positiveWeightMatched += 2;
            }
          }
          for (const s of profileSpec.preferredSearchSkills) {
            positiveWeightTotal += 1;
            if (doesSpecSkillMatchJob(s, jobRow.title, jobRow.descriptionText, activeReqs)) {
              positiveWeightMatched += 1;
            }
          }

          let excludedMatches = 0;
          for (const s of profileSpec.excludedSearchSkills) {
            if (doesSpecSkillMatchJob(s, jobRow.title, jobRow.descriptionText, activeReqs)) {
              excludedMatches++;
            }
          }

          const expectedBase = Math.round((100 * positiveWeightMatched) / positiveWeightTotal);
          const expectedScore = Math.max(
            0,
            Math.min(100, expectedBase - Math.min(100, excludedMatches * 25))
          );

          expect(match.searchSkillAlignmentScore).toBe(expectedScore);

          if (excludedMatches > 0) {
            penaltyPairsObserved++;
            const baselineMatch = computeJobMatch({
              jobId,
              searchProfileId: baselineProfile.id,
              db,
              sqlite,
              now: () => REFERENCE_NOW,
            });
            expect(baselineMatch.searchSkillAlignmentScore).toBe(expectedBase);
            expect(match.searchSkillAlignmentScore).toBe(
              Math.max(0, expectedBase - excludedMatches * 25)
            );
          }
        }

        // Pick 1 diverse JD per profile (20 total) to verify tailored resume grounding
        const pickedJdIndex = (pIdx * 2 + (pIdx % 5)) % ingestedJobIds.length;
        const pickedJobId = ingestedJobIds[pickedJdIndex];
        const resumeResult = await generateTailoredResume({
          jobId: pickedJobId,
          searchProfileId: searchProfile.id,
          mode: "deterministic",
          db,
          now: () => REFERENCE_NOW,
        });

        expect(resumeResult.usedAi).toBe(false);
        expect(resumeResult.modelProvider).toBe("deterministic");
        expect(resumeResult.factualityValidation.valid).toBe(true);
        expect(resumeResult.factualityValidation.violations).toEqual([]);

        const careerProfile = getFullCareerProfile(db);
        const catalog = buildVerifiedFactCatalog(careerProfile);
        const independentCheck = validateStructuredResumeFactuality(
          resumeResult.document,
          catalog
        );
        expect(independentCheck.valid).toBe(true);
        expect(independentCheck.violations).toEqual([]);

        // Verify zero uncited claims and zero unverified fact references
        for (const section of resumeResult.document.sections) {
          if (section.summaryText && section.summaryText.trim().length > 0) {
            expect(section.summaryEvidenceRefs.length).toBeGreaterThan(0);
            for (const ref of section.summaryEvidenceRefs) {
              expect(unverifiedFactIds.has(ref.factId)).toBe(false);
              expect(catalog.byKey[makeFactCatalogKey(ref.factType, ref.factId)]).toBeDefined();
            }
          }
          for (const entry of section.entries) {
            for (const bullet of entry.bullets) {
              expect(bullet.evidenceRefs.length).toBeGreaterThan(0);
              for (const ref of bullet.evidenceRefs) {
                expect(unverifiedFactIds.has(ref.factId)).toBe(false);
                expect(catalog.byKey[makeFactCatalogKey(ref.factType, ref.factId)]).toBeDefined();
              }
            }
          }
          for (const group of section.skillGroups) {
            for (const item of group.items) {
              expect(unverifiedFactIds.has(item.factId)).toBe(false);
              expect(catalog.byKey[makeFactCatalogKey("skill", item.factId)]).toBeDefined();
            }
          }
        }

        sampledResumeChecks.push({ profileSpec, jdIndex: pickedJdIndex });
      } finally {
        sqlite.close();
      }
    }

    expect(totalPairsEvaluated).toBe(1000);
    expect(penaltyPairsObserved).toBeGreaterThan(50);
    expect(sampledResumeChecks).toHaveLength(20);
  });
});
