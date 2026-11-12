import { z } from "zod";

// The assistant's answer UI (agent-to-UI): the model presents structured blocks with the `present` tool, the server
// turns them into a json-render spec stored on the answer, and the dashboard renders that spec with its own
// components (apps/web/src/components/agent-answer.tsx). These props schemas are the single source of truth: the tool's
// input, the stored spec and the web catalog all read them. The file holds only zod, so the web bundle can import it.

// What a row can point at. The web builds the link from the kind and id; the model never writes a URL.
export const ANSWER_RECORD_KINDS = ["project", "request", "payout", "payment", "order", "dispute", "service", "product", "member"] as const;
export type AnswerRecordKind = (typeof ANSWER_RECORD_KINDS)[number];

export const ANSWER_TONES = ["attention", "waiting", "done", "neutral"] as const;

const words = (max: number) => z.string().trim().min(1).max(max);
// Record ids from tool results; anything else is dropped rather than linked.
const recordId = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const currency = z.string().regex(/^[A-Z]{3}$/);
const amountMinor = z.number().int().min(-1_000_000_000_000).max(1_000_000_000_000);

export const figuresProps = z.object({
  items: z
    .array(
      z.object({
        label: words(60).describe("What the figure is, e.g. 'Payouts to approve'."),
        amountMinor: amountMinor.optional().describe("A money figure in integer minor units, exactly as the tool returned it."),
        currency: currency.optional().describe("The record's ISO currency, e.g. USD. Required with amountMinor."),
        value: words(40).optional().describe("A count or other non-money figure, e.g. '2'."),
        hint: words(80).optional().describe("One short line under the figure, e.g. '1 request'."),
      }),
    )
    .min(1)
    .max(4),
});

export const recordsProps = z.object({
  title: words(60).optional().describe("A short heading, e.g. 'Needs your answer'."),
  items: z
    .array(
      z.object({
        kind: z.enum(ANSWER_RECORD_KINDS),
        id: recordId.optional().describe("The record's id from the tool result, so the row links to it."),
        title: words(100).describe("The record's name only, e.g. the project title; never its amount or status."),
        detail: words(160).optional().describe("Who it is for and what is going on, in a few words."),
        status: words(40).optional().describe("Its status in plain words, e.g. 'Waiting for approval'."),
        tone: z.enum(ANSWER_TONES).optional().describe("attention: the person must act; waiting: on someone else; done: settled."),
        amountMinor: amountMinor.optional(),
        currency: currency.optional(),
      }),
    )
    .min(1)
    .max(8),
});

export const tableProps = z.object({
  title: words(60).optional(),
  columns: z
    .array(z.object({ label: words(40), align: z.enum(["left", "right"]).optional().describe("right for amounts and counts.") }))
    .min(2)
    .max(5),
  rows: z
    .array(z.array(z.string().max(80)).describe("One cell per column, already written for people: '$125.00', 'Nov 2'."))
    .min(1)
    .max(12),
});

export const calloutProps = z.object({
  tone: z.enum(["info", "warning", "success"]),
  title: words(80).optional(),
  text: words(300),
});

export const nextStepsProps = z.object({
  items: z
    .array(
      z.object({
        label: words(80).describe("What to do, e.g. 'Review the $127.50 payout'."),
        kind: z.enum(ANSWER_RECORD_KINDS).optional(),
        id: recordId.optional(),
      }),
    )
    .min(1)
    .max(4),
});

export const answerBlock = z.discriminatedUnion("type", [
  figuresProps.extend({ type: z.literal("figures") }).describe("Up to 4 headline figures side by side."),
  recordsProps.extend({ type: z.literal("records") }).describe("A list of records: projects, requests, payouts…"),
  tableProps.extend({ type: z.literal("table") }).describe("A comparison with columns, e.g. quotes side by side."),
  calloutProps.extend({ type: z.literal("callout") }).describe("One thing that must not be missed: a risk or a blocker."),
  nextStepsProps.extend({ type: z.literal("next") }).describe("The person's next steps, most important first."),
]);
export type AnswerBlock = z.output<typeof answerBlock>;

export const MAX_ANSWER_BLOCKS = 5;
export const presentInput = z.object({ blocks: z.array(answerBlock).min(1).max(MAX_ANSWER_BLOCKS) });

// The json-render spec of an answer: one Answer root whose children are the blocks, in order. Stored as JSON, so its
// props are plain JSON; readers check them again against the props schema of their type.
export const ANSWER_COMPONENT = { figures: "Figures", records: "Records", table: "Table", callout: "Callout", next: "NextSteps" } as const;
const jsonProps = z.record(z.string(), z.json());
export const answerSpec = z.object({
  root: z.string(),
  elements: z.record(z.string(), z.object({ type: z.string(), props: jsonProps, children: z.array(z.string()) })),
});
export type AnswerSpec = z.output<typeof answerSpec>;
type AnswerElement = AnswerSpec["elements"][string];

