import { A, H2, P } from "@/components/legal/prose";

import { type PolicyStore, StoreContact, StoreLink } from "./shared";

export default function StoreTerms({ store }: { store: PolicyStore }) {
  return (
    <>
      <P>
        These terms apply to purchases from {store.name} at <StoreLink store={store} />.
      </P>
      <H2>Who you are buying from</H2>
      <P>
        {store.name} is the seller of the products on this website. Payleor provides the online store platform and does
        not sell, ship or guarantee the products.
      </P>
      <H2>Orders and prices</H2>
      <P>
        Prices, taxes and shipping costs are shown at checkout before you pay. Your order is accepted when we confirm it
        by email. If a product cannot be supplied or a price was clearly wrong, we may cancel the order and refund you
        in full.
      </P>
      <H2>Payment</H2>
      <P>Payments are processed by PayPal. We never see or store your card details.</P>
      <H2>Orders placed by AI agents</H2>
      <P>
        You can buy through AI assistants and shopping agents. An order that an agent places on your behalf is your
        order. The agent must ask for your confirmation before it pays.
      </P>
      <H2>Returns and shipping</H2>
      <P>
        See our <A href="/policies/returns">return policy</A> and <A href="/policies/shipping">shipping policy</A>.
      </P>
      <H2>Your rights</H2>
      <P>Nothing in these terms limits the rights you have as a consumer under the law.</P>
      <H2>Contact</H2>
      <P>
        Questions about an order: <StoreContact store={store} />.
      </P>
    </>
  );
}
