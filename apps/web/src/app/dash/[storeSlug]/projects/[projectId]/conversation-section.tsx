"use client";

import type { AppRouter } from "@jendal-workspace/api/routers/index";
import { Button } from "@jendal-workspace/ui/components/button";
import { Checkbox } from "@jendal-workspace/ui/components/checkbox";
import { Label } from "@jendal-workspace/ui/components/label";
import { Textarea } from "@jendal-workspace/ui/components/textarea";
import { useMutation } from "@tanstack/react-query";
import type { inferRouterOutputs } from "@trpc/server";
import { type FormEvent, useState } from "react";

import { Composer, ConversationThread } from "@/components/conversation/thread";
import { trpc } from "@/utils/trpc";

type Detail = inferRouterOutputs<AppRouter>["project"]["get"];
type Message = Detail["conversation"]["messages"][number];
type Space = "request" | "project";

const TAB_LABELS = { request: "Request", project: "Project" } satisfies Record<Space, string>;

function DeclineForm({ teamSlug, projectId, onDone }: { teamSlug: string; projectId: string; onDone: () => Promise<void> }) {
  const [reason, setReason] = useState("");
  const decline = useMutation(trpc.project.decline.mutationOptions({ onSuccess: onDone }));
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (window.confirm("Decline this request? The client reads your reason and the request closes.")) {
      decline.mutate({ teamSlug, projectId, reason });
    }
  }
  return (
    <form onSubmit={submit} className="grid gap-2">
      <Label htmlFor="decline-reason">Decline the request</Label>
      <Textarea
        id="decline-reason"
        rows={2}
        maxLength={1000}
        value={reason}
        placeholder="Why the team will not quote it"
        onChange={(e) => {
          setReason(e.target.value);
          decline.reset();
        }}
      />
      <p className="text-sm text-muted-foreground">The client sees this reason on their page and in their AI assistant.</p>
      <Button type="submit" variant="outline" className="justify-self-start" disabled={decline.isPending}>
        {decline.isPending ? "Declining…" : "Decline request"}
      </Button>
      {decline.error ? (
        <p role="alert" className="text-sm text-destructive">
          {decline.error.message}
        </p>
      ) : null}
    </form>
  );
}

// Staff replace the department rule with a shortlist; clearing every box restores it.
function ShortlistForm({
  teamSlug,
  projectId,
  members,
}: {
  teamSlug: string;
  projectId: string;
  members: { id: string; name: string; role: string }[];
}) {
  const [chosen, setChosen] = useState<string[]>([]);
  const shortlist = useMutation(trpc.project.shortlist.mutationOptions());
  const freelancers = members.filter((m) => m.role === "freelancer");
  if (freelancers.length === 0) return null;
  return (
    <fieldset className="grid gap-2">
      <legend className="text-sm font-medium">Who sees this request</legend>
      <p className="text-sm text-muted-foreground">
        Pick freelancers to replace the department rule; save with none picked to go back to it.
      </p>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {freelancers.map((member) => (
          <label key={member.id} className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={chosen.includes(member.id)}
              onCheckedChange={(checked) =>
                setChosen(checked === true ? [...chosen, member.id] : chosen.filter((id) => id !== member.id))
              }
            />
            {member.name}
          </label>
        ))}
      </div>
      <Button
        type="button"
        variant="outline"
        className="justify-self-start"
        disabled={shortlist.isPending}
        onClick={() => shortlist.mutate({ teamSlug, projectId, userIds: chosen })}
      >
        {shortlist.isPending ? "Saving…" : chosen.length > 0 ? "Save shortlist" : "Use the department rule"}
      </Button>
      {shortlist.isSuccess ? <p className="text-sm text-muted-foreground">Saved.</p> : null}
      {shortlist.error ? (
        <p role="alert" className="text-sm text-destructive">
          {shortlist.error.message}
        </p>
      ) : null}
    </fieldset>
  );
}

// Staff read the request grouped by freelancer (design §7): what each one asked, said and quoted.
function groupByFreelancer(messages: readonly Message[], quotes: Detail["quotes"]) {
  const quoteAuthor = new Map(quotes.map((q) => [q.id, q.freelancerId]));
  const questionAuthor = new Map(messages.filter((m) => m.kind === "question").map((m) => [m.id, m.authorUserId]));
  const groups = new Map<string, Message[]>();
  const rest: Message[] = [];
  const ownerOf = (message: Message): string | null | undefined => {
    if (message.kind === "event" && message.refType === "quote") return quoteAuthor.get(message.refId ?? "");
    if (message.kind === "answer") return questionAuthor.get(message.replyToId ?? "");
    return message.authorKind === "member" ? message.authorUserId : null;
  };
  for (const message of messages) {
    const owner = ownerOf(message);
    if (owner) groups.set(owner, [...(groups.get(owner) ?? []), message]);
    else rest.push(message);
  }
  return { groups, rest };
}

