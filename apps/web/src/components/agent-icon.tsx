import { LogoPaths } from "./brand-paths";

// The assistant's mark in the dash: the platform's V, never a sparkle.
export function AgentIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="4 6 56 51" className={className} aria-hidden="true">
      <LogoPaths />
    </svg>
  );
}
