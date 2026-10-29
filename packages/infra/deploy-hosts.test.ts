import { describe, expect, it } from "vitest";

import { deployedHosts, parseDeployedStage, storeSlugsFrom } from "./deploy-hosts.ts";

const ZONES = { platformZone: "platform.test", storeZone: "platform-store.test" };

describe("deployedHosts", () => {
  it("serves production on the apex domains with a wildcard store route", () => {
    const hosts = deployedHosts("production", ["walk-crew"], ZONES);
    expect(hosts.platformDomain).toBe("platform.test");
    expect(hosts.storeDomain).toBe("platform-store.test");
    expect(hosts.dashOrigin).toBe("https://dash.platform.test");
    expect(hosts.web.domain).toEqual({
      name: "platform.test",
      aliases: ["dash.platform.test", "admin.platform.test", "platform-store.test", "www.platform-store.test"],
      redirects: ["www.platform.test"],
    });
    expect(hosts.web.routes).toEqual([{ pattern: "*.platform-store.test/*", zoneName: "platform-store.test" }]);
    expect(hosts.api.domain).toBe("api.platform.test");
    expect(hosts.fileOrigins).toEqual(["https://platform.test", "https://dash.platform.test"]);
  });

  // A staging route on a production zone would take over production's seller sites.
  it("keeps staging off the production hosts: named store hosts, no routes", () => {
    const hosts = deployedHosts("staging", ["walk-crew", "acme"], ZONES);
    expect(hosts.platformDomain).toBe("staging.platform.test");
    expect(hosts.storeDomain).toBe("staging.platform-store.test");
    expect(hosts.dashOrigin).toBe("https://dash.staging.platform.test");
    expect(hosts.web.domain.aliases).toEqual([
      "dash.staging.platform.test",
      "admin.staging.platform.test",
      "staging.platform-store.test",
      "www.staging.platform-store.test",
      "walk-crew.staging.platform-store.test",
      "acme.staging.platform-store.test",
    ]);
    expect(hosts.web.routes).toEqual([]);
    expect(hosts.api.domain).toBe("api.staging.platform.test");
  });

  it("refuses a zone that is not a domain name", () => {
    for (const bad of ["", "platform", "https://platform.test", "platform.test/path", "*.platform.test", "Platform.test"]) {
      expect(() => deployedHosts("production", [], { platformZone: bad, storeZone: "platform-store.test" })).toThrow(
        /PLATFORM_ZONE/,
      );
      expect(() => deployedHosts("production", [], { platformZone: "platform.test", storeZone: bad })).toThrow(
        /STORE_ZONE/,
      );
    }
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
