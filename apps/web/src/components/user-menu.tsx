import { Button } from "@jendal-workspace/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@jendal-workspace/ui/components/dropdown-menu";
import { Skeleton } from "@jendal-workspace/ui/components/skeleton";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronDown } from "lucide-react";

import { authClient } from "@/lib/auth-client";

export default function UserMenu({ sidebar = false, drawer = false }: { sidebar?: boolean; drawer?: boolean }) {
  const router = useRouter();
  const { data: session, isPending } = authClient.useSession();

  if (isPending) {
    return <Skeleton className="h-9 w-24" />;
  }

  if (!session) {
    return (
      <Link href="/login">
        <Button variant="outline">Sign in</Button>
      </Link>
    );
  }

  const signOut = () => authClient.signOut({ fetchOptions: { onSuccess: () => router.push("/") } });

  // Keep this menu inside the native modal's top layer. A portalled dropdown would be behind the drawer and inert.
  if (drawer) {
    return <details className="group/account rounded-lg">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-lg px-2.5 py-2 hover:bg-accent [&::-webkit-details-marker]:hidden">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-secondary text-xs" aria-hidden="true">{session.user.name.slice(0, 1)}</span>
        <span className="grid min-w-0 flex-1 text-sm"><span className="truncate">{session.user.name}</span><span className="text-xs text-muted-foreground">Your account</span></span>
        <ChevronDown className="size-4 group-open/account:rotate-180" aria-hidden="true" />
      </summary>
      <nav aria-label="Your account" className="grid gap-1 border-t p-2 text-sm [&>a]:rounded-lg [&>a]:px-3 [&>a]:py-3 [&>a:hover]:bg-accent">
        <Link href="/account">Account settings</Link>
        <Link href="/me/payouts">Payouts</Link>
        <Link href="/me/projects">Your projects as a client</Link>
        <button type="button" onClick={() => void signOut()} className="rounded-lg px-3 py-3 text-left text-destructive hover:bg-accent">Sign out</button>
      </nav>
    </details>;
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant={sidebar ? "ghost" : "outline"} className={sidebar ? "h-auto w-full justify-start gap-2 px-2.5 py-2 text-left" : undefined} />}>
        {sidebar ? <>
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-secondary text-xs" aria-hidden="true">{session.user.name.slice(0, 1)}</span>
          <span className="grid min-w-0 flex-1"><span className="truncate">{session.user.name}</span><span className="text-xs font-normal text-muted-foreground">Your account</span></span>
          <ChevronDown className="size-3.5 shrink-0" aria-hidden="true" />
        </> : session.user.name}
      </DropdownMenuTrigger>
      <DropdownMenuContent className="bg-card">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Your account</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem>{session.user.email}</DropdownMenuItem>
          <DropdownMenuItem render={<Link href="/account" />}>Account settings</DropdownMenuItem>
          <DropdownMenuItem render={<Link href="/me/payouts" />}>Payouts</DropdownMenuItem>
          <DropdownMenuItem render={<Link href="/me/projects" />}>Your projects as a client</DropdownMenuItem>
          <DropdownMenuItem
            variant="destructive"
            onClick={() => void signOut()}
          >
            Sign out
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
