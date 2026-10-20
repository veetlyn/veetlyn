import { BrandMark } from "@/components/brand-mark";

// Any host can land here: a draft store, an old link, a typo. A plain link home works on all of them.
export default function NotFound() {
  return (
    <main className="mx-auto grid w-full max-w-md flex-1 content-center gap-4 px-4 py-16 text-center">
      <BrandMark className="mx-auto size-8 text-foreground" />
      <h1 className="font-heading text-3xl">This page does not exist</h1>
      <p className="text-sm text-muted-foreground">
        The link may be old, or the page is not published yet. Check the address, or start again from the home page.
      </p>
      <a href="/" className="justify-self-center text-sm underline decoration-border underline-offset-4 hover:decoration-foreground">
        Go to the home page
      </a>
    </main>
  );
}
