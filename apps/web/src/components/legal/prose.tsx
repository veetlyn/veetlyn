export function H2(props: React.ComponentProps<"h2">) {
  return <h2 {...props} className="mt-10 text-xl font-semibold tracking-tight" />;
}

export function P(props: React.ComponentProps<"p">) {
  return <p {...props} className="leading-relaxed" />;
}

export function UL(props: React.ComponentProps<"ul">) {
  return <ul {...props} className="list-disc space-y-1 pl-6" />;
}

export function OL(props: React.ComponentProps<"ol">) {
  return <ol {...props} className="list-decimal space-y-1 pl-6" />;
}

export function LI(props: React.ComponentProps<"li">) {
  return <li {...props} className="leading-relaxed" />;
}

export function A(props: React.ComponentProps<"a">) {
  return <a {...props} className="underline underline-offset-4" />;
}

export function Strong(props: React.ComponentProps<"strong">) {
  return <strong {...props} className="font-semibold" />;
}
