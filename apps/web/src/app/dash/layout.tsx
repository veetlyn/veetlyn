import Header from "@/components/header";

export default function DashLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Header />
      {children}
    </div>
  );
}
