import { describe, expect, it } from "vitest";

import { createFakeFileStore } from "./testing";

describe("createFakeFileStore", () => {
  it("reports the size of stored objects and null for missing ones", async () => {
    const store = createFakeFileStore();
    store.put("teams/t1/files/a.zip", 42);

    expect(await store.head("teams/t1/files/a.zip")).toEqual({ sizeBytes: 42 });
    expect(await store.head("teams/t1/files/missing.zip")).toBeNull();
  });

  it("deletes stored objects and records each call", async () => {
    const store = createFakeFileStore();
    store.put("teams/t1/files/a.zip", 42);
    store.put("teams/t1/files/b.zip", 7);

    await store.delete(["teams/t1/files/a.zip", "teams/t1/files/missing.zip"]);

    expect([...store.objects.keys()]).toEqual(["teams/t1/files/b.zip"]);
    expect(store.deletes).toEqual([["teams/t1/files/a.zip", "teams/t1/files/missing.zip"]]);
  });
});
