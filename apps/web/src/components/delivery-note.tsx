"use client";

import { useState } from "react";

// Past this, a note pushes the files below the fold; it opens on request instead.
const LONG_NOTE_CHARS = 280;
const LONG_NOTE_LINES = 4;

export function isLongNote(note: string): boolean {
  return note.length > LONG_NOTE_CHARS || note.split("\n").length > LONG_NOTE_LINES;
}

export function DeliveryNote({ note, className }: { note: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const long = isLongNote(note);
  return (
    <div className={`space-y-1 ${className ?? ""}`}>
      <p className={`max-w-prose whitespace-pre-wrap break-words ${long && !open ? "line-clamp-3" : ""}`}>{note}</p>
      {long ? (
        <button
          type="button"
          aria-expanded={open}
          className="text-xs font-medium text-muted-foreground underline underline-offset-4 hover:text-foreground"
          onClick={() => setOpen((value) => !value)}
        >
          {open ? "Show less" : "Show the full note"}
        </button>
      ) : null}
    </div>
  );
}
