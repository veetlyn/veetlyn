import { splitFor, usd } from "./money";

type Tile = {
  name: string;
  line: string;
  place: string;
  field: string;
  element: React.ReactNode;
};

// Each tile holds one real piece of the interface, enlarged through the font size of its data-ui root and cropped
// by two of the tile's edges.
function Close({ children, className }: { children: React.ReactNode; className: string }) {
  return (
    <div data-ui aria-hidden="true" className={`pointer-events-none absolute ${className}`}>
      {children}
    </div>
  );
}

export default function Board() {
  const s = splitFor(64_000);
  const tiles: Tile[] = [
    {
      name: "Every project, start to finish",
      line: "Quotes, amendments, deliveries and the balance, in one place.",
      place: "col-span-2 row-span-3 md:col-span-6 md:row-span-4 md:col-start-1 md:row-start-1",
      field: "bg-field-1 text-field-1-ink",
      element: (
        <Close className="top-[14%] -right-[18%] w-[34em] text-[clamp(10px,1.3vw,18px)]">
          <div className="rounded-[0.9em] border border-input bg-card p-[1.4em] text-card-foreground shadow-[var(--raise)]" /* taste-skill-ignore: the app's own fragment (data-ui) keeps its borders and shadows */>
            <p className="text-[1.6em] font-semibold">Logo and brand kit</p>
            <div className="mt-[1em] grid grid-cols-6 gap-[0.4em]">
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <span key={i} className={`h-[0.5em] rounded-full ${i < 3 ? "bg-brand" : i === 3 ? "bg-brand/45" : "bg-border"}`} />
              ))}
            </div>
            <p className="mt-[0.8em] text-[1.1em] text-muted-foreground">Now: Review</p>
          </div>
        </Close>
      ),
    },
    {
      name: "Payout rules",
      line: "Approve each payout, or let a rule do it.",
      place: "col-span-1 row-span-2 md:col-span-3 md:row-span-4 md:col-start-7 md:row-start-3",
      field: "bg-field-3 text-field-3-ink",
      element: (
        <Close className="top-[10%] -left-[12%] text-[clamp(10px,1.5vw,22px)]">
          <div className="flex items-center gap-[0.8em] rounded-[0.8em] bg-card px-[1em] py-[0.8em] text-card-foreground">
            <span className="relative h-[1.4em] w-[2.4em] rounded-full bg-brand">
              <span className="absolute top-[0.2em] right-[0.2em] size-[1em] rounded-full bg-white" />
            </span>
            <span className="text-[1.1em] whitespace-nowrap">Auto-approve up to $100</span>
          </div>
        </Close>
      ),
    },
    {
      name: "Pay pages",
      line: "Clients pay with PayPal. No account.",
      place: "col-span-1 row-span-2 md:col-span-3 md:row-span-2 md:col-start-10 md:row-start-3",
      field: "bg-field-2 text-field-2-ink",
      element: (
        <Close className="-top-[8%] -right-[6%] text-[clamp(12px,2.4vw,34px)]">
          <span className="block bg-card px-[0.6em] py-[0.2em] font-semibold text-brand-text bowl">Paid</span>
        </Close>
      ),
    },
    {
      name: "Member payouts",
      line: "Each freelancer asks for their share.",
      place: "col-span-1 row-span-2 md:col-span-3 md:row-span-2 md:col-start-10 md:row-start-5",
      field: "bg-field-1 text-field-1-ink",
      element: (
        <Close className="-top-[6%] -right-[10%] text-[clamp(12px,2.6vw,38px)]">
          <span className="font-heading font-tabular">{usd(s.memberReceivesMinor)}</span>
        </Close>
      ),
    },
    {
      name: "A store on the side",
      line: "Sell downloads on the web and to AI shoppers.",
      place: "col-span-2 row-span-2 md:col-span-6 md:row-span-2 md:col-start-1 md:row-start-5",
      field: "bg-field-2 text-field-2-ink",
      element: (
        <Close className="top-[16%] -right-[6%] text-[clamp(11px,1.4vw,20px)]">
          <div className="flex items-center gap-[1.2em] rounded-[0.8em] border border-input bg-card px-[1.2em] py-[0.8em] text-card-foreground">
            <span className="text-[1.1em] font-medium">Icon pack</span>
            <span className="font-tabular text-[1.1em]">$19.00</span>
            <span className="text-[1em] font-semibold text-brand-text">Paid</span>
          </div>
        </Close>
      ),
    },
    {
      name: "Discord",
      line: "Quote and get paid from ticket channels.",
      place: "col-span-1 row-span-2 md:col-span-3 md:row-span-2 md:col-start-1 md:row-start-7",
      field: "bg-field-4 text-field-4-ink",
      element: (
        <Close className="top-[14%] -right-[20%] text-[clamp(11px,1.5vw,22px)]">
          <span className="rounded-[0.5em] bg-field-3 px-[0.6em] py-[0.3em] text-field-3-ink">/payleor quote</span>
        </Close>
      ),
    },
    {
      name: "Disputes",
      line: "An agent drafts the reply. You approve it.",
      place: "col-span-1 row-span-2 md:col-span-3 md:row-span-2 md:col-start-4 md:row-start-7",
      field: "bg-field-1 text-field-1-ink",
      element: (
        <Close className="top-[12%] -right-[16%] text-[clamp(11px,1.5vw,22px)]">
          <span className="flex items-center gap-[0.6em]">
            <span className="text-muted-foreground">Reply drafted</span>
            <span className="bg-foreground px-[0.8em] py-[0.35em] text-background bowl">Approve</span>
          </span>
        </Close>
      ),
    },
    {
      name: "In Claude and ChatGPT",
      line: "Clients find you and request a quote in the chat.",
      place: "col-span-2 row-span-2 md:col-span-6 md:row-span-2 md:col-start-7 md:row-start-7",
      field: "bg-field-3 text-field-3-ink",
      element: (
        <Close className="top-[12%] -right-[4%] text-[clamp(11px,1.4vw,20px)]">
          <div className="flex items-center gap-[1em] rounded-[0.9em] bg-card px-[1.1em] py-[0.8em] text-card-foreground">
            <span className="grid">
              <span className="text-[1.05em] font-semibold">Logo and brand kit</span>
              <span className="font-tabular text-[0.95em] text-muted-foreground">$400 – $900 · 7–14 days</span>
            </span>
            <span className="bg-brand px-[0.9em] py-[0.5em] text-[0.95em] font-semibold text-brand-foreground bowl">
              Request a quote
            </span>
          </div>
        </Close>
      ),
    },
  ];

  return (
    <section aria-labelledby="board-heading" className="px-4">
      <div className="grid grid-flow-row-dense auto-rows-[28vw] grid-cols-2 gap-1.5 md:auto-rows-[104px] md:grid-cols-12 md:gap-2">
        <div className="col-span-2 row-span-2 bg-field-4 p-6 text-field-4-ink md:col-span-6 md:col-start-7 md:row-span-2 md:row-start-1">
          <h2 id="board-heading" data-reveal className="font-heading text-[clamp(36px,4vw,60px)] leading-[1]">
            Built for paid work
          </h2>
        </div>
        {tiles.map((tile, i) => (
          <div
            key={tile.name}
            data-reveal
            style={{ "--i": i % 4 }}
            className={`relative overflow-hidden ${tile.place} ${tile.field}`}
          >
            {tile.element}
            <div className="absolute right-6 bottom-5 left-6">
              <h3 className="text-[17px] font-medium">{tile.name}</h3>
              <p className="mt-0.5 text-[15px] opacity-80">{tile.line}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
