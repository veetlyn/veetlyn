import { requireSession } from "@/lib/server-api";

import PersonalHome from "./personal-home";

export default async function PersonalHomePage() {
  await requireSession();
  return <PersonalHome />;
}
