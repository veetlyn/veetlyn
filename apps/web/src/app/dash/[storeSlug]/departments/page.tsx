import { redirect } from "next/navigation";

// Categories used to be managed under Departments.
export default async function DepartmentsPage({ params }: { params: Promise<{ storeSlug: string }> }) {
  const { storeSlug } = await params;
  redirect(`/${encodeURIComponent(storeSlug)}/categories`);
}
