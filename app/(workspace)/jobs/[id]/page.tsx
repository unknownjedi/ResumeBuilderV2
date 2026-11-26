import { JobDetailPageClient } from "@/features/job-discovery/job-detail-page-client";

interface JobDetailPageProps {
  params: Promise<{ id: string }>;
}

export default async function JobDetailPage({ params }: JobDetailPageProps) {
  const { id } = await params;
  return <JobDetailPageClient jobId={decodeURIComponent(id)} />;
}
