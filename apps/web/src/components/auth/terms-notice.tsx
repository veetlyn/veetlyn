// Legal pages live on the site host; auth stays on the admin host (spec §3).
export default function TermsNotice({ siteOrigin }: { siteOrigin: string }) {
  return (
    <p className="text-xs text-muted-foreground">
      By continuing you agree to the{" "}
      <a href={`${siteOrigin}/legal/terms`} className="underline underline-offset-2">
        Terms of service
      </a>{" "}
      and the{" "}
      <a href={`${siteOrigin}/legal/acceptable-use`} className="underline underline-offset-2">
        Acceptable use policy
      </a>
      .
    </p>
  );
}
