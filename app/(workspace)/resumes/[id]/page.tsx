import { ResumeStudio } from "@/features/resume-builder/resume-studio";

interface ResumeDetailPageProps {
  params: Promise<{ id: string }>;
}

export default async function ResumeDetailPage({
  params,
}: ResumeDetailPageProps) {
  const { id } = await params;
  return <ResumeStudio draftId={decodeURIComponent(id)} />;
}
