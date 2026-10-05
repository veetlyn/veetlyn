import { env } from "cloudflare:workers";
import { type NextRequest, NextResponse } from "next/server";

import { routeForHost } from "@/lib/host-routing";

export function proxy(request: NextRequest) {
  const route = routeForHost(new URL(request.url), {
    platformDomain: env.PLATFORM_DOMAIN,
    storeDomain: env.STORE_DOMAIN,
  });
  switch (route.kind) {
    case "pass":
      return NextResponse.next();
    case "not-found":
      return new NextResponse("Not found", { status: 404 });
    case "rewrite":
      return NextResponse.rewrite(new URL(`${route.pathname}${request.nextUrl.search}`, request.url));
  }
}

export const config = {
  // Static files and metadata routes are shared by every host.
  matcher: ["/((?!_next/|favicon|manifest\\.webmanifest|sw\\.js|offline\\.html).*)"],
};
