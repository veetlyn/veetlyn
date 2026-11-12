import { Fragment, type ReactNode } from "react";

// The assistant's answers come as light markdown. Only bold, emphasis, inline code (shown as plain words), bullets and
// paragraphs are drawn, as React text, so nothing in an answer (which can quote client-written records) is ever
// treated as markup or a link.
const INLINE = /(\*\*[^*\n]+\*\*|\*[^*\s][^*\n]*?\*|`[^`\n]+`)/g;

function inline(text: string): ReactNode[] {
  return text.split(INLINE).map((part, i) => {
    if (part.length > 4 && part.startsWith("**") && part.endsWith("**")) {
      return (
        <strong key={i} className="font-medium">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.length > 2 && part.startsWith("*") && part.endsWith("*")) return <em key={i}>{part.slice(1, -1)}</em>;
    if (part.length > 2 && part.startsWith("`") && part.endsWith("`")) return <Fragment key={i}>{part.slice(1, -1)}</Fragment>;
    return <Fragment key={i}>{part}</Fragment>;
  });
}

const BULLET = /^\s*(?:[-*•]|\d+[.)])\s+/;

export default function AgentText({ text }: { text: string }) {
  return (
    <div className="grid max-w-[68ch] gap-3 text-sm leading-6 font-medium text-pretty">
      {text
        .trim()
        .split(/\n{2,}/)
        .map((block, i) => {
          const lines = block.split("\n");
          return lines.every((line) => BULLET.test(line)) ? (
            <ul key={i} className="grid list-disc gap-1.5 pl-5 marker:text-muted-foreground">
              {lines.map((line, j) => (
                <li key={j}>{inline(line.replace(BULLET, ""))}</li>
              ))}
            </ul>
          ) : (
            <p key={i} className="whitespace-pre-wrap">
              {inline(block)}
            </p>
          );
        })}
    </div>
  );
}
