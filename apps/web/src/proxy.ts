import { env } from "cloudflare:workers";
import { type NextRequest, NextResponse } from "next/server";

import { BASE_PATH_HEADER, routeForHost } from "@/lib/host-routing";

export function proxy(request: NextRequest) {
  const route = routeForHost(new URL(request.url), env.PLATFORM_DOMAIN);
  switch (route.kind) {
    case "pass":
      return NextResponse.next();
    case "not-found":
      return new NextResponse("Not found", { status: 404 });
    case "rewrite": {
      // Setting the header here also overwrites any value the client sent.
      const headers = new Headers(request.headers);
      headers.set(BASE_PATH_HEADER, route.basePath);
      const destination = new URL(`${route.pathname}${request.nextUrl.search}`, request.url);
      return NextResponse.rewrite(destination, { request: { headers } });
    }
  }
}

export const config = {
  // Static files and metadata routes are shared by every host.
  matcher: ["/((?!_next/|favicon|manifest\\.webmanifest|sw\\.js|offline\\.html).*)"],
};
