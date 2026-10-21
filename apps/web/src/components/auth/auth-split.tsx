import Link from "next/link";

import AuthVisual from "@/components/auth/auth-visual";
import { BrandMark } from "@/components/brand-mark";
import { ModeToggle } from "@/components/mode-toggle";

// The sign-in and consent pages split the screen: the form on the left, the visual on the right, all within one
// screen.
export default function AuthSplit({ children, visual }: { children: React.ReactNode; visual?: React.ReactNode }) {
  return (
    <main data-screen-fit className="grid min-h-0 flex-1 gap-3 p-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <div className="flex min-h-0 flex-col overflow-y-auto [scrollbar-width:none]">
        <div className="flex items-center justify-between px-3 pt-2">
          <Link href="/" className="flex items-center gap-2">
            <BrandMark className="size-6 text-foreground" />
            <span className="font-heading text-lg">Payleor</span>
          </Link>
          <ModeToggle />
        </div>
        <div className="flex flex-1 items-center justify-center px-4 py-4 short:py-2">
          <div className="w-full max-w-sm">{children}</div>
        </div>
      </div>
      {visual ?? <AuthVisual />}
    </main>
  );
}
