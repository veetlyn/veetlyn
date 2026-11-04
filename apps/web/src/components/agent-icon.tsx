// the assistant's own mark in the dash: the four-point spark the site uses for the agent.
export function AgentIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className} aria-hidden="true">
      <path d="M8 1.5 9.4 6.6 14.5 8 9.4 9.4 8 14.5 6.6 9.4 1.5 8 6.6 6.6Z" fill="currentColor" />
    </svg>
  );
}
