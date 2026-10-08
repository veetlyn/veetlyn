import { type FileStore, attachmentDisposition, fileContentType } from "@jendal-workspace/core";
import { AwsClient } from "aws4fetch";
import { z } from "zod";

// The subset of R2Bucket this adapter uses; a real R2Bucket satisfies it.
export interface SizedBucket {
  head(key: string): Promise<{ size: number } | null>;
  delete(keys: string[]): Promise<void>;
}

// R2Bucket.delete takes at most 1000 keys per call.
const DELETE_BATCH = 1000;

// Cloudflare.R2.S3Credentials value (alchemy): path-style addressing, `{endpoint}/{bucketName}/{key}`.
const s3CredentialsSchema = z.object({
  endpoint: z.string().min(1),
  bucketName: z.string().min(1),
  region: z.string().min(1),
  accessKeyId: z.string().min(1),
  secretAccessKey: z.string().min(1),
});

function parseCredentials(json: string) {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    throw new Error("The S3 credentials are not valid JSON.");
  }
  const parsed = s3CredentialsSchema.safeParse(value);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((issue) => issue.path.join(".")).join(", ");
    throw new Error(`The S3 credentials are missing or have invalid fields: ${fields}.`);
  }
  return parsed.data;
}

function createSigner(credentialsJson: string) {
  const { endpoint, bucketName, region, accessKeyId, secretAccessKey } = parseCredentials(credentialsJson);
  const client = new AwsClient({ accessKeyId, secretAccessKey, region, service: "s3" });
  function objectUrl(key: string, expiresInSeconds: number) {
    const path = key.split("/").map(encodeURIComponent).join("/");
    const url = new URL(`${endpoint}/${encodeURIComponent(bucketName)}/${path}`);
    url.searchParams.set("X-Amz-Expires", String(expiresInSeconds));
    return url;
  }
  return { client, objectUrl };
}

// The store is built when the Worker module loads, so the credentials are parsed on first use: a bad
// value then fails only the presign calls instead of every request.
export function createR2FileStore(bucket: SizedBucket, credentialsJson: string): FileStore {
  let signer: ReturnType<typeof createSigner> | undefined;
  const getSigner = () => (signer ??= createSigner(credentialsJson));

  return {
    async presignPut({ key, contentType, sizeBytes, expiresInSeconds }) {
      const { client, objectUrl } = getSigner();
      // Content type and length are signed so the browser can only upload what the server allowed.
      // aws4fetch leaves both out of SignedHeaders unless allHeaders is set.
      const signed = await client.sign(objectUrl(key, expiresInSeconds).toString(), {
        method: "PUT",
        headers: { "content-type": contentType, "content-length": String(sizeBytes) },
        aws: { signQuery: true, allHeaders: true },
      });
      // The browser sets content-length itself from the body.
      return { url: signed.url, headers: { "content-type": contentType } };
    },
    async presignGet({ key, fileName, expiresInSeconds }) {
      const { client, objectUrl } = getSigner();
      const url = objectUrl(key, expiresInSeconds);
      url.searchParams.set("response-content-disposition", attachmentDisposition(fileName));
      // An SVG served as image/svg+xml runs its scripts if a browser ever ignores the disposition.
      if (fileContentType(fileName) === "image/svg+xml") {
        url.searchParams.set("response-content-type", "application/octet-stream");
      }
      const signed = await client.sign(url.toString(), { method: "GET", aws: { signQuery: true } });
      return signed.url;
    },
    async head(key) {
      const object = await bucket.head(key);
      return object ? { sizeBytes: object.size } : null;
    },
    async delete(keys) {
      for (let start = 0; start < keys.length; start += DELETE_BATCH) {
        await bucket.delete(keys.slice(start, start + DELETE_BATCH));
      }
    },
  };
}
