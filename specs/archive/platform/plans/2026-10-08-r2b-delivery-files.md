# Run 2b: Delivery Files Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A delivery can carry one file up to 100 MB. The deliverer's browser uploads it straight to a private R2 bucket through a presigned PUT; the delivery records it; the client (and the team) download it through a short-lived presigned GET that forces a download.

**Architecture:** `core` gains the file rules (allowed types, the 100 MB cap, safe names, the download header) and a `FileStore` port with a fake. `db` gains a `file_upload` table (one row per upload, attached once) and `delivery.file_upload_id`. `infra` adds a private `Files` bucket with a CORS rule and gives the server the bucket binding plus `Cloudflare.R2.S3Credentials`; `apps/server` implements `FileStore` with `aws4fetch`. `api` adds `project.deliveryUploadStart`, a `fileUploadId` on `deliver`, and download procedures for staff and client. The admin Deliver form gains a file input with upload progress; both pages show a Download button.

**Tech Stack:** TypeScript, Alchemy 2.0.0-beta.80 (R2 `Bucket`, `S3Credentials`), `aws4fetch`, Drizzle ORM 1.0 rc, tRPC 11, React 19 on vinext, Vitest 5.

**Spec:** [`../2026-10-07-sellers-minimal-flow-design.md`](../2026-10-07-sellers-minimal-flow-design.md) §4.3 (delivery file up to 100 MB in R2), §5.1 (private bucket, presigned upload, allowed types listed in the run's plan), §8 (signed links, type and size limits, no malware scan yet), §11.1 (run 2b row).

**Builds on:** `main` at `722e1e3` (R2 merged; 894 tests).

**Decisions for this run (2026-10-08):**
- **Presigned PUT and GET** (the approved design). In `alchemy dev` the presigned URLs point at the api Worker's local S3 endpoint (`http://localhost:3000/cdn-cgi/local/r2/s3/...`). Chrome blocks a public page from calling localhost unless the user allows "local network access" for the site, so in dev Mouhamed allows it for `admin.payleor.com` and `payleor.com`, and walkthroughs grant `local-network-access` in Playwright. Deployed, the URLs point at `https://<account>.r2.cloudflarestorage.com` and need only the bucket's CORS rule (checked in run 7, since the local endpoint ignores CORS).
- **One private bucket `Files`** for delivery files now and digital product files in run 4. Product images stay in the public `ProductImages` bucket.
- **The server decides the content type** from the file extension (allowlist below), and signs `content-type` and `content-length` into the PUT, so the browser cannot upload a different type or size than it declared. Before the delivery records the file, the server checks the object with the bucket binding (`head`): it must exist with exactly the declared size.
- **Upload URLs live 15 minutes, download URLs 5 minutes**, and downloads are generated on click, not embedded in page data. Downloads send `Content-Disposition: attachment` so nothing renders inline.
- **Allowed types** (by extension, case-insensitive): archives `zip 7z rar tar gz tgz`; documents `pdf doc docx xls xlsx ppt pptx odt ods odp rtf txt md csv json epub`; images and design `png jpg jpeg gif webp svg tif tiff heic psd ai eps fig sketch xd`; audio `mp3 wav flac ogg m4a aac`; video `mp4 mov webm mkv avi`; fonts `ttf otf woff woff2`; 3D and game assets `glb gltf fbx obj stl blend unitypackage`. Unknown or extensionless names are refused ("This file type is not allowed.").

**Out of scope:** deleting files (retention), cleaning up uploads never attached to a delivery, malware scanning, several files per delivery, resumable or multipart uploads, product files (run 4).

**Working directory for every command:** `/home/mouhamed/dev/repos/jendal/worktrees/r2b-delivery-files`, created in Task 0. Tests needing Postgres use `jendal-pg` through `.env.test.local`. The full suite takes about 6 minutes; run targeted tests per task.

## Facts this plan relies on (checked at `722e1e3`)

1. `packages/infra/alchemy.run.ts`: `ProductImages = Cloudflare.R2.Bucket("ProductImages")` (L56); the `server` Worker's `env` holds bindings and config (L64-100, `PRODUCT_IMAGES: ProductImages` at L92); `platformDomain` is a string in local stages and an Effect `Config` when deployed (L17), so a resource that needs it is built inside `Effect.gen` like `Database` (L42-50).
2. Alchemy R2 (`refs/stack/alchemy/packages/alchemy/src/Cloudflare/R2/`): `Bucket` props include `cors?: { allowedMethods; allowedOrigins; allowedHeaders?; exposeHeaders?; maxAgeSeconds? }[]`; `Cloudflare.R2.S3Credentials(bucket, { access: "read-write" })` in a Worker's `env` gives a JSON string `{ endpoint, bucketName, region, accessKeyId, secretAccessKey }` (path-style URLs `{endpoint}/{bucketName}/{key}`). In dev it points at the Worker's local S3 endpoint with fixed credentials; that endpoint verifies every signed header (including `content-length`), rejects expired URLs, allows any origin, and objects put through it are visible to the Worker's R2 binding. The documented signing recipe (`website/src/content/docs/cloudflare/data/r2-presigned-urls.mdx`) uses `aws4fetch`: `new AwsClient({ ...s3, service: "s3" })`, set `X-Amz-Expires`, `client.sign(url, { method, headers, aws: { signQuery: true, allHeaders: true } })`.
3. Server env is read with `import { env as ENV } from "cloudflare:workers"` (`apps/server/src/env.server.ts`). tRPC context (`apps/server/src/context.ts`) passes port objects (`paypal`, `catalog`); the type is `packages/api/src/context.ts`. Router tests build contexts by hand (`callerFor` in `packages/api/src/routers/*.test.ts`, with `catalog: createTestCatalogServices()`); the fake image store in `packages/core/src/catalog/testing.ts` is the model for a fake port.
4. `submitDelivery` (`packages/api/src/use-cases/projects.ts` ~L450-497) validates with `deliveryInput` ("Add a note or a link."), then `runProjectTransaction` → `requireTeamProject` → `canSubmitDelivery` → `checkTransition("submit_delivery")` → `uow.apply` → insert delivery. Staff `get` returns raw delivery rows; `clientGet` maps `{ id, status, note, link, clientNote, createdAt, decidedAt }`.
5. `hitRequestLimit` (packages/db request-limits repository) caps actions per key and window (used by pay links: 10 starts per 10 minutes).
6. Web: `apps/web/src/lib/delivery.ts` (`deliveryDraftProblem`, limits, `safeHttpsLink`), `apps/web/src/components/delivery-link.tsx`, the Deliver form in `project-detail.tsx`, the Delivery section in `client-project.tsx`. The web app already imports `@jendal-workspace/core`.
7. The web Worker forwards `/api/*` and `/trpc/*` to the api Worker; tRPC calls from both hosts are same-origin.

## Files

| File | Change |
|---|---|
| `packages/core/src/files/rules.ts` (+test) | Allowed types, `MAX_FILE_BYTES`, `fileContentType`, `safeFileName`, `attachmentDisposition`, `formatBytes` |
| `packages/core/src/files/store.ts`, `testing.ts` (+test) | `FileStore` port; `createFakeFileStore` |
| `packages/core/src/index.ts` | Exports |
| `packages/db/src/schema/files.ts`, `schema/projects.ts`, schema index | `file_upload`; `delivery.fileUploadId` |
| `packages/db/src/migrations/<ts>_r2b_delivery_files/` | Generated |
| `packages/db/src/repositories/files.ts` (+test) | Insert, lock for attach, attach, find by delivery |
| `packages/db/src/testing/db.ts` | Truncate `file_upload` |
| `packages/infra/alchemy.run.ts` | `Files` bucket with CORS; `FILES`, `FILES_S3` on the server |
| `apps/server/package.json` | `aws4fetch` |
| `apps/server/src/files/file-store.ts` (+test) | `createR2FileStore` |
| `apps/server/src/context.ts`, `packages/api/src/context.ts` | `files` in the context |
| `packages/api/src/use-cases/projects.ts`, `routers/project.ts` (+test) | Upload start, file on deliver, downloads, `file` on deliveries |
| `packages/api/src/routers/*.test.ts` | `files: createFakeFileStore()` in every hand-built context |
| `apps/web/src/lib/delivery.ts` (+test), `apps/web/src/lib/upload.ts` | File problems; PUT with progress |
| `apps/web/src/components/delivery-file.tsx` | Download button |
| `project-detail.tsx`, `client-project.tsx` | File input, progress, Download |

---

### Task 0: Worktree

```bash
cd /home/mouhamed/dev/repos/jendal/worktrees/main
git status --short   # must be empty
git worktree add -b r2b-delivery-files ../r2b-delivery-files main
cp .env.test.local ../r2b-delivery-files/.env.test.local
cd ../r2b-delivery-files && pnpm install && pnpm check-types
```

---

### Task 1: Core file rules and the FileStore port

- [ ] **Step 1: Tests first.** `packages/core/src/files/rules.test.ts`:
  - `fileContentType("Logo Final.PDF")` → `"application/pdf"`; `"brand.zip"` → `"application/zip"`; `"model.blend"` → `"application/octet-stream"` (allowed, generic type); `"song.mp3"` → `"audio/mpeg"`; `"run.exe"`, `"noext"`, `".env"`, `"a.html"`, `"a.svg.exe"` → `null`.
  - `safeFileName("../../etc/passwd")` → `"passwd"`; `"C:\\Users\\me\\logo.png"` → `"logo.png"`; control characters and `"` are removed; names longer than 200 characters are cut keeping the extension; `"   "` → `null`.
  - `attachmentDisposition("Logo final.pdf")` → `attachment; filename="Logo final.pdf"; filename*=UTF-8''Logo%20final.pdf`; a non-ASCII name (`"café.pdf"`) gets an ASCII fallback in `filename` (`"caf_.pdf"`) and the encoded original in `filename*`.
  - `fileProblem({ name, sizeBytes })`: `null` for an allowed name and `1 ≤ size ≤ MAX_FILE_BYTES`; "This file type is not allowed." for a refused type; "The file is empty." for 0; "Files can be up to 100 MB." above `MAX_FILE_BYTES` (`100 * 1024 * 1024`).
  - `formatBytes(0)` → `"0 B"`, `1_536` → `"1.5 KB"`, `MAX_FILE_BYTES` → `"100 MB"`, `5_400_000` → `"5.1 MB"`.
  `packages/core/src/files/testing.test.ts`: the fake store records a presigned PUT (`key`, `contentType`, `sizeBytes`), `put(key, bytes)` makes `head(key)` return `{ sizeBytes }`, `head` of a missing key is `null`, and `presignGet` returns a URL containing the key and records the file name.

- [ ] **Step 2: Run** `pnpm test packages/core/src/files` — Expected: FAIL.

- [ ] **Step 3: Implement.** `rules.ts`: a frozen map from lowercase extension to content type for the allowlist in "Decisions" (standard MIME types; `application/octet-stream` for formats without one: `fig sketch xd blend unitypackage fbx obj stl psd ai eps tgz rar 7z`), and the functions above. `safeFileName` takes the part after the last `/` or `\`, drops control characters and `"`, trims, and cuts to 200 characters keeping the extension. `store.ts`:

```ts
// Private file storage (sellers design §5.1): the browser uploads and downloads through short-lived presigned URLs.
export type FileStore = {
  presignPut(input: { key: string; contentType: string; sizeBytes: number; expiresInSeconds: number }): Promise<{
    url: string;
    headers: Record<string, string>;
  }>;
  presignGet(input: { key: string; fileName: string; expiresInSeconds: number }): Promise<string>;
  head(key: string): Promise<{ sizeBytes: number } | null>;
};
```

  `testing.ts`: `createFakeFileStore()` returning the port plus `objects: Map<string, number>` (key → size), `puts` and `gets` arrays, and `put(key, sizeBytes)`; presigned URLs look like `https://files.test/{key}?op=put|get`. Export from `packages/core/src/index.ts` the way `catalog` and its testing helpers are exported (check whether testing helpers use a separate entry point and follow it).

- [ ] **Step 4: Run** `pnpm test packages/core` and core check-types. Expected: PASS.

- [ ] **Step 5: Commit** `feat(core): file rules and the file store port` (body: allowed types, the 100 MB cap, safe names, the download header; a FileStore port with a fake). Co-authored-by trailer.

---

### Task 2: Schema and repository

- [ ] **Step 1:** `packages/db/src/schema/files.ts`:

```ts
export const FILE_PURPOSES = ["delivery"] as const; // run 4 adds "product"

// One uploaded object in the private Files bucket. A row is created when the upload starts and attached
// once to what it belongs to (a delivery now); rows never attached are leftovers to clean up later.
export const fileUpload = pgTable(
  "file_upload",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    teamId: text("team_id").notNull().references(() => team.id, { onDelete: "restrict" }),
    projectId: text("project_id").references(() => project.id, { onDelete: "cascade" }),
    purpose: text("purpose", { enum: FILE_PURPOSES }).notNull(),
    r2Key: text("r2_key").notNull().unique(),
    fileName: text("file_name").notNull(),
    contentType: text("content_type").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    createdById: text("created_by_id").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    attachedAt: timestamp("attached_at"),
  },
  (t) => [index("file_upload_projectId_idx").on(t.projectId)],
);
```

  (Match the id/timestamp/reference style of `schema/projects.ts`; put `FILE_PURPOSES` in core next to the other status lists if that is the convention, as run 2 did for `DELIVERY_STATUSES`.) Add to `delivery`: `fileUploadId: text("file_upload_id").references(() => fileUpload.id, { onDelete: "set null" })` with a unique index `delivery_fileUploadId_idx` (one delivery per file). Export from the schema index. Add `"file_upload"` to the truncate list after `"delivery"`.

- [ ] **Step 2: Repository tests** in `packages/db/src/repositories/files.test.ts` (setup like `projects.test.ts`): `insertFileUpload` then `lockFileUploadForAttach(tx, { id, teamId, projectId, purpose })` returns the row; a row of another team or project or purpose, or already attached, returns `null`; `markFileUploadAttached(tx, id)` sets `attachedAt`; `listDeliveryFiles(tx, deliveryIds)` returns `{ deliveryId, fileName, sizeBytes, r2Key }` for deliveries with a file.

- [ ] **Step 3: Implement** `packages/db/src/repositories/files.ts` (`lockFileUploadForAttach` uses `for update` and `attachedAt is null`).

- [ ] **Step 4: Migration**

```bash
DATABASE_URL="$(sed -n 's/^TEST_DATABASE_URL=//p' .env.test.local)" pnpm -F @jendal-workspace/db db:generate --name r2b_delivery_files
```

  Expected: create `file_upload` (unique `r2_key`, index), add `delivery.file_upload_id` with its foreign key and unique index. Nothing else.

- [ ] **Step 5: Run** `pnpm test packages/db packages/core`, check-types for core, db, api. **Commit** `feat(db): file uploads and the delivery file`. Co-authored-by trailer.

---

### Task 3: Bucket, credentials and the R2 file store

- [ ] **Step 1: Infra.** In `packages/infra/alchemy.run.ts`, after `ProductImages`:

```ts
// Private files (delivery files now, digital products in run 4). Browsers upload and download through
// presigned URLs, so the bucket allows PUT and GET from our hosts. alchemy dev's local S3 endpoint ignores CORS.
export const Files = Effect.gen(function* () {
  const domain = typeof platformDomain === "string" ? platformDomain : yield* platformDomain;
  return yield* Cloudflare.R2.Bucket("Files", {
    cors: [
      {
        allowedMethods: ["PUT", "GET", "HEAD"],
        allowedOrigins: [`https://${domain}`, `https://admin.${domain}`],
        allowedHeaders: ["content-type"],
        maxAgeSeconds: 3600,
      },
    ],
  });
});
```

  (Check how `platformDomain` and the admin host are actually derived — e.g. `dev-hosts.ts` `stageUrls` may expose the admin host; use the real helpers. If `Bucket` cannot take an Effect-resolved value this way, follow the pattern `Database` uses.) In the server's `env`: `FILES: Files` and `FILES_S3: Cloudflare.R2.S3Credentials(Files, { access: "read-write" })` (check the exact call shape against `S3Credentials.ts` and the docs page; an Effect-built bucket may need `yield*` in the stack body). Check that `ServerEnv` types `FILES` as `R2Bucket` and `FILES_S3` as a string.

- [ ] **Step 2: Adapter tests** `apps/server/src/files/file-store.test.ts`, with fixed credentials (`{ endpoint: "http://localhost:3000/cdn-cgi/local/r2/s3", bucketName: "files", region: "auto", accessKeyId: "AKID", secretAccessKey: "secret" }`) and a fake bucket (`head` returning `{ size }` or `null`, cast like `catalog-images.test.ts` does):
  - `presignPut` returns a URL under `{endpoint}/files/{key}` whose query has `X-Amz-Expires=900` and `X-Amz-SignedHeaders` containing `content-length`, `content-type` and `host`, plus `headers` `{ "content-type": … }` (the browser sets `content-length` itself; do not return it as a header to set).
  - `presignGet` has `X-Amz-Expires=300` and `response-content-disposition` equal to `attachmentDisposition(fileName)`, signed.
  - `head` maps the binding's `size`, and `null` when missing.

- [ ] **Step 3: Implement** `apps/server/src/files/file-store.ts`:

```ts
import { AwsClient } from "aws4fetch";
import type { FileStore } from "@jendal-workspace/core";
import { attachmentDisposition } from "@jendal-workspace/core";

