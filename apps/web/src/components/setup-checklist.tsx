import { countDone, type SetupStep } from "@jendal-workspace/core";
import { Circle, CircleCheck } from "lucide-react";

export default function SetupChecklist({ steps }: { steps: readonly SetupStep[] }) {
  return (
    <section aria-labelledby="setup-heading" className="border p-4">
      <div className="flex items-baseline justify-between gap-4">
        <h2 id="setup-heading" className="font-medium">
          Set up your store
        </h2>
        <p className="text-sm text-muted-foreground">
          {countDone(steps)} of {steps.length} done
        </p>
      </div>
      <ol className="mt-3 space-y-2">
        {steps.map((step) => (
          <li key={step.id} className="flex items-center gap-2 text-sm">
            {step.done ? (
              <CircleCheck aria-hidden className="size-4 text-emerald-600" />
            ) : (
              <Circle aria-hidden className="size-4 text-muted-foreground" />
            )}
            <span className="sr-only">{step.done ? "Done:" : "To do:"}</span>
            {step.href ? (
              <a href={step.href} target="_blank" rel="noreferrer" className="underline underline-offset-4">
                {step.label}
              </a>
            ) : (
              <span>{step.label}</span>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
