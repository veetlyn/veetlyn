"use client";

import { defineCatalog } from "@json-render/core";
import { defineRegistry, JSONUIProvider, Renderer, type Spec } from "@json-render/react";
import { schema } from "@json-render/react/schema";
import type { JsonObject } from "@jendal-workspace/core";
import {
  ANSWER_COMPONENT,
  answerSpec,
  type AnswerRecordKind,
  calloutProps,
  figuresProps,
  nextStepsProps,
  recordsProps,
  tableProps,
} from "@jendal-workspace/api/agent/answer-ui";
import { Badge } from "@jendal-workspace/ui/components/badge";
import { Alert, AlertContent, AlertDescription, AlertIcon, AlertTitle } from "@jendal-workspace/ui/components/motion/alert";
import { Table } from "@jendal-workspace/ui/components/motion/table";
import { cn } from "@jendal-workspace/ui/lib/utils";
import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { createContext, type ReactNode, useContext, useMemo } from "react";
import { z } from "zod";

import { formatMinor } from "@/lib/money";

// Agent-to-UI: the json-render catalog of the assistant's answer blocks, drawn with the dashboard's own beUI pieces.
// The server builds the spec from the model's `present` call (packages/api/src/agent/answer-ui.ts); each element is
// checked again here against the same props schema, and an element that does not fit is left out rather than drawn.
export const answerCatalog = defineCatalog(schema, {
  components: {
    Answer: { props: z.object({}), description: "The blocks under one answer, in reading order." },
    Figures: { props: figuresProps, description: "Up to four headline figures side by side." },
    Records: { props: recordsProps, description: "Records the person can open: projects, requests, payouts…" },
    Table: { props: tableProps, description: "A side-by-side comparison." },
    Callout: { props: calloutProps, description: "The one risk or blocker that must not be missed." },
    NextSteps: { props: nextStepsProps, description: "What to do next, most important first." },
  },
  actions: {},
});

const PROPS_BY_TYPE = new Map<string, z.ZodType>([
  [ANSWER_COMPONENT.figures, figuresProps],
  [ANSWER_COMPONENT.records, recordsProps],
  [ANSWER_COMPONENT.table, tableProps],
  [ANSWER_COMPONENT.callout, calloutProps],
  [ANSWER_COMPONENT.next, nextStepsProps],
]);

// The team the answer belongs to, for building record links; null above the sellers, where rows stay plain text.
const AnswerTeam = createContext<string | null>(null);

function hrefFor(teamSlug: string | null, kind: AnswerRecordKind | undefined, id: string | undefined): string | null {
  if (!teamSlug || !kind) return null;
  const base = `/${encodeURIComponent(teamSlug)}`;
  // Kinds whose id is their page; the rest open their list.
  if (id && (kind === "project" || kind === "request")) return `${base}/projects/${encodeURIComponent(id)}`;
  if (id && kind === "payout") return `${base}/payouts/${encodeURIComponent(id)}`;
  if (id && kind === "service") return `${base}/services/${encodeURIComponent(id)}`;
  if (id && kind === "product") return `${base}/products/${encodeURIComponent(id)}`;
  const lists = {
    project: "projects",
    request: "orders",
    payout: "payouts",
    payment: "payments",
    order: "orders",
    dispute: "cases",
    service: "services",
    product: "products",
    member: "members",
  } satisfies Record<AnswerRecordKind, string>;
  return `${base}/${lists[kind]}`;
}

function Money({ amountMinor, currency, className }: { amountMinor?: number; currency?: string; className?: string }) {
  if (amountMinor === undefined || !currency) return null;
  return <span className={cn("font-tabular whitespace-nowrap", className)}>{formatMinor(amountMinor, currency)}</span>;
}

function BlockTitle({ children }: { children?: ReactNode }) {
  return children ? <h3 className="text-[13px] font-medium text-muted-foreground">{children}</h3> : null;
}

const TONE_BADGE = { attention: "brand", waiting: "neutral", done: "good", neutral: "neutral" } as const;

const ROW_HEIGHT = 44;
const HEADER_HEIGHT = 44;

