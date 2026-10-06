import { H2, P } from "@/components/legal/prose";

import { type PolicyStore, StoreContact, StoreLink } from "./shared";

export default function ShippingPolicy({ store }: { store: PolicyStore }) {
  return (
    <>
      <P>
        This policy explains how {store.name} ships orders placed at <StoreLink store={store} />.
      </P>
      <H2>Processing time</H2>
      <P>
        We prepare orders within 2 business days. Orders placed on a weekend or public holiday are prepared on the next
        business day.
      </P>
      <H2>Delivery options and rates</H2>
      <P>Shipping options, rates and estimated delivery times are shown at checkout before you pay.</P>
      <H2>Tracking</H2>
      <P>When your order ships, we email you a tracking link if the carrier provides one.</P>
      <H2>International orders</H2>
      <P>
        Customs duties and import taxes are set by the destination country and paid by the buyer, unless checkout says
        otherwise.
      </P>
      <H2>Lost or late parcels</H2>
      <P>
        If your order has not arrived by the estimated date, contact us at <StoreContact store={store} />. We work with
        the carrier to find it, or send a replacement or a refund.
      </P>
    </>
  );
}
