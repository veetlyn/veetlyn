"use client";

import { Bubble, BubbleContent } from "@jendal-workspace/ui/components/bubble";
import { Button } from "@jendal-workspace/ui/components/button";
import { Checkbox } from "@jendal-workspace/ui/components/checkbox";
import { Label } from "@jendal-workspace/ui/components/label";
import { Message, MessageContent, MessageGroup, MessageHeader } from "@jendal-workspace/ui/components/message";
import { Textarea } from "@jendal-workspace/ui/components/textarea";
import { type FormEvent, type ReactNode, useId, useState } from "react";

export type ThreadMessage = {
  id: string;
  kind: "text" | "question" | "answer" | "event";
  authorKind: "client" | "member" | "system";
  authorName: string;
  body: string;
  originalBody?: string | null;
  replyToId: string | null;
  createdAt: Date | string;
};

const MAX_MESSAGE = 4000;

const KIND_LABELS = { text: "", question: " · Question", answer: " · Answer", event: "" } satisfies Record<
  ThreadMessage["kind"],
  string
>;

function when(createdAt: Date | string): string {
  return new Date(createdAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function bubbleVariant(mine: boolean, kind: ThreadMessage["kind"]): "tinted" | "outline" | "muted" {
  if (mine) return "tinted";
  return kind === "question" ? "outline" : "muted";
}

// One conversation, oldest first: people's messages as bubbles, platform events as quiet lines, answers next
// to the question they answer.
export function ConversationThread<M extends ThreadMessage>({
  messages,
  isMine,
  empty,
  renderAfter,
}: {
  messages: readonly M[];
  isMine: (message: M) => boolean;
  empty: string;
  renderAfter?: (message: M) => ReactNode;
}) {
  if (messages.length === 0) return <p className="text-sm text-muted-foreground">{empty}</p>;
  const questions = new Map(messages.filter((m) => m.kind === "question").map((m) => [m.id, m]));
  return (
    <MessageGroup className="gap-3">
      {messages.map((message) => {
        if (message.kind === "event") {
          return (
            <p key={message.id} className="text-center text-sm text-muted-foreground">
              {message.body} <span className="whitespace-nowrap">· {when(message.createdAt)}</span>
            </p>
          );
        }
        const mine = isMine(message);
        const question = message.replyToId ? questions.get(message.replyToId) : undefined;
        const label = KIND_LABELS[message.kind];
        return (
          <Message key={message.id} align={mine ? "end" : "start"}>
            <MessageContent>
              <MessageHeader>
                {message.authorName}
                {label} · {when(message.createdAt)}
              </MessageHeader>
              {question ? (
                <p className="px-2.5 text-sm text-muted-foreground">Re: {question.body.slice(0, 120)}</p>
              ) : null}
              <Bubble variant={bubbleVariant(mine, message.kind)} align={mine ? "end" : "start"}>
                <BubbleContent className="text-sm whitespace-pre-wrap">{message.body}</BubbleContent>
              </Bubble>
              {message.originalBody ? (
                <p className="px-2.5 text-sm text-muted-foreground">
                  As written (admins only): <span className="whitespace-pre-wrap">{message.originalBody}</span>
                </p>
              ) : null}
              {renderAfter?.(message)}
            </MessageContent>
          </Message>
        );
      })}
    </MessageGroup>
  );
}

// The message box names who reads what is sent (conversations design §7).
export function Composer({
  audience,
  onSend,
  busy,
  error,
  allowQuestion,
  teamOnlyChoice,
  label = "Message",
}: {
  audience: string;
  onSend: (draft: { body: string; question: boolean; teamOnly: boolean }) => Promise<void>;
  busy: boolean;
  error: string | null;
  allowQuestion?: boolean;
  teamOnlyChoice?: string;
  label?: string;
}) {
  const id = useId();
  const [body, setBody] = useState("");
  const [question, setQuestion] = useState(false);
  const [teamOnly, setTeamOnly] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!body.trim() || busy) return;
    try {
      await onSend({ body: body.trim(), question, teamOnly });
      setBody("");
      setQuestion(false);
    } catch {
      // The caller shows the error; the draft stays so nothing typed is lost.
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Textarea id={id} value={body} maxLength={MAX_MESSAGE} rows={3} onChange={(e) => setBody(e.target.value)} />
      <p className="text-sm text-muted-foreground">{teamOnly ? "Only the team reads this." : audience}</p>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {allowQuestion ? (
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={question} onCheckedChange={(checked) => setQuestion(checked === true)} />
            Ask it as a question for the client
          </label>
        ) : null}
        {teamOnlyChoice ? (
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={teamOnly} onCheckedChange={(checked) => setTeamOnly(checked === true)} />
            {teamOnlyChoice}
          </label>
        ) : null}
        <Button type="submit" disabled={!body.trim() || busy} className="ml-auto">
          {busy ? "Sending…" : "Send"}
        </Button>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </form>
  );
}
