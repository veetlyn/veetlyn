import { describe, expect, it } from "vitest";

import { createFakeFileStore } from "./testing";

describe("createFakeFileStore", () => {
  it("records presigned uploads", async () => {
    const store = createFakeFileStore();

    const presigned = await store.presignPut({
      key: "teams/t1/files/a.zip",
      contentType: "application/zip",
      sizeBytes: 42,
      expiresInSeconds: 900,
    });

    expect(presigned.url).toBe("https://files.test/teams/t1/files/a.zip?op=put");
    expect(presigned.headers).toEqual({ "content-type": "application/zip" });
    expect(store.puts).toEqual([
      { key: "teams/t1/files/a.zip", contentType: "application/zip", sizeBytes: 42, expiresInSeconds: 900 },
    ]);
  });

  it("reports the size of stored objects and null for missing ones", async () => {
    const store = createFakeFileStore();
    store.put("teams/t1/files/a.zip", 42);

    expect(await store.head("teams/t1/files/a.zip")).toEqual({ sizeBytes: 42 });
    expect(await store.head("teams/t1/files/missing.zip")).toBeNull();
  });

  it("records presigned downloads with the file name", async () => {
    const store = createFakeFileStore();

    const url = await store.presignGet({ key: "teams/t1/files/a.zip", fileName: "Brand.zip", expiresInSeconds: 300 });

    expect(url).toBe("https://files.test/teams/t1/files/a.zip?op=get");
    expect(store.gets).toEqual([{ key: "teams/t1/files/a.zip", fileName: "Brand.zip", expiresInSeconds: 300 }]);
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
