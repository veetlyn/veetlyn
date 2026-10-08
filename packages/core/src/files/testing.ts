import type { FileStore } from "./store";

type PresignPutInput = Parameters<FileStore["presignPut"]>[0];
type PresignGetInput = Parameters<FileStore["presignGet"]>[0];

export function createFakeFileStore(): FileStore & {
  objects: Map<string, number>;
  puts: PresignPutInput[];
  gets: PresignGetInput[];
  deletes: string[][];
  put(key: string, sizeBytes: number): void;
} {
  const objects = new Map<string, number>();
  const puts: PresignPutInput[] = [];
  const gets: PresignGetInput[] = [];
  const deletes: string[][] = [];
  return {
    objects,
    puts,
    gets,
    deletes,
    put(key, sizeBytes) {
      objects.set(key, sizeBytes);
    },
    async presignPut(input) {
      puts.push({ ...input });
      return { url: `https://files.test/${input.key}?op=put`, headers: { "content-type": input.contentType } };
    },
    async presignGet(input) {
      gets.push({ ...input });
      return `https://files.test/${input.key}?op=get`;
    },
    async head(key) {
      const sizeBytes = objects.get(key);
      return sizeBytes === undefined ? null : { sizeBytes };
    },
    async delete(keys) {
      deletes.push([...keys]);
      for (const key of keys) objects.delete(key);
    },
  };
}
