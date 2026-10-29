import Link from "next/link";

import ContextualAgentArt from "./art/contextual-agent";

// Connect discovery to the business work and the approval boundaries described by the current spec.
export default function ContextualAgentTeaser({ name, surface = "home" }: { name: string; surface?: "home" | "network" }) {
  return (
    <section aria-labelledby="contextual-agent-h">
      <div className="wrap contextual-agent-story">
        <div className="contextual-agent-copy" data-in>
          <p className="tag">Coming next · Agentic ways of doing business</p>
          <h2 id="contextual-agent-h">The conversation starts the work. Your agent follows it through.</h2>
          <p className="lead-dark">
            A client finds you through {name} Network. A brief becomes a request, then a project.
            Your agent brings the relevant context into each next step.
          </p>
          <p>
            Draft a quote. Prepare a client reminder. Understand which payouts are ready,
            and why others are held. One agent, guided by how your business runs.
          </p>
          <Link className="link" href={surface === "network" ? "#can-h" : "#stories"}>
            {surface === "network" ? "What the client stays in control of" : "See how it fits your business"} <span aria-hidden="true">↘</span>
          </Link>
        </div>
        <figure className="contextual-agent-figure" data-in>
          <ContextualAgentArt />
          <figcaption>The context changes. Your operating model stays in charge.</figcaption>
        </figure>
      </div>
    </section>
  );
}
