import Link from "next/link";

// A key figure in a coated frame: the label in the head strip, the figure and its note in the card. A linked figure
// lifts a pixel on hover and opens the records behind it.
export function Figure({ label, value, note, href }: { label: string; value: string; note: string; href?: string }) {
  const content = (
    <>
      <p className="frame-head text-muted-foreground">{label}</p>
      <div className="frame frame-body flex-1 px-5 py-4">
        <p className="font-tabular text-[24px] leading-none font-semibold tracking-[-0.02em]">{value}</p>
        <p className="mt-2 text-xs text-muted-foreground">{note}</p>
      </div>
    </>
  );
  const className = "frame frame-panel flex min-w-0 flex-col";
  return href ? (
    <Link href={href} className={`${className} transition-transform duration-150 hover:-translate-y-px`}>
      {content}
    </Link>
  ) : (
    <div className={className}>{content}</div>
  );
}
