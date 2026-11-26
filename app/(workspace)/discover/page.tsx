import { DiscoverWorkbench } from "@/features/job-discovery/discover-workbench";

interface DiscoverPageProps {
  searchParams: Promise<{
    job?: string;
    import?: string;
    action?: string;
  }>;
}

export default async function DiscoverPage({ searchParams }: DiscoverPageProps) {
  const params = await searchParams;
  const initialJobId =
    typeof params.job === "string" && params.job.trim() ? params.job.trim() : null;
  const initialOpenImport =
    params.import === "1" ||
    params.import === "true" ||
    params.action === "add-url";

  return (
    <DiscoverWorkbench
      initialJobId={initialJobId}
      initialOpenImport={initialOpenImport}
    />
  );
}
