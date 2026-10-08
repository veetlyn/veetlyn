import { H2, LI, P, UL } from "@/components/legal/prose";

import { type PolicyStore, StoreContact, StoreLink } from "../store-policies/shared";

export default function SellerPrivacy({ store }: { store: PolicyStore }) {
  return (
    <>
      <P>
        This policy explains how {store.name} handles your personal data when you ask for a quote or work with them
        through <StoreLink store={store} />.
      </P>
      <H2>Who is responsible</H2>
      <P>
        {store.name} controls the personal data you give them. Payleor, the software that runs this page, processes it
        on their behalf.
      </P>
      <H2>What we collect</H2>
      <UL>
        <LI>your name and email address</LI>
        <LI>what you tell us about your project, and the files we exchange</LI>
        <LI>your quotes, payments and deliveries</LI>
      </UL>
      <P>Card and bank details go to PayPal and are not shared with us.</P>
      <H2>Why we use it</H2>
      <P>
        To quote, do the work, take payment, answer your questions and keep the records the law requires. We do not sell
        your data.
      </P>
      <H2>Who we share it with</H2>
      <UL>
        <LI>PayPal, to take your payments</LI>
        <LI>Payleor, which hosts this page and your project page</LI>
      </UL>
      <H2>How long we keep it</H2>
      <P>
        We keep project and payment records as long as tax and accounting law requires, and delete other data when we no
        longer need it.
      </P>
      <H2>Your rights</H2>
      <P>
        You can ask to see, correct or delete your data, or object to how it is used. Contact us at{" "}
        <StoreContact store={store} />.
      </P>
      <H2>Cookies</H2>
      <P>This page uses only the cookies needed to run it. It does not use tracking cookies.</P>
    </>
  );
}
