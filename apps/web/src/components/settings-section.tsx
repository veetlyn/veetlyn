"use client";

import { Button } from "@jendal-workspace/ui/components/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@jendal-workspace/ui/components/motion/card";
import { cn } from "@jendal-workspace/ui/lib/utils";
import { useId } from "react";

// A group of related settings, composed from beUI's Card in the dash's coated frame: the group's name and one line on
// the strip, its fields on the inset card one per row, and an optional foot strip.
export function SettingsSection({
  title,
  description,
  footer,
  children,
}: {
  title: string;
  description?: React.ReactNode;
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  const headingId = useId();
  return (
    <Card role="group" aria-labelledby={headingId} className="frame frame-panel min-w-0 gap-0 rounded-[18px] border-0 bg-(--frame-strip) py-0">
      <CardHeader className="gap-1 px-[calc(20px+0.25em)] pt-4 pb-3.5">
        <CardTitle as="h2" id={headingId} className="text-[14px] font-medium">{title}</CardTitle>
        {description ? <CardDescription className="text-[13px] leading-5">{description}</CardDescription> : null}
      </CardHeader>
      <CardContent className="frame frame-body divide-y px-0 text-[14px]">{children}</CardContent>
      {footer ? <CardFooter className="frame-foot">{footer}</CardFooter> : null}
    </Card>
  );
}

// One setting: what it is and what it changes on the left, its control on the right. A wide control (a text area)
// takes the full row under its label.
export function SettingsField({
  id,
  label,
  description,
  wide = false,
  children,
}: {
  id?: string;
  label: string;
  description?: React.ReactNode;
  wide?: boolean;
  children: React.ReactNode;
}) {
  const LabelTag = id ? "label" : "p";
  return (
    <div className={cn("grid min-w-0 gap-x-10 gap-y-3 px-6 py-5", !wide && "sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center")}>
      <div className="min-w-0 max-w-md space-y-1">
        <LabelTag {...(id ? { htmlFor: id } : {})} className="block text-[14px] font-medium">{label}</LabelTag>
        {description ? <p className="text-[13px] leading-5 text-muted-foreground">{description}</p> : null}
      </div>
      <div className={cn("min-w-0", !wide && "sm:justify-self-end")}>{children}</div>
    </div>
  );
}

// A bar that rests at the bottom of the screen while there is something to save or publish: what is pending on the
// left, the keys on the right.
export function FloatingBar({ message, tone = "muted", label, children }: {
  message: React.ReactNode;
  tone?: "muted" | "error";
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="sticky bottom-4 z-20 flex justify-center pt-2">
      <div role="region" aria-label={label} className="frame frame-panel flex w-full max-w-xl flex-wrap items-center gap-3 py-2.5 pr-2.5 pl-5 shadow-lg">
        <p className={cn("mr-auto text-[13px]", tone === "error" ? "text-destructive" : "text-muted-foreground")} role={tone === "error" ? "alert" : undefined}>
          {message}
        </p>
        {children}
      </div>
    </div>
  );
}

// Changes are held until saved: while a form differs from what is stored, the bar offers the way back and the save key.
export function SaveBar({ dirty, saving, canSave, onDiscard, error, message = "You have unsaved changes." }: {
  dirty: boolean;
  /** Without it, nothing was changed here to take back (defaults never saved), so there is no Discard. */
  message?: string;
  saving: boolean;
  canSave: boolean;
  onDiscard?: () => void;
  error?: string;
}) {
  if (!dirty && !error) return null;
  return (
    <FloatingBar label="Unsaved changes" message={error ?? message} tone={error ? "error" : "muted"}>
      {onDiscard ? <Button type="button" variant="ghost" size="sm" onClick={onDiscard} disabled={saving}>Discard</Button> : null}
      <Button type="submit" size="sm" disabled={!canSave}>{saving ? "Saving…" : "Save changes"}</Button>
    </FloatingBar>
  );
}