type S3Credentials = { endpoint: string; bucketName: string; region: string; accessKeyId: string; secretAccessKey: string };

export function createR2FileStore(bucket: R2Bucket, credentialsJson: string): FileStore {
  const s3 = JSON.parse(credentialsJson) as S3Credentials;
  const client = new AwsClient({ accessKeyId: s3.accessKeyId, secretAccessKey: s3.secretAccessKey, region: s3.region, service: "s3" });
  const objectUrl = (key: string) => new URL(`${s3.endpoint}/${s3.bucketName}/${key.split("/").map(encodeURIComponent).join("/")}`);
  return {
    async presignPut({ key, contentType, sizeBytes, expiresInSeconds }) {
      const url = objectUrl(key);
      url.searchParams.set("X-Amz-Expires", String(expiresInSeconds));
      // Signing the type and length means the browser can only upload what the server allowed.
      const signed = await client.sign(url.toString(), {
        method: "PUT",
        headers: { "content-type": contentType, "content-length": String(sizeBytes) },
        aws: { signQuery: true, allHeaders: true },
      });
      return { url: signed.url, headers: { "content-type": contentType } };
    },
    async presignGet({ key, fileName, expiresInSeconds }) {
      const url = objectUrl(key);
      url.searchParams.set("X-Amz-Expires", String(expiresInSeconds));
      url.searchParams.set("response-content-disposition", attachmentDisposition(fileName));
      const signed = await client.sign(url.toString(), { method: "GET", aws: { signQuery: true } });
      return signed.url;
    },
    async head(key) {
      const object = await bucket.head(key);
      return object ? { sizeBytes: object.size } : null;
    },
  };
}
```

  (Avoid the `as` cast if the repo bans type assertions in production code: parse with a small zod schema or a type guard instead; check what neighbouring code does.) Add `aws4fetch` (latest 1.x) to `apps/server`. Wire it in `apps/server/src/context.ts` as `files` (created per isolate like `catalog`), and add `files: FileStore` to `packages/api/src/context.ts`. Add `files: createFakeFileStore()` to every hand-built test context (`rg -n "catalog: createTestCatalogServices" packages apps`).

- [ ] **Step 4: Run** `pnpm test apps/server packages/api`, check-types for server, api, infra (if infra has a check-types task). Expected: PASS.

- [ ] **Step 5: Commit** `feat(infra,server): a private Files bucket and presigned file URLs`. Co-authored-by trailer.

---

### Task 4: Upload start, the file on a delivery, downloads

- [ ] **Step 1: Failing router tests** in `project.test.ts` (reuse `workingProject`/`deliver` helpers; pass a shared fake store into `callerFor` so tests can inspect it):
  1. **Upload start:** the assigned freelancer calls `project.deliveryUploadStart({ teamSlug, projectId, fileName: "Logo final.pdf", sizeBytes: 2_000_000 })` → `{ uploadId, url, headers: { "content-type": "application/pdf" } }`; a `file_upload` row exists (team, project, purpose `delivery`, `r2Key` `deliveries/{teamId}/{projectId}/{uploadId}`, the safe file name, not attached); the fake recorded a PUT for that key, type and size with 900 s.
  2. **Upload start refusals:** a refused type → `BAD_REQUEST` "This file type is not allowed."; 0 bytes → "The file is empty."; over the cap → "Files can be up to 100 MB."; another freelancer → `FORBIDDEN`; a project not `in_progress` → `BAD_REQUEST` "Files can be added while the project is in progress."; the 21st start within 10 minutes for one user → `TOO_MANY_REQUESTS` "Too many uploads. Wait a few minutes and try again." (use `hitRequestLimit` with key `delivery-upload:{userId}`, 20 per 10 minutes).
  3. **Deliver with a file:** after `fake.put(key, 2_000_000)`, `deliver({ …, note: "", link: "", fileUploadId })` succeeds; the delivery has `fileUploadId`; the upload is attached; `clientGet` and staff `get` show `file: { name: "Logo final.pdf", sizeBytes: 2_000_000 }` on that delivery (and `file: null` on deliveries without one); `clientGet` exposes no key.
  4. **Deliver refusals:** the object missing (never uploaded) → `BAD_REQUEST` "The file did not finish uploading."; a size mismatch → the same message; an upload of another project or team, or already attached to an earlier delivery → `BAD_REQUEST` "This file cannot be used for this delivery."; no note, link or file → "Add a note, a link or a file."
  5. **Downloads:** `project.clientDeliveryFileUrl({ token, deliveryId })` → `{ url }` from the fake with the file name and 300 s; a delivery of another project or without a file → `BAD_REQUEST` "This delivery has no file."; staff `project.deliveryFileUrl({ teamSlug, projectId, deliveryId })` works for project members who can see the project (same access as `get`).

- [ ] **Step 2: Run** `pnpm test packages/api/src/routers/project.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implement** in `use-cases/projects.ts`:
  - `startDeliveryUpload(db, files, actor, { projectId, fileName, sizeBytes })`: `safeFileName`, `fileProblem` (fail `BAD_REQUEST` with its message); request limit; read the project with `requireTeamProject` (no transition; a plain read is enough), `canSubmitDelivery`, status must be `in_progress`; insert the `file_upload` row; `files.presignPut({ key, contentType, sizeBytes, expiresInSeconds: 900 })`; return `{ uploadId, url, headers }`.
  - `deliveryInput` accepts `fileUploadId?: string`; the empty check becomes "Add a note, a link or a file." (update the web mirror in Task 5).
  - `submitDelivery(db, files, actor, input)`: when `fileUploadId` is set, first read the upload row (outside the transaction) and `files.head(r2Key)`; missing or size ≠ `sizeBytes` → "The file did not finish uploading.". Inside the transaction, `lockFileUploadForAttach` with the project's team and id and purpose `delivery` (`null` → "This file cannot be used for this delivery."), insert the delivery with `fileUploadId`, `markFileUploadAttached`.
  - `deliveryFileUrl(db, files, { projectId, deliveryId })`: the delivery must belong to the project and have a file, else "This delivery has no file."; `files.presignGet({ key, fileName, expiresInSeconds: 300 })`.
  Router (`routers/project.ts`): `deliveryUploadStart` (team procedure; `fileName: z.string().min(1).max(1_000)`, `sizeBytes: z.number().int().nonnegative()`), `deliver` gains `fileUploadId: z.string().uuid().optional()`, `deliveryFileUrl` (team procedure, project access like `get`), public `clientDeliveryFileUrl` (`{ token, deliveryId }`, like `clientAcceptDelivery`). Add `file` to deliveries in `get` and `clientGet` with one `listDeliveryFiles` query (no per-delivery queries). Pass `ctx.files` through.

