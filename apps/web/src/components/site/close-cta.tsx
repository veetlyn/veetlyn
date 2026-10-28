import { isWaitlistOnly, signupDestination } from "@/lib/launch";
import Link from "next/link";

import { getPlatformOrigins } from "@/lib/server-api";

export default async function CloseCta() {
  const { dash } = await getPlatformOrigins();
  return (
    <section id="start" aria-labelledby="start-h">
      <div className="wrap">
        <div className="close" data-in>
          <h2 id="start-h">Be there when AI comes shopping</h2>
          <div className="close-ctas">
            <a className="btn btn-mint" href={signupDestination(dash)}>
              {isWaitlistOnly() ? "Join the waitlist" : "Start selling"}
            </a>
            <Link className="link" href="/contact#sales">
              Talk to sales
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
