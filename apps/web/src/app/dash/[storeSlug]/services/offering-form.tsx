"use client";

import { nativeSelectClass } from "@jendal-workspace/ui/lib/native-select";
import {
  MAX_INTAKE_QUESTION_CHARS,
  MAX_INTAKE_QUESTIONS,
  MAX_OFFERING_DAYS,
  MAX_OFFERING_NAME,
  normalizeOfferingDraft,
  validateOfferingDraft,
} from "@jendal-workspace/core";
import { Button } from "@jendal-workspace/ui/components/button";
import { Checkbox } from "@jendal-workspace/ui/components/checkbox";
import { Input } from "@jendal-workspace/ui/components/input";
import { Label } from "@jendal-workspace/ui/components/label";
import { Textarea } from "@jendal-workspace/ui/components/textarea";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";

import Loader from "@/components/loader";
import TeamNotFound from "@/components/services-team/team-not-found";
import { minorToPriceInput, parsePriceInput } from "@/lib/money";
import { trpc } from "@/utils/trpc";

const SELECT_CLASS = `w-full ${nativeSelectClass}`;

type OfferingFormState = {
  name: string;
  description: string;
  departmentId: string;
  priceMin: string;
  priceMax: string;
  daysMin: string;
  daysMax: string;
  active: boolean;
  listed: boolean;
  questions: string[];
};

const EMPTY_FORM: OfferingFormState = {
  name: "",
  description: "",
  departmentId: "",
  priceMin: "",
  priceMax: "",
  daysMin: "1",
  daysMax: "7",
  active: true,
  listed: true,
  questions: [],
};

// Empty and NaN become -1, so the "whole days" rule fires instead of passing NaN to the api.
// Number (not parseInt) keeps "2.5" as 2.5, so that rule also refuses decimals.
function daysFromInput(text: string): number {
  const trimmed = text.trim();
  if (trimmed === "") return -1;
  const days = Number(trimmed);
  return Number.isNaN(days) ? -1 : days;
}

