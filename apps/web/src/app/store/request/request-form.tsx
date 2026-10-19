"use client";

import { nativeSelectClass } from "@jendal-workspace/ui/lib/native-select";
import { validateQuoteRequest } from "@jendal-workspace/core";
import { Button } from "@jendal-workspace/ui/components/button";
import { Input } from "@jendal-workspace/ui/components/input";
import { Label } from "@jendal-workspace/ui/components/label";
import { Textarea } from "@jendal-workspace/ui/components/textarea";
import { useMutation } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";

import { daysLabel, priceLabel } from "@/lib/offering-labels";
import type { SellerPageView } from "@/lib/server-api";
import { trpc } from "@/utils/trpc";

const SELECT_CLASS = `w-full ${nativeSelectClass}`;

// The quote request form on the seller page (services spec §4.2). The offering select pre-fills
// from ?offering= when the visitor came from a service card on the seller page.
export default function RequestForm({
  page,
  preselectedOfferingId,
}: {
  page: SellerPageView;
  preselectedOfferingId: string | null;
}) {
  const [offeringId, setOfferingId] = useState<string | null>(
    page.offerings.some((offering) => offering.id === preselectedOfferingId) ? preselectedOfferingId : null,
  );
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [description, setDescription] = useState("");
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [website, setWebsite] = useState("");
  const [done, setDone] = useState(false);
  // Client-side problems wait until the visitor tries to submit; the server stays the authority.
  const [touched, setTouched] = useState(false);

  const requestQuote = useMutation(trpc.project.requestQuote.mutationOptions({ onSuccess: () => setDone(true) }));

  const offering = page.offerings.find((candidate) => candidate.id === offeringId) ?? null;
  const questions = offering?.intakeQuestions ?? [];
  const answersList = questions.map((question) => ({ question, answer: answers[question] ?? "" }));
  const problem = validateQuoteRequest({ name, email, description, answers: answersList }).at(0);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setTouched(true);
    if (problem !== undefined || requestQuote.isPending) return;
    requestQuote.mutate({
      slug: page.slug,
      offeringId,
      name,
      email,
      description,
      answers: answersList,
      website,
    });
  }

  if (done) {
    return (
      <main className="mx-auto w-full max-w-2xl space-y-3 px-4 py-6 md:px-7 md:py-10">
        <h1 className="font-[family-name:var(--font-display)] text-3xl">Request sent</h1>
        <p className="text-sm text-muted-foreground">
          We emailed {email} a link to your page. It is how you follow the request and answer the team.
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-6 md:px-7 md:py-10">
      <a href="/" className="mb-4 inline-flex text-sm text-muted-foreground hover:text-foreground">
        ← {page.name}
      </a>
      <div className="space-y-1">
        <h1 className="font-[family-name:var(--font-display)] text-3xl">Request a quote from {page.name}</h1>
        {offering ? (
          <p className="text-sm text-muted-foreground">
            Usually {priceLabel(offering, page.currency)} · {daysLabel(offering)}
          </p>
        ) : null}
      </div>
      <form onSubmit={handleSubmit} className="panel mt-6 grid gap-6 p-5 md:p-6">
        <div className="space-y-2">
          <Label htmlFor="request-offering">Service</Label>
          <select
            id="request-offering"
            className={SELECT_CLASS}
            value={offeringId ?? ""}
            onChange={(event) => {
              requestQuote.reset();
              setOfferingId(event.target.value === "" ? null : event.target.value);
            }}
          >
            <option value="">Something else</option>
            {page.offerings.map((offering) => (
              <option key={offering.id} value={offering.id}>
                {offering.name}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="request-description">What do you need?</Label>
          <Textarea
            id="request-description"
            rows={5}
            value={description}
            onChange={(event) => {
              requestQuote.reset();
              setDescription(event.target.value);
            }}
            required
          />
        </div>
        {questions.map((question, index) => (
          <div key={question} className="space-y-2">
            <Label htmlFor={`request-answer-${index}`}>{question}</Label>
            <Input
              id={`request-answer-${index}`}
              value={answers[question] ?? ""}
              onChange={(event) => {
                requestQuote.reset();
                setAnswers({ ...answers, [question]: event.target.value });
              }}
            />
          </div>
        ))}
        <div className="space-y-2">
          <Label htmlFor="request-name">Your name</Label>
          <Input
            id="request-name"
            value={name}
            onChange={(event) => {
              requestQuote.reset();
              setName(event.target.value);
            }}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="request-email">Your email</Label>
          <Input
            id="request-email"
            type="email"
            value={email}
            onChange={(event) => {
              requestQuote.reset();
              setEmail(event.target.value);
            }}
            required
          />
        </div>
        {/* Honeypot: invisible to people, filled by bots */}
        <div className="hidden">
          <input
            name="website"
            tabIndex={-1}
            autoComplete="off"
            aria-hidden="true"
            value={website}
            onChange={(event) => setWebsite(event.target.value)}
          />
        </div>
        {touched && problem ? (
          <p role="alert" className="text-sm text-destructive">
            {problem}
          </p>
        ) : null}
        {requestQuote.error ? (
          <p role="alert" className="text-sm text-destructive">
            {requestQuote.error.message}
          </p>
        ) : null}
        <Button type="submit" disabled={requestQuote.isPending} className="justify-self-start">
          {requestQuote.isPending ? "Sending…" : "Send request"}
        </Button>
      </form>
    </main>
  );
}
