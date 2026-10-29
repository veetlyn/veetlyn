// Roadmap copy shared by the launch page and Network page; not an enabled payment capability.
export default function DelegatedPurchasesTeaser() {
  return (
    <section aria-labelledby="delegated-purchases-h">
      <div className="wrap">
        <p className="tag" data-in>Planned · Agentic ways of doing business</p>
        <h2 id="delegated-purchases-h" data-in>An agent that can buy within your budget.</h2>
        <p className="lead-dark" data-in>
          Tell it what to buy, which sellers it can use and how much it can spend.
          Set an expiry. Let it handle the purchase and come back to you when it needs more authority.
        </p>
        <p data-in>
          We plan to bring delegated purchases to Veetlyn through PayPal Agent Ready:
          purchases within your limits, approval requests outside them, and a record of each action.
          Availability depends on PayPal approval, supported accounts and AI platforms, and our integration.
        </p>
        <p className="foot-line" data-in>
          Not available in the alpha. Today, buyers approve checkout in PayPal.
          No launch date is confirmed for delegated purchases.
        </p>
      </div>
    </section>
  );
}
