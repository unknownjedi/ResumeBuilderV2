import { ApplicationsWorkbench } from "@/features/applications/applications-workbench";

interface ApplicationsPageProps {
  searchParams: Promise<{
    applicationId?: string;
  }>;
}

export default async function ApplicationsPage({
  searchParams,
}: ApplicationsPageProps) {
  const params = await searchParams;
  const initialApplicationId =
    typeof params.applicationId === "string" && params.applicationId.trim()
      ? params.applicationId.trim()
      : null;

  return (
    <ApplicationsWorkbench initialApplicationId={initialApplicationId} />
  );
}