- [ ] **Step 4: Run** `pnpm test packages/api packages/db packages/core`, check-types for api and web. Expected: PASS.

- [ ] **Step 5: Commit** `feat(api): upload a delivery file and download it with a signed link`. Co-authored-by trailer.

---

### Task 5: The file in the Deliver form and the Download button

- [ ] **Step 1: Tests first** in `apps/web/src/lib/delivery.test.ts`: `deliveryDraftProblem({ note: "", link: "", file: null })` → "Add a note, a link or a file."; with only a file → `null`; with a refused file type → "This file type is not allowed."; over 100 MB → "Files can be up to 100 MB." (reuse core `fileProblem`; the draft takes `file: { name: string; size: number } | null`).

- [ ] **Step 2: Implement** `delivery.ts` changes and `apps/web/src/lib/upload.ts`:

```ts
// fetch cannot report upload progress, so the PUT to the presigned URL uses XMLHttpRequest.
export function uploadToPresignedUrl(input: {
  url: string;
  headers: Record<string, string>;
  file: File;
  onProgress: (fraction: number) => void;
  signal?: AbortSignal;
}): Promise<void>
```

  It sets the given headers, reports `loaded / total`, resolves on 2xx, rejects with "The upload failed. Try again." otherwise (and on network error or abort).

