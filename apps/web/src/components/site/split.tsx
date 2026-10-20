import { usdCents } from "@/lib/site/examples";

export type SplitPart = { label: string; minor: number; tone: "brand" | "ink" | "paypal" | "payleor" };

// Where one payment goes, as a bar and its legend. The story grows the bar's parts when its scene is on.
export default function Split({ parts }: { parts: readonly SplitPart[] }) {
  return (
    <div className="split">
      <div className="bar" aria-hidden="true">
        {parts.map((p) => (
          <span key={p.label} className={`tone-${p.tone}`} data-grow={p.minor} />
        ))}
      </div>
      <div className="legend num">
        {parts.map((p) => (
          <div key={p.label}>
            <b className={`tone-${p.tone}`}>{p.label}</b>
            <span>{usdCents(p.minor)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
