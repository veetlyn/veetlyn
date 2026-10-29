// Launch teaser shared by the landing and Network pages.
export default function DelegatedPurchasesTeaser({ name }: { name: string }) {
  return (
    <section aria-labelledby="delegated-purchases-h">
      <div className="wrap">
        <p className="tag" data-in>Coming next · Agentic ways of doing business</p>
        <h2 id="delegated-purchases-h" data-in>Give it a task. Set a budget. Get back to business.</h2>
        <p className="lead-dark" data-in>
          An agent that finds what you need and takes care of the purchase.
          You choose the sellers, the spending limit and when to check back with you.
        </p>
        <p data-in>
          From restocking supplies to hiring a specialist, delegate more of the work through {name}.
          Keep control of every permission and a record of every purchase. Paid through PayPal.
        </p>
      </div>
    </section>
  );
}
