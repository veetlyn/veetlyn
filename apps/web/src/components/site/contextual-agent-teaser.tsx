// Launch teaser for the contextual agent described in the active calls design.
export default function ContextualAgentTeaser({ name }: { name: string }) {
  return (
    <section aria-labelledby="contextual-agent-h">
      <div className="wrap">
        <p className="tag" data-in>Coming next · Agentic ways of doing business</p>
        <h2 id="contextual-agent-h" data-in>One agent. The context of your business.</h2>
        <p className="lead-dark" data-in>
          Turn a client brief into the next conversation. Bring a project into focus.
          Understand which payouts are ready and what is holding the others back.
        </p>
        <p data-in>
          Your agent follows the work across {name}, explains what needs your attention and
          prepares the next step. Your operating model guides what it can see and do,
          from drafting a quote to preparing your team’s payouts through PayPal.
        </p>
      </div>
    </section>
  );
}