- [ ] **Step 3: Admin Deliver form** (`project-detail.tsx`): a file input labelled "File (optional)" with `accept` built from the allowlist extensions; under it the chosen file's name and `formatBytes(size)`, and a "Remove file" button. On **Submit delivery**: when a file is chosen, call `deliveryUploadStart`, then `uploadToPresignedUrl` showing "Uploading… 42%" (a `progress` element with a label), then `deliver` with `fileUploadId`; without a file, `deliver` as today. Disable the form while any step runs; show the first error (`role="alert"`); clear everything on success. Keep the run 2 behaviour that the draft problem shows only after the user has typed or picked something.

- [ ] **Step 4: Download button** `apps/web/src/components/delivery-file.tsx`: `DeliveryFile({ file, onDownload })` renders "Download {name} ({size})" as a button; while the URL request runs it shows "Preparing download…" and is disabled; on success `window.location.assign(url)`; errors show with `role="alert"`. Use it in both pages' delivery cards: staff via `trpc.project.deliveryFileUrl`, client via `trpc.project.clientDeliveryFileUrl`.

- [ ] **Step 5: Run** `pnpm test apps/web`, `pnpm -F web check-types`. **Commit** `feat(web): attach a file to a delivery and download it`. Co-authored-by trailer.

---

### Task 6: Full check and merge (controller)

