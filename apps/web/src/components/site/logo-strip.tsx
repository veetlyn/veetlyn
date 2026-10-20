import { CHAT_GLYPH, LOGO_PATHS } from "@/content/site/logos";

function Mark({ name, d }: { name: string; d: string }) {
  return (
    <span className="logo">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d={d} />
      </svg>
      {name}
    </span>
  );
}

export default function LogoStrip() {
  return (
    <div className="found" data-in>
      <div className="group">
        <span className="label">Where clients find you</span>
        <Mark name="ChatGPT" d={CHAT_GLYPH} />
        <Mark name="Claude" d={LOGO_PATHS.claude} />
        <Mark name="Perplexity" d={LOGO_PATHS.perplexity} />
        <Mark name="Gemini" d={LOGO_PATHS.googlegemini} />
        <Mark name="Google" d={LOGO_PATHS.google} />
      </div>
      <div className="group">
        <span className="label">Paid through</span>
        <Mark name="PayPal" d={LOGO_PATHS.paypal} />
      </div>
    </div>
  );
}
