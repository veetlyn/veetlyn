// Private file storage (sellers design §5.1): the browser uploads and downloads through short-lived presigned URLs.
export type FileStore = {
  presignPut(input: {
    key: string;
    contentType: string;
    sizeBytes: number;
    expiresInSeconds: number;
  }): Promise<{ url: string; headers: Record<string, string> }>;
  presignGet(input: { key: string; fileName: string; expiresInSeconds: number }): Promise<string>;
  head(key: string): Promise<{ sizeBytes: number } | null>;
  // Missing keys are not an error.
  delete(keys: string[]): Promise<void>;
};