`pnpm test && pnpm check-types` in the worktree; merge into `main` with `--no-ff`; `pnpm install`; `pnpm db:migrate:dev`; restart the dev stack (it creates the local `Files` bucket and credentials).

### Task 7: Walkthrough (controller)

Mouhamed allows local network access for `admin.payleor.com` and `payleor.com` in his Chrome; the Playwright browser gets `grantPermissions(["local-network-access"])` for both origins. No payment is needed.

1. On "Landing page redesign" (Walk Crew, in progress), deliver with a note and a small PDF: the upload shows progress, the delivery shows "Download … (size)".
2. Picking `.exe` shows "This file type is not allowed." and blocks submit; a file over 100 MB shows the size message (create a sparse file locally, do not upload it).
3. Upload a ~60 MB file (a generated `.zip`) to check a large PUT through the local endpoint, then cancel that draft (the upload stays unattached; note it).
4. On the client page, download the PDF: the browser downloads it with the original name and the bytes match (compare SHA-256 of the downloaded and the original file); an expired download URL (wait 5 minutes or tamper with the signature) is refused.
5. Check `file_upload` rows (attached and unattached) and the delivery's `file_upload_id` in the dev database.
6. Request changes on the client page so the project returns to in progress (no payment).
7. Record the outcome here; update the sellers design §11 and §11.1 (leftover uploads cleanup, file retention, CORS check on the deployed hosts in run 7).

