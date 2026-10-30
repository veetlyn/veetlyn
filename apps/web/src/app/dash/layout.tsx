import Header from "@/components/header";
import { NOINDEX } from "@/lib/seller-site";

// The dashboard sits behind sign-in; its pages never belong in an index.
export const metadata = NOINDEX;

export default function DashLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Header />
      {children}
    </div>
  );
}
