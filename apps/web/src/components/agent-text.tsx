import { Fragment, type ReactNode } from "react";

// The assistant's answers come as light markdown. Only bold, bullets and paragraphs are drawn, as React text, so
// nothing in an answer (which can quote client-written records) is ever treated as markup or a link.
function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*\n]+\*\*)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") && part.length > 4 ? (
      <strong key={i} className="font-medium">
        {part.slice(2, -2)}
      </strong>
    ) : (
      <Fragment key={i}>{part}</Fragment>
    ),
  );
}

const BULLET = /^\s*(?:[-*•]|\d+[.)])\s+/;

export default function AgentText({ text }: { text: string }) {
  return (
    <div className="grid gap-2 text-[14px] leading-[22px]">
      {text
        .trim()
        .split(/\n{2,}/)
        .map((block, i) => {
          const lines = block.split("\n");
          return lines.every((line) => BULLET.test(line)) ? (
            <ul key={i} className="grid list-disc gap-1 pl-5">
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
