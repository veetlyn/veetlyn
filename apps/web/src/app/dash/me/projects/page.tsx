import { requireSession } from "@/lib/server-api";

import ClientHome from "./client-home";

export default async function ClientHomePage() {
  await requireSession();
  return <ClientHome />;
}