export default function OfferingForm({ teamSlug, offeringId }: { teamSlug: string; offeringId?: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const team = useQuery({ ...trpc.servicesTeam.get.queryOptions({ teamSlug }), retry: false, meta: { silent: true } });
  const catalog = useQuery({ ...trpc.servicesCatalog.list.queryOptions({ teamSlug }), retry: false, meta: { silent: true } });

  // Null until the first edit, so the offering can load late (the settings page does the same).
  const [state, setState] = useState<OfferingFormState | null>(null);
  // An empty new form already fails validation; the message waits until the admin acts.
  const [touched, setTouched] = useState(false);

  const offering = offeringId ? catalog.data?.offerings.find((candidate) => candidate.id === offeringId) : undefined;

  const saved = () => {
    void queryClient.invalidateQueries({ queryKey: trpc.servicesCatalog.list.queryKey({ teamSlug }) });
    void queryClient.invalidateQueries({ queryKey: trpc.servicesTeam.get.queryKey({ teamSlug }) });
    router.push(`/${teamSlug}/services`);
  };

  const create = useMutation(trpc.servicesCatalog.createOffering.mutationOptions({ onSuccess: saved }));
  // The api's update does not take "active", so the save chains setOfferingActive when the checkbox changed.
  const update = useMutation(trpc.servicesCatalog.updateOffering.mutationOptions());
  const setActive = useMutation(trpc.servicesCatalog.setOfferingActive.mutationOptions());
  const save = offeringId ? update : create;

  if (team.isPending || catalog.isPending) return <Loader />;
  if (team.isError) return <TeamNotFound />;
  if (catalog.isError) {
    return (
      <main className="mx-auto w-full max-w-5xl space-y-4 px-4 py-6 md:px-7 md:py-8">
        <p role="alert">The services couldn't be loaded.</p>
      </main>
    );
  }
  if (offeringId && !offering) {
    return (
      <main className="mx-auto w-full max-w-5xl space-y-4 px-4 py-6 md:px-7 md:py-8">
        <h1 className="font-heading text-3xl">Service not found</h1>
        <p className="text-sm text-muted-foreground">This service is not in your team.</p>
        <Link href={`/${teamSlug}/services`} className="text-sm underline underline-offset-4">
          Back to services
        </Link>
      </main>
    );
  }

  const role = team.data.role;
  const currency = team.data.settings?.currency ?? "USD";
  const departments = catalog.data?.departments ?? [];

  const initial: OfferingFormState = offering
    ? {
        name: offering.name,
        description: offering.description,
        departmentId: offering.departmentId ?? "",
        priceMin: minorToPriceInput(offering.priceMinMinor),
        priceMax: minorToPriceInput(offering.priceMaxMinor),
        daysMin: String(offering.daysMin),
        daysMax: String(offering.daysMax),
        active: offering.active,
        listed: offering.listed,
        questions: offering.intakeQuestions,
      }
    : EMPTY_FORM;
  const values = state ?? initial;
  const patch = (part: Partial<OfferingFormState>) => {
    save.reset();
    setActive.reset();
    setTouched(true);
    setState({ ...values, ...part });
  };

  const draft = {
    name: values.name,
    description: values.description,
    priceMinMinor: parsePriceInput(values.priceMin) ?? -1,
    priceMaxMinor: parsePriceInput(values.priceMax) ?? -1,
    daysMin: daysFromInput(values.daysMin),
    daysMax: daysFromInput(values.daysMax),
    intakeQuestions: values.questions,
  };
  const problem = validateOfferingDraft(draft).at(0);
  const canSubmit = role === "admin" && problem === undefined && !save.isPending && !setActive.isPending;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setTouched(true);
    if (!canSubmit) return;
    const payload = {
      teamSlug,
      departmentId: values.departmentId === "" ? null : values.departmentId,
      listed: values.listed,
      ...normalizeOfferingDraft(draft),
    };
    if (!offeringId) {
      create.mutate(payload);
      return;
    }
    try {
      await update.mutateAsync({ ...payload, offeringId });
      if (offering && values.active !== offering.active) {
        await setActive.mutateAsync({ teamSlug, offeringId, active: values.active });
      }
      saved();
    } catch {
      // The failing mutation's error state shows the message under the submit button.
    }
  }

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-6 md:px-7 md:py-8">
      <div className="space-y-1">
        <Link href={`/${teamSlug}/services`} className="text-sm text-muted-foreground hover:text-foreground">
          Services
        </Link>
        <h1 className="font-heading text-3xl">{offeringId ? "Edit service" : "Add a service"}</h1>
      </div>
      {role !== "admin" ? (
        <p className="mt-2 text-sm text-muted-foreground">Only an admin can manage the services.</p>
      ) : null}
      <form onSubmit={handleSubmit} className="panel mt-6 grid max-w-2xl gap-6 p-5 md:p-6">
        <div className="space-y-2">
          <Label htmlFor="offering-name">Name</Label>
          <Input
            id="offering-name"
            value={values.name}
            maxLength={MAX_OFFERING_NAME}
            onChange={(e) => patch({ name: e.target.value })}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="offering-description">Description</Label>
          <Textarea
            id="offering-description"
            value={values.description}
            maxLength={1_000}
            onChange={(e) => patch({ description: e.target.value })}
            rows={3}
            placeholder="What the client gets, and what you need from them."
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="offering-department">Department</Label>
          <select
            id="offering-department"
            className={SELECT_CLASS}
            value={values.departmentId}
            onChange={(e) => patch({ departmentId: e.target.value })}
          >
            <option value="">No department</option>
            {departments.map((department) => (
              <option key={department.id} value={department.id}>
                {department.name}
              </option>
            ))}
          </select>
        </div>
        <section className="grid gap-3">
          <h2 className="font-medium">Usually costs</h2>
          <div className="flex gap-3">
            <div className="w-full space-y-2">
              <Label htmlFor="offering-price-min" className="text-muted-foreground">
                From
              </Label>
              <Input
                id="offering-price-min"
                inputMode="decimal"
                value={values.priceMin}
                onChange={(e) => patch({ priceMin: e.target.value })}
                placeholder="0.00"
              />
            </div>
            <div className="w-full space-y-2">
              <Label htmlFor="offering-price-max" className="text-muted-foreground">
                To
              </Label>
              <Input
                id="offering-price-max"
                inputMode="decimal"
                value={values.priceMax}
                onChange={(e) => patch({ priceMax: e.target.value })}
                placeholder="0.00"
              />
            </div>
          </div>
          <p className="text-sm text-muted-foreground">
            In {currency}. A fixed price is the same number twice.
          </p>
        </section>
        <section className="grid gap-3">
          <h2 className="font-medium">Usually takes</h2>
          <div className="flex gap-3">
            <div className="w-full space-y-2">
              <Label htmlFor="offering-days-min" className="text-muted-foreground">
                From
              </Label>
              <Input
                id="offering-days-min"
                type="number"
                min={1}
                max={MAX_OFFERING_DAYS}
                value={values.daysMin}
                onChange={(e) => patch({ daysMin: e.target.value })}
              />
            </div>
            <div className="w-full space-y-2">
              <Label htmlFor="offering-days-max" className="text-muted-foreground">
                To
              </Label>
              <Input
                id="offering-days-max"
                type="number"
                min={1}
                max={MAX_OFFERING_DAYS}
                value={values.daysMax}
                onChange={(e) => patch({ daysMax: e.target.value })}
              />
            </div>
          </div>
          <p className="text-sm text-muted-foreground">Whole days, from 1 to {MAX_OFFERING_DAYS}.</p>
        </section>
        <section className="grid gap-3">
          <h2 className="font-medium">Questions for the client</h2>
          <div className="grid gap-2">
            {values.questions.map((question, index) => (
              <div key={index} className="flex items-center gap-2">
                <Input
                  aria-label={`Question ${index + 1}`}
                  value={question}
                  maxLength={MAX_INTAKE_QUESTION_CHARS}
                  onChange={(e) => {
                    const questions = [...values.questions];
                    questions[index] = e.target.value;
                    patch({ questions });
                  }}
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => patch({ questions: values.questions.filter((_, i) => i !== index) })}
                >
                  Remove
                </Button>
              </div>
            ))}
          </div>
          <Button
            type="button"
            variant="outline"
            className="justify-self-start"
            disabled={values.questions.length >= MAX_INTAKE_QUESTIONS}
            onClick={() => patch({ questions: [...values.questions, ""] })}
          >
            Add question
          </Button>
          <p className="text-sm text-muted-foreground">
            Up to {MAX_INTAKE_QUESTIONS}. They appear on the request form on your seller page.
          </p>
        </section>
        <div className="grid gap-1">
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={values.listed} onCheckedChange={(checked) => patch({ listed: checked === true })} />
            List in AI assistants
          </label>
          <p className="pl-6 text-sm text-muted-foreground">
            Clients asking Claude or ChatGPT for this kind of work can find it and request a quote.
          </p>
        </div>
        {offeringId ? (
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={values.active} onCheckedChange={(checked) => patch({ active: checked === true })} />
            Show this service on your seller page
          </label>
        ) : null}
        {touched && problem ? (
          <p role="alert" className="text-sm text-destructive">
            {problem.message}
          </p>
        ) : null}
        {save.error ? (
          <p role="alert" className="text-sm text-destructive">
            {save.error.message}
          </p>
        ) : null}
        {setActive.error ? (
          <p role="alert" className="text-sm text-destructive">
            {setActive.error.message}
          </p>
        ) : null}
        <Button type="submit" disabled={!canSubmit} className="justify-self-start">
          {save.isPending ? "Saving…" : offeringId ? "Save changes" : "Create service"}
        </Button>
      </form>
    </main>
  );
}
