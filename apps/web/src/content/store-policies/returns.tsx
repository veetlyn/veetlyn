import { H2, LI, OL, P } from "@/components/legal/prose";

import { type PolicyStore, StoreContact, StoreLink } from "./shared";

export default function ReturnsPolicy({ store }: { store: PolicyStore }) {
  return (
    <>
      <P>
        This policy explains how to return items bought from {store.name} at <StoreLink store={store} />.
      </P>
      <H2>Returns within 30 days</H2>
      <P>
        You can return most items within 30 days of delivery. Items must be unused and in their original condition and
        packaging, with proof of purchase.
      </P>
      <P>Digital products and gift cards cannot be returned once delivered.</P>
      <H2>How to return an item</H2>
      <OL>
        <LI>
          Contact us at <StoreContact store={store} /> with your order number and the items you want to return.
        </LI>
        <LI>We reply with the return address and instructions.</LI>
        <LI>Send the items back. Unless an item arrived damaged or wrong, you pay for return shipping.</LI>
      </OL>
      <H2>Refunds</H2>
      <P>
        Once we receive and check the items, we refund your original PayPal payment, usually within 5 business days.
        PayPal returns the money to the account or card you paid with.
      </P>
      <H2>Damaged or wrong items</H2>
      <P>
        If an item arrives damaged or is not what you ordered, contact us within 7 days of delivery with a photo. We
        send a replacement or refund you in full, including shipping.
      </P>
    </>
  );
}
