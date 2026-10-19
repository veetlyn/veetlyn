import { getSellerPlan } from "@jendal-workspace/core";

import ContactForm from "@/components/site/contact-form";
import JsonLd from "@/components/site/json-ld";
import { CONTACT_EMAIL } from "@/content/legal/meta";
import { breadcrumbs, graph, organization, pageMetadata } from "@/lib/site/seo";

export const metadata = pageMetadata({
  path: "/contact",
  title: "Contact Payleor",
  description:
    "Talk to Payleor about Enterprise plans, Network membership, partnerships or support. Write to contact@payleor.com.",
});

export default function ContactPage() {
  return (
    <>
      <JsonLd data={graph(organization(), breadcrumbs([["Contact", "/contact"]]))} />
      <div className="band">
        <div className="wrap hero page solo">
          <div>
            <h1 data-in>Talk to us</h1>
            <p className="lead" data-in>
              Enterprise plans, partnerships, or a question about your shop. Write to us and a person answers.
            </p>
          </div>
        </div>
      </div>
      <main>
        <section aria-label="Contact" style={{ paddingTop: "clamp(48px,6vw,80px)" }}>
          <div className="wrap contact">
            <div className="paths">
              <div className="path is-dark" id="sales" data-in>
                <h2>Enterprise and sales</h2>
                <p>
                  For more than {getSellerPlan("agency").members} people, networks of agencies, shops or studios, and
                  custom fees.
                </p>
                <a href="#mail" className="link">
                  Use the form
                </a>
              </div>
              <div className="path" data-in>
                <h2>Everything else</h2>
                <p>Support, press and partners.</p>
                <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
              </div>
            </div>
            <ContactForm />
          </div>
        </section>
      </main>
    </>
  );
}
