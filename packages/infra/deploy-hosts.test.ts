import { describe, expect, it } from "vitest";

import { deployedHosts, parseDeployedStage, storeSlugsFrom } from "./deploy-hosts.ts";

describe("deployedHosts", () => {
  it("serves production on the apex domains with a wildcard store route", () => {
    const hosts = deployedHosts("production", ["walk-crew"]);
    expect(hosts.platformDomain).toBe("payleor.com");
    expect(hosts.storeDomain).toBe("payleor.app");
    expect(hosts.dashOrigin).toBe("https://dash.payleor.com");
    expect(hosts.web.domain).toEqual({
      name: "payleor.com",
      aliases: ["dash.payleor.com", "admin.payleor.com"],
      redirects: ["www.payleor.com"],
    });
    expect(hosts.web.routes).toEqual([{ pattern: "*.payleor.app/*", zoneName: "payleor.app" }]);
    expect(hosts.api.domain).toBe("api.payleor.com");
    expect(hosts.fileOrigins).toEqual(["https://payleor.com", "https://dash.payleor.com"]);
  });

  // A staging route on a production zone would take over production's seller sites.
  it("keeps staging off the production hosts: named store hosts, no routes", () => {
    const hosts = deployedHosts("staging", ["walk-crew", "acme"]);
    expect(hosts.platformDomain).toBe("staging.payleor.com");
    expect(hosts.storeDomain).toBe("staging.payleor.app");
    expect(hosts.dashOrigin).toBe("https://dash.staging.payleor.com");
    expect(hosts.web.domain.aliases).toEqual([
      "dash.staging.payleor.com",
      "admin.staging.payleor.com",
      "walk-crew.staging.payleor.app",
      "acme.staging.payleor.app",
    ]);
    expect(hosts.web.routes).toEqual([]);
    expect(hosts.api.domain).toBe("api.staging.payleor.com");
  });
});

describe("parseDeployedStage and storeSlugsFrom", () => {
  it("accepts only the two deployed stages", () => {
    expect(parseDeployedStage("production")).toBe("production");
    expect(parseDeployedStage("staging")).toBe("staging");
    expect(parseDeployedStage("prod")).toBeUndefined();
    expect(parseDeployedStage(undefined)).toBeUndefined();
  });

  it("reads a comma list of slugs and refuses a slug that is not a host label", () => {
    expect(storeSlugsFrom(" walk-crew, acme ,")).toEqual(["walk-crew", "acme"]);
    expect(storeSlugsFrom(undefined)).toEqual([]);
    expect(() => storeSlugsFrom("walk-crew,a.b")).toThrow(/STAGING_STORE_SLUGS/);
  });
});
