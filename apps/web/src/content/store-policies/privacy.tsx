import { H2, LI, P, UL } from "@/components/legal/prose";
import { PlatformName } from "@/components/platform-name";

import { type PolicyStore, StoreContact, StoreLink } from "./shared";

export default function StorePrivacy({ store }: { store: PolicyStore }) {
  return (
    <>
      <P>
        This policy explains how {store.name} handles your personal data when you shop at <StoreLink store={store} />.
      </P>
      <H2>Who is responsible</H2>
      <P>
        {store.name} controls the personal data you give when you shop here. <PlatformName />, the platform that runs
        this store, processes it on the store's behalf.
      </P>
      <H2>What we collect</H2>
      <UL>
        <LI>your name and email address</LI>
        <LI>your shipping address</LI>
        <LI>your order history</LI>
        <LI>messages you send us</LI>
      </UL>
      <P>Card and bank details go to PayPal and are not shared with us.</P>
      <H2>Why we use it</H2>
      <P>
        To process and deliver your order, answer your questions, handle returns and keep the records the law requires.
        We do not sell your data.
      </P>
      <H2>Who we share it with</H2>
      <UL>
        <LI>PayPal, to take your payment</LI>
        <LI>shipping carriers, to deliver your order</LI>
        <LI>
          <PlatformName />, which hosts this store
        </LI>
      </UL>
      <H2>How long we keep it</H2>
      <P>We keep order records as long as tax and accounting law requires, and delete other data when we no longer need it.</P>
      <H2>Your rights</H2>
      <P>
        You can ask to see, correct or delete your data, or object to how it is used. Contact us at{" "}
        <StoreContact store={store} />.
      </P>
      <H2>Cookies</H2>
      <P>This store uses only the cookies needed to run the store and checkout. It does not use tracking cookies.</P>
    </>
  );
}
