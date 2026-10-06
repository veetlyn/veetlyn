import { A } from "@/components/legal/prose";

export type PolicyStore = { name: string; url: string; supportEmail: string | null };

export function StoreContact({ store }: { store: PolicyStore }) {
  if (!store.supportEmail) return <>the contact details on this website</>;
  return <A href={`mailto:${store.supportEmail}`}>{store.supportEmail}</A>;
}

export function StoreLink({ store }: { store: PolicyStore }) {
  return <A href={store.url}>{store.url}</A>;
}