// Which read tools return records of each kind, so a row links only to an id that a tool returned as that kind.
export const ID_SOURCES = {
  project: ["project_list", "project_get", "request_list_open", "project_client_list"],
  request: ["project_list", "project_get", "request_list_open"],
  payout: ["payout_list", "payout_mine"],
  service: [],
  product: ["product_list"],
  payment: [],
  order: [],
  dispute: [],
  member: [],
} satisfies Record<AnswerRecordKind, readonly string[]>;

// The ids of the records a tool returned: the result's own id, and the id of each item in its top-level lists. Ids
// nested deeper (a payout's project) belong to other kinds, so they are not collected.
const withId = z.object({ id: recordId });
const toolResult = z
  .string()
  .transform((text, ctx) => {
    try {
      return JSON.parse(text);
    } catch {
      ctx.addIssue({ code: "custom", message: "The tool result is not JSON." });
      return z.NEVER;
    }
  })
  .pipe(z.union([z.array(z.json()), z.record(z.string(), z.json())]));
export function recordIdsIn(result: string): string[] {
  const parsed = toolResult.safeParse(result);
  if (!parsed.success) return [];
  const value = parsed.data;
  const lists = Array.isArray(value) ? [value] : Object.values(value).filter(Array.isArray);
  return [withId.safeParse(value).data?.id, ...lists.flat().map((item) => withId.safeParse(item).data?.id)].filter((id) => id !== undefined);
}

// Every free-text field passes through `clean` (the output guard) before it is stored. Money without a currency is
// dropped, never guessed; table rows are fitted to their columns; an id `known` does not vouch for is dropped, so the
// row opens its list instead of a wrong page.
export function blocksToSpec(
  blocks: readonly AnswerBlock[],
  clean: (text: string) => string,
  known: (kind: AnswerRecordKind, id: string) => boolean = () => true,
): AnswerSpec | null {
  const idFor = (kind: AnswerRecordKind | undefined, id: string | undefined) => (kind && id && known(kind, id) ? id : undefined);
  const tidy = (text: string | undefined) => {
    if (text === undefined) return undefined;
    const value = clean(text);
    return value === "" ? undefined : value;
  };
  const money = <T extends { amountMinor?: number; currency?: string }>(item: T) =>
    item.amountMinor !== undefined && item.currency ? { amountMinor: item.amountMinor, currency: item.currency } : {};
  const elements: AnswerSpec["elements"] = {};
  const children: string[] = [];
  blocks.slice(0, MAX_ANSWER_BLOCKS).forEach((block, index) => {
    let props: object | null = null;
    if (block.type === "figures") {
      const items = block.items
        .map((item) => ({ label: tidy(item.label), value: tidy(item.value), hint: tidy(item.hint), ...money(item) }))
        .filter((item) => item.label && (item.value || "amountMinor" in item));
      props = items.length > 0 ? { items } : null;
    } else if (block.type === "records") {
      const items = block.items
        .map((item) => ({
          kind: item.kind,
          id: idFor(item.kind, item.id),
          title: tidy(item.title),
          detail: tidy(item.detail),
          status: tidy(item.status),
          tone: item.tone,
          ...money(item),
        }))
        .filter((item) => item.title);
      props = items.length > 0 ? { title: tidy(block.title), items } : null;
    } else if (block.type === "table") {
      const columns = block.columns.map((column) => ({ label: tidy(column.label) ?? "", align: column.align ?? "left" }));
      const rows = block.rows.map((row) => columns.map((_, i) => tidy(row[i]) ?? ""));
      props = { title: tidy(block.title), columns, rows };
    } else if (block.type === "callout") {
      const text = tidy(block.text);
      props = text ? { tone: block.tone, title: tidy(block.title), text } : null;
    } else {
      const items = block.items.map((item) => ({ label: tidy(item.label), kind: item.kind, id: idFor(item.kind, item.id) })).filter((item) => item.label);
      props = items.length > 0 ? { items } : null;
    }
    if (!props) return;
    const key = `${block.type}-${index}`;
    // A JSON round trip drops the fields left undefined, so the stored props are exactly what was shown.
    const element: AnswerElement = { type: ANSWER_COMPONENT[block.type], props: jsonProps.parse(JSON.parse(JSON.stringify(props))), children: [] };
    elements[key] = element;
    children.push(key);
  });
  if (children.length === 0) return null;
  elements.answer = { type: "Answer", props: {}, children };
  return { root: "answer", elements };
}

// A one-line trace of what an answer showed, so the next turn's model knows without rereading the blocks.
export function specSummary(spec: AnswerSpec): string {
  return spec.elements[spec.root]?.children.map((key) => spec.elements[key]?.type).filter(Boolean).join(", ") ?? "";
}