const { registry } = defineRegistry(answerCatalog, {
  components: {
    Answer: ({ children }) => <div className="grid gap-5">{children}</div>,

    Figures: ({ props }) => (
      <div className={cn("grid gap-3", props.items.length === 1 ? "grid-cols-1" : props.items.length === 3 ? "grid-cols-2 sm:grid-cols-3" : "grid-cols-2")}>
        {props.items.map((item, i) => (
          <div key={i} className="grid content-start gap-1 rounded-[10px] border bg-card px-4 py-3.5">
            <span className="text-[13px] text-muted-foreground">{item.label}</span>
            <span className="font-heading text-[22px] leading-7 tracking-[-0.01em]">
              {item.amountMinor !== undefined && item.currency ? <Money amountMinor={item.amountMinor} currency={item.currency} /> : <span className="font-tabular">{item.value}</span>}
            </span>
            {item.hint ? <span className="text-xs text-muted-foreground">{item.hint}</span> : null}
          </div>
        ))}
      </div>
    ),

    Records: ({ props }) => {
      const teamSlug = useContext(AnswerTeam);
      return (
        <section className="grid gap-2">
          <BlockTitle>{props.title}</BlockTitle>
          <ul className="divide-y overflow-hidden rounded-[10px] border bg-card">
            {props.items.map((item, i) => {
              const href = item.id ? hrefFor(teamSlug, item.kind, item.id) : null;
              return (
                <li key={i} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-0.5 px-4 py-3">
                  <div className="grid min-w-0 gap-0.5">
                    {href ? (
                      <Link href={href} className="truncate text-sm font-medium underline-offset-4 hover:underline">
                        {item.title}
                      </Link>
                    ) : (
                      <span className="truncate text-sm font-medium">{item.title}</span>
                    )}
                    {item.detail ? <span className="text-[13px] leading-5 text-muted-foreground">{item.detail}</span> : null}
                  </div>
                  <div className="grid justify-items-end gap-0.5 text-right">
                    <Money amountMinor={item.amountMinor} currency={item.currency} className="text-sm font-medium" />
                    {item.status ? <Badge tone={TONE_BADGE[item.tone ?? "neutral"]}>{item.status}</Badge> : null}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      );
    },

    Table: ({ props }) => {
      const columns = props.columns.map((column, i) => ({
        key: `c${i}`,
        header: column.label,
        align: column.align === "right" ? ("right" as const) : ("left" as const),
        cell: (row: { cells: string[] }) => <span className={cn("truncate", column.align === "right" && "font-tabular")}>{row.cells[i]}</span>,
      }));
      const data = props.rows.map((row, r) => ({ id: String(r), cells: row }));
      return (
        <section className="grid gap-2">
          <BlockTitle>{props.title}</BlockTitle>
          <Table data={data} columns={columns} getRowId={(row) => row.id} rowHeight={ROW_HEIGHT} height={data.length * ROW_HEIGHT + HEADER_HEIGHT} className="rounded-[10px]" />
        </section>
      );
    },

    Callout: ({ props }) => (
      <Alert variant={props.tone} defaultOpen className="rounded-[10px]" contentClassName="px-4 py-3">
        <AlertIcon />
        <AlertContent>
          {props.title ? <AlertTitle>{props.title}</AlertTitle> : null}
          <AlertDescription className="text-foreground">{props.text}</AlertDescription>
        </AlertContent>
      </Alert>
    ),

    NextSteps: ({ props }) => {
      const teamSlug = useContext(AnswerTeam);
      return (
        <section className="grid gap-2">
          <BlockTitle>Next</BlockTitle>
          <ol className="grid gap-1.5">
            {props.items.map((item, i) => {
              const href = hrefFor(teamSlug, item.kind, item.id);
              const label = (
                <>
                  <span aria-hidden className="grid size-5 shrink-0 place-items-center rounded-full bg-secondary font-tabular text-[11px] font-medium">
                    {i + 1}
                  </span>
                  <span className="min-w-0">{item.label}</span>
                  {href ? <ArrowRight aria-hidden className="ml-auto size-3.5 shrink-0 text-muted-foreground" /> : null}
                </>
              );
              return (
                <li key={i}>
                  {href ? (
                    <Link href={href} className="flex items-center gap-2.5 rounded-[8px] px-2 py-1.5 text-sm hover:bg-secondary">
                      {label}
                    </Link>
                  ) : (
                    <span className="flex items-center gap-2.5 px-2 py-1.5 text-sm">{label}</span>
                  )}
                </li>
              );
            })}
          </ol>
        </section>
      );
    },
  },
});

// A stored spec as far as it can be trusted: its root, and only the children whose type is in the catalog and whose
// props still fit that type's schema.
export function checkedAnswerSpec(ui: JsonObject): Spec | null {
  const parsed = answerSpec.safeParse(ui);
  if (!parsed.success) return null;
  const { root, elements } = parsed.data;
  const rootElement = elements[root];
  if (rootElement?.type !== "Answer") return null;
  const kept: Spec["elements"] = {};
  const children = rootElement.children.filter((key) => {
    const element = elements[key];
    if (!element || !PROPS_BY_TYPE.get(element.type)?.safeParse(element.props).success) return false;
    kept[key] = { type: element.type, props: element.props, children: [] };
    return true;
  });
  if (children.length === 0) return null;
  kept[root] = { type: "Answer", props: {}, children };
  return { root, elements: kept };
}

export default function AgentAnswer({ ui, teamSlug }: { ui: JsonObject; teamSlug?: string }) {
  const spec = useMemo(() => checkedAnswerSpec(ui), [ui]);
  if (!spec) return null;
  return (
    <AnswerTeam.Provider value={teamSlug ?? null}>
      <JSONUIProvider registry={registry}>
        <Renderer spec={spec} registry={registry} />
      </JSONUIProvider>
    </AnswerTeam.Provider>
  );
}