---

## Outcome (2026-10-08)

Merged into `main` as `2aac26f` (946 tests, check-types clean). Commits: `984a7f4`, `3f25a59`, `321f89d` (file rules, the FileStore port, `file_upload`; review fixes: well-formed names so a lone surrogate cannot break the download header, bidi controls stripped, `checkUploadFile` as the one check), `64c710e`, `d4d7d94` (Files bucket, `S3Credentials`, `createR2FileStore` with aws4fetch; review fixes: credentials parsed on first use so a bad `FILES_S3` cannot stop the Worker, `StageUrls.platform`), `d3fdcb9` (upload start, the file on deliver, download procedures; approved as is), `ad86b46`, `75addf2` (web: file input with progress, Download button; "Saving…" and focus on a failed delivery). Migration `20261008143348_r2b_delivery_files` applied to the dev database.

Deviations from the plan:
- `Files` is a plain `Cloudflare.R2.Bucket` whose CORS origins are a `Config` value (Alchemy resolves Config inside props), not an `Effect.gen` resource.
- Download URLs are fetched with the tRPC client on each click (no React Query cache).
- SVG downloads also get `response-content-type=application/octet-stream`.
- The walkthrough attached both test files to deliveries (PDF, then a 60 MB zip after a change request) instead of leaving one upload unattached.

