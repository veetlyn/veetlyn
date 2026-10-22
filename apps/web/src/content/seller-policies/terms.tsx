import { H2, P } from "@/components/legal/prose";
import { PlatformName } from "@/components/platform-name";

import { type PolicyStore, StoreContact, StoreLink } from "../store-policies/shared";

export default function SellerTerms({ store }: { store: PolicyStore }) {
  return (
    <>
      <P>
        These terms apply when you ask {store.name} for a quote or buy their services through <StoreLink store={store} />.
      </P>
      <H2>Who you are working with</H2>
      <P>
        {store.name} provides the services on this page and is responsible for them. <PlatformName /> provides the
        software that runs this page, the quotes and the payments, and is not a party to your agreement with {store.name}.
      </P>
      <H2>Quotes</H2>
      <P>
        Prices and delivery times on this page are usual ranges, not offers. {store.name} sends you a quote with the
        price and the delivery time; the agreement starts when you accept it.
      </P>
      <H2>Payment</H2>
      <P>
        You pay a deposit when you accept the quote and the balance when you accept the delivery. Payments are processed
        by PayPal; {store.name} and <PlatformName /> never see your card details.
      </P>
      <H2>Delivery and changes</H2>
      <P>
        {store.name} delivers through your private project page. You can accept the delivery or ask for changes there.
      </P>
      <H2>Your rights</H2>
      <P>Nothing in these terms limits the rights you have as a consumer under the law.</P>
      <H2>Contact</H2>
      <P>
        Questions about a quote or a project: <StoreContact store={store} />.
      </P>
    </>
  );
}