export function ConversationSection({
  teamSlug,
  detail,
  members,
  onChange,
}: {
  teamSlug: string;
  detail: Detail;
  members: { id: string; name: string; role: string }[];
  onChange: () => Promise<void>;
}) {
  const { conversation, project, role, viewerId, quotes } = detail;
  const readable = (["request", "project"] as const).filter((space) => conversation.access.read.includes(space));
  const [tab, setTab] = useState<Space>(
    project.status === "quoting" && readable.includes("request") ? "request" : (readable.at(-1) ?? "project"),
  );
  const post = useMutation(trpc.project.post.mutationOptions({ onSuccess: onChange }));
  if (readable.length === 0) return null;
  const staff = role !== "freelancer";
  const quoting = project.status === "quoting";
  const shown = conversation.messages.filter((m) => m.space === tab);
  const isMine = (m: Message) => m.authorKind === "member" && m.authorUserId === viewerId;
  const names = new Map(members.map((m) => [m.id, m.name]));
  const canWrite = conversation.access.write.includes(tab);

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Conversation</h2>
        {readable.length > 1 ? (
          <div role="tablist" aria-label="Conversation" className="inline-flex w-fit rounded-[10px] bg-tray p-0.5 well">
            {readable.map((space) => (
              <button
                key={space}
                type="button"
                role="tab"
                aria-selected={tab === space}
                onClick={() => setTab(space)}
                className="rounded-lg px-3 py-1.5 text-sm font-medium text-muted-foreground aria-selected:bg-card aria-selected:text-foreground aria-selected:shadow-[0_0_0_1px_var(--input),var(--raise)]"
              >
                {TAB_LABELS[space]}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {project.status === "declined" && project.declinedReason ? (
        <p className="text-sm">
          <span className="font-medium text-muted-foreground">Declined:</span> {project.declinedReason}
        </p>
      ) : null}

      <div role="tabpanel" className="panel grid gap-5 p-4">
        {tab === "request" && staff ? (
          (() => {
            const { groups, rest } = groupByFreelancer(shown, quotes);
            return (
              <>
                {[...groups.entries()].map(([userId, messages]) => (
                  <div key={userId} className="grid gap-2">
                    <h3 className="text-sm font-medium">{names.get(userId) ?? "Team member"}</h3>
                    <ConversationThread messages={messages} isMine={isMine} empty="" />
                  </div>
                ))}
                <div className="grid gap-2">
                  {groups.size > 0 ? <h3 className="text-sm font-medium">Client and staff</h3> : null}
                  <ConversationThread
                    messages={rest}
                    isMine={isMine}
                    empty={groups.size > 0 ? "Nothing else yet." : "No freelancer has answered yet."}
                  />
                </div>
              </>
            );
          })()
        ) : (
          <ConversationThread
            messages={shown}
            isMine={isMine}
            empty={tab === "request" ? "No questions or messages on this request yet." : "No messages with the client yet."}
          />
        )}

        {canWrite ? (
          <Composer
            audience={
              tab === "request"
                ? "The freelancers looking at this request and staff read this. The client reads it too, with contact details hidden until a quote is accepted."
                : "The client and the team read this."
            }
            allowQuestion
            busy={post.isPending}
            error={post.error?.message ?? null}
            onSend={async ({ body, question }) => {
              await post.mutateAsync({ teamSlug, projectId: project.id, body, kind: question ? "question" : "text", space: tab });
            }}
          />
        ) : (
          <p className="text-sm text-muted-foreground">
            {tab === "request" && !quoting ? "The request closed; the conversation continues in the project." : "This conversation is closed."}
          </p>
        )}
      </div>

      {staff && quoting ? (
        <div className="grid gap-6">
          <ShortlistForm teamSlug={teamSlug} projectId={project.id} members={members} />
          <DeclineForm teamSlug={teamSlug} projectId={project.id} onDone={onChange} />
        </div>
      ) : null}
    </section>
  );
}
