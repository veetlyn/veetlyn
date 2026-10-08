import { safeHttpsLink } from "@/lib/delivery";

export function DeliveryLink({ link, className }: { link: string | null; className?: string }) {
  const href = safeHttpsLink(link);
  if (href) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className={`block underline underline-offset-4 break-all ${className ?? ""}`}>
        {href}
      </a>
    );
  }
  return link ? <p className={`break-all ${className ?? ""}`}>{link}</p> : null;
}
