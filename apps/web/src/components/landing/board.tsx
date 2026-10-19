import { splitFor, usd } from "./money";

// The bento: eight tiles, each holding a real piece of the product at its real size, anchored under the tile's
// caption and cropped by its edges. Sizes follow importance: the project page is the largest.

const s = splitFor(64_000);
const earningsMinor = s.memberReceivesMinor + s.payoutFeeMinor;

function Frag({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      data-ui
      className={`rounded-[12px] border border-input bg-card text-card-foreground shadow-[var(--raise)] ${className}`} /* taste-skill-ignore: the app's own fragment (data-ui) keeps its borders and shadows */
    >
      {children}
    </div>
  );
}

function Status({ children, tone = "brand" }: { children: React.ReactNode; tone?: "brand" | "muted" }) {
  return (
    <span className={`text-[13px] font-semibold ${tone === "brand" ? "text-brand-text" : "text-muted-foreground"}`}>
      {children}
    </span>
  );
}

const STEPS = ["Quote", "Deposit", "Work", "Review", "Balance", "Done"] as const;

function ProjectPage() {
  return (
    <Frag className="w-[640px] p-6 lg:w-full">
      <div className="flex items-baseline justify-between gap-4">
        <div>
          <p className="font-heading text-[24px] leading-tight">Logo and brand kit</p>
          <p className="text-[13px] text-muted-foreground">Walk Crew, for a bakery · Amadou is on it</p>
        </div>
        <Status>In progress</Status>
      </div>
      <ol className="mt-5 grid grid-cols-6 gap-1.5">
        {STEPS.map((step, i) => (
          <li key={step} className="grid gap-1.5">
            <span className={`h-1.5 rounded-full ${i < 2 ? "bg-brand" : i === 2 ? "bg-brand/45" : "bg-border"}`} />
            <span className={`text-[13px] ${i === 2 ? "font-semibold" : "text-muted-foreground"}`}>{step}</span>
          </li>
        ))}
      </ol>
      <div className="mt-6 grid grid-cols-2 gap-6 text-[13px]">
        <div className="grid content-start gap-2">
          <p className="flex justify-between font-medium">
            <span>Quote v1 · {usd(s.quoteMinor)}</span>
            <Status>Accepted</Status>
          </p>
          <p className="flex justify-between text-muted-foreground">
            <span>Logo, 3 directions</span>
            <span className="font-tabular">$400.00</span>
          </p>
          <p className="flex justify-between text-muted-foreground">
            <span>Colour and type sheet</span>
            <span className="font-tabular">$240.00</span>
          </p>
        </div>
        <div className="grid content-start gap-2">
          <p className="flex justify-between">
            <span>
              Deposit · <span className="font-tabular">{usd(s.deposit.totalMinor)}</span>
            </span>
            <Status>Paid</Status>
          </p>
          <p className="flex justify-between">
            <span>
              Balance · <span className="font-tabular">{usd(s.quoteMinor - s.deposit.quotePartMinor)}</span>
            </span>
            <Status tone="muted">After delivery</Status>
          </p>
          <p className="flex justify-between">
            <span>Delivery</span>
            <span className="text-muted-foreground">Due in 6 days</span>
          </p>
        </div>
      </div>
    </Frag>
  );
}

function PayoutRules() {
  return (
    <Frag className="w-[340px] p-5">
      <p className="text-[13px] font-medium">Auto-approve</p>
      <div className="mt-2 grid grid-cols-3 gap-1 rounded-[10px] bg-tray p-1 text-center text-[13px]">
        <span className="py-1.5 text-muted-foreground">Off</span>
        <span
          className="rounded-[8px] bg-card py-1.5 font-medium shadow-[0_0_0_1px_var(--input)]" /* taste-skill-ignore: the app's own fragment (data-ui) keeps its borders and shadows */
        >
          Up to $100
        </span>
        <span className="py-1.5 text-muted-foreground">Any</span>
      </div>
      <div className="mt-4 flex items-center justify-between gap-3 text-[13px]">
        <span>Pay each finished project automatically</span>
        <span className="relative h-5 w-9 shrink-0 rounded-full bg-brand">
          <span className="absolute top-0.5 right-0.5 size-4 rounded-full bg-card" />
        </span>
      </div>
      <div className="mt-4 grid gap-2 text-[13px]">
        <p className="flex justify-between">
          <span className="text-muted-foreground">Payday</span>
          <span>Tuesday, every week</span>
        </p>
        <p className="flex justify-between">
          <span className="text-muted-foreground">Second admin above</span>
          <span className="font-tabular">$1,000</span>
        </p>
      </div>
    </Frag>
  );
}