### Walkthrough

Mouhamed allowed local network access for `admin.payleor.com` and `payleor.com` in the browser. After the merge the web app showed a blank page (two copies of React from a stale Vite cache); deleting `apps/web/node_modules/.vite`, restarting dev and clearing the browser cache fixed it.

On "Landing page redesign" (Walk Crew):
1. Picking `tool.exe` showed "This file type is not allowed."; a 101 MB file showed "too-big.zip (101 MB)" and "Files can be up to 100 MB."; Submit stayed disabled for both. The `accept` list comes from the allowlist.
2. Delivered with a note and `Landing brief.pdf` (193 B): the card shows "Download Landing brief.pdf (193 B)".
3. The client downloaded it: original file name, SHA-256 identical. The URL (local S3 endpoint, `X-Amz-Expires=300`) returned `Content-Type: application/pdf` and `Content-Disposition: attachment; filename="Landing brief.pdf"; filename*=UTF-8''Landing%20brief.pdf`. Changing the file name or the key in the URL gave 403; after five minutes the URL gave 403 `ExpiredRequest`.
4. The client requested changes; delivered again with a 60 MB zip: progress showed ("Uploading… N%"), the whole delivery took about 7 seconds, and the client's download matched byte for byte.
5. Dev database: two `file_upload` rows (`application/pdf` 193, `application/zip` 62914560), both attached to their deliveries. A second change request left the project in progress (revisions 2).

Gaps logged in the sellers design §11.1: cleaning up unattached uploads and files of deleted projects, file retention, the presigned PUT staying valid for 15 minutes after the delivery (same size and type only), the CORS check on the deployed hosts, and the dev-only Vite cache glitch.
