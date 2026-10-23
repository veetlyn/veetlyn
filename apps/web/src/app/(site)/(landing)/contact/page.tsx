import { getSellerPlan } from "@jendal-workspace/core";

import ContactForm from "@/components/site/contact-form";
import JsonLd from "@/components/site/json-ld";
import { contactEmail } from "@/content/legal/meta";
import { platformSite } from "@/lib/platform";
import { breadcrumbs, graph, organization, pageMetadata } from "@/lib/site/seo";

export function generateMetadata() {
  const site = platformSite();
  const email = contactEmail(site.domain);
  return pageMetadata({
    path: "/contact",
    title: `Contact ${site.name}`,
    description: `Talk to ${site.name} about Enterprise plans, Network membership, partnerships or support. Write to ${email}.`,
    site,
  });
}

export default function ContactPage() {
  const site = platformSite();
  const email = contactEmail(site.domain);
  return (
    <>
      <JsonLd data={graph(organization(site), breadcrumbs([["Contact", "/contact"]], site))} />
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
      <div>
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
                <a href={`mailto:${email}`}>{email}</a>
              </div>
            </div>
            <ContactForm />
          </div>
        </section>
      </div>
    </>
  );
}