function PayPage() {
  return (
    <Frag className="w-[300px] p-5">
      <p className="text-[13px] text-muted-foreground">Walk Crew</p>
      <p className="font-heading text-[18px]">Logo and brand kit</p>
      <p className="mt-3 font-heading font-tabular text-[36px] leading-none">{usd(s.deposit.totalMinor)}</p>
      <div className="mt-4 grid gap-1.5 text-[13px]">
        <p className="flex justify-between">
          <span className="text-muted-foreground">Deposit, 50% of the quote</span>
          <span className="font-tabular">{usd(s.deposit.quotePartMinor)}</span>
        </p>
        <p className="flex justify-between">
          <span className="text-muted-foreground">Management fee, 10%</span>
          <span className="font-tabular">{usd(s.deposit.managementFeeMinor)}</span>
        </p>
      </div>
      <span className="mt-4 flex h-10 items-center justify-center bg-brand text-[13px] font-semibold text-brand-foreground bowl">
        Pay with PayPal
      </span>
      <p className="mt-2 text-[13px] text-muted-foreground">No account needed.</p>
    </Frag>
  );
}

function Earnings() {
  return (
    <Frag className="w-[300px] p-5">
      <p className="text-[13px] font-medium">Amadou's earnings</p>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <div>
          <p className="text-[13px] text-muted-foreground">Available</p>
          <p className="font-heading font-tabular text-[24px]">{usd(earningsMinor)}</p>
        </div>
        <div>
          <p className="text-[13px] text-muted-foreground">Paid out</p>
          <p className="font-heading font-tabular text-[24px]">$1,304.30</p>
        </div>
      </div>
      <span className="mt-4 flex h-10 items-center justify-center bg-foreground text-[13px] font-medium text-background bowl">
        Request {usd(earningsMinor)}
      </span>
      <p className="mt-2 text-[13px] text-muted-foreground">
        You'll receive {usd(s.memberReceivesMinor)} after PayPal's {usd(s.payoutFeeMinor)} fee.
      </p>
    </Frag>
  );
}

function DisputeDraft() {
  return (
    <Frag className="w-[340px] p-5">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-[13px] font-medium">Case: not as described</p>
        <Status tone="muted">Needs your reply</Status>
      </div>
      <p className="mt-3 rounded-[10px] bg-tray px-3 py-2 text-[13px]">"The colours don't match the brief."</p>
      <p className="mt-3 text-[13px] text-muted-foreground">Drafted reply</p>
      <p className="mt-1 text-[13px] leading-relaxed">
        Thanks for flagging this. We'll send revised colours by Friday, at no extra cost.
      </p>
      <div className="mt-4 flex gap-2">
        <span className="flex h-9 items-center bg-foreground px-4 text-[13px] font-medium text-background bowl">
          Approve and send
        </span>
        <span className="flex h-9 items-center px-3 text-[13px] text-muted-foreground">Edit</span>
      </div>
    </Frag>
  );
}

function ChatPlugin() {
  return (
    <div data-ui className="w-[620px] lg:w-full">
      <p className="ml-auto w-fit max-w-[360px] rounded-[16px] bg-field-3 px-4 py-2.5 text-[15px] text-field-3-ink">
        I need a logo for my bakery, under $900.
      </p>
      <div className="mt-4 grid grid-cols-2 gap-3">
        {[
          ["Logo and brand kit", "$400 – $900", "7–14 days"],
          ["Logo refresh", "$150", "1–7 days"],
        ].map(([name, price, days]) => (
          <Frag key={name} className="p-4">
            <p className="text-[15px] font-semibold">{name}</p>
            <p className="font-tabular text-[15px]">{price}</p>
            <p className="text-[13px] text-muted-foreground">Walk Crew · usually {days}</p>
            <span className="mt-3 inline-flex h-9 items-center bg-brand px-4 text-[13px] font-semibold text-brand-foreground bowl">
              Request a quote
            </span>
          </Frag>
        ))}
      </div>
    </div>
  );
}

function StoreOrders() {
  const orders = [
    ["Icon pack", "$19.00", "ChatGPT"],
    ["Preset bundle", "$29.00", "your store"],
    ["Font licence", "$12.00", "Claude"],
  ] as const;
  return (
    <Frag className="w-[340px] p-4">
      <ul className="grid gap-2.5 text-[13px]">
        {orders.map(([name, price, via]) => (
          <li key={name} className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-baseline gap-3">
            <span>
              <span className="font-medium">{name}</span>
              <span className="text-muted-foreground"> · via {via}</span>
            </span>
            <span className="font-tabular">{price}</span>
            <Status>Paid</Status>
          </li>
        ))}
      </ul>
    </Frag>
  );
}

type Tile = { name: string; line: string; place: string; field: string; frag: React.ReactNode; fill?: boolean };

const TILES: Tile[] = [
  {
    name: "Every project, start to finish",
    line: "Quotes, amendments, payments and deliveries on one page, for you and for your client.",
    place: "md:col-span-2 lg:col-start-5 lg:col-span-8 lg:row-start-1 lg:row-span-4",
    field: "bg-field-1 text-field-1-ink",
    frag: <ProjectPage />,
    fill: true,
  },
  {
    name: "Payout rules",
    line: "Approve each payout, or let a rule do it.",
    place: "lg:col-start-1 lg:col-span-4 lg:row-start-3 lg:row-span-3",
    field: "bg-field-3 text-field-3-ink",
    frag: <PayoutRules />,
  },
  {
    name: "Pay pages",
    line: "The client pays with PayPal from a link.",
    place: "lg:col-start-5 lg:col-span-4 lg:row-start-5 lg:row-span-3",
    field: "bg-field-2 text-field-2-ink",
    frag: <PayPage />,
  },
  {
    name: "Every freelancer's share",
    line: "Members see what they've earned and ask for it.",
    place: "lg:col-start-9 lg:col-span-4 lg:row-start-5 lg:row-span-3",
    field: "bg-field-1 text-field-1-ink",
    frag: <Earnings />,
  },
  {
    name: "Disputes, drafted",
    line: "An agent drafts the reply. You approve it.",
    place: "lg:col-start-1 lg:col-span-4 lg:row-start-6 lg:row-span-3",
    field: "bg-field-2 text-field-2-ink",
    frag: <DisputeDraft />,
  },
  {
    name: "Found in Claude and ChatGPT",
    line: "Clients ask an AI for help, find your services and request a quote in the chat.",
    place: "md:col-span-2 lg:col-start-5 lg:col-span-8 lg:row-start-8 lg:row-span-3",
    field: "bg-field-4 text-field-4-ink",
    frag: <ChatPlugin />,
    fill: true,
  },
  {
    name: "A store on the side",
    line: "Sell downloads on your page and to AI shoppers.",
    place: "lg:col-start-1 lg:col-span-4 lg:row-start-9 lg:row-span-2",
    field: "bg-field-1 text-field-1-ink",
    frag: <StoreOrders />,
  },
];

export default function Board() {
  return (
    <section aria-labelledby="board-heading" className="px-4">
      <div className="grid grid-cols-[minmax(0,1fr)] gap-2 md:grid-cols-2 lg:auto-rows-[120px] lg:grid-cols-12">
        <div className="relative flex min-h-[260px] flex-col justify-between overflow-hidden bg-stage p-7 text-stage-ink md:col-span-2 lg:col-span-4 lg:col-start-1 lg:row-span-2 lg:row-start-1 lg:min-h-0">
          <h2 id="board-heading" data-reveal className="font-heading text-[clamp(36px,3.4vw,56px)] leading-[1]">
            Built for paid work
          </h2>
          <p data-reveal style={{ "--i": 1 }} className="relative z-10 mt-6 max-w-[30ch] text-[17px]">
            Everything between the first quote and the last payout, in one workspace.
          </p>
          <span aria-hidden="true" className="absolute -right-10 -bottom-10 size-28 bg-brand bowl" />
        </div>
        {TILES.map((tile, i) => (
          <article
            key={tile.name}
            data-reveal
            style={{ "--i": i % 3 }}
            className={`group relative flex min-h-[400px] flex-col overflow-hidden lg:min-h-0 ${tile.place} ${tile.field}`}
          >
            <div className="relative z-10 p-6 pb-0">
              <h3 className="text-[17px] font-semibold">{tile.name}</h3>
              <p className="mt-1 max-w-[46ch] text-[15px] opacity-80">{tile.line}</p>
            </div>
            <div className="relative mt-5 flex-1">
              <div className={`absolute top-0 left-6 transition-[translate] ${tile.fill ? "lg:right-6" : ""} duration-200 ease-out [@media(hover:hover)]:group-hover:-translate-y-1.5`}>
                {tile.frag}
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
