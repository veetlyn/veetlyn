// Core compiles with no runtime types on purpose. These are the few web-standard globals it uses,
// which exist in Workers, Node 20+ and browsers alike.
interface CryptoKey {
  readonly type: string;
}
type AesGcmParams = { name: "AES-GCM"; iv: Uint8Array; additionalData: Uint8Array };
declare const crypto: {
  randomUUID(): string;
  getRandomValues<T extends Uint8Array>(array: T): T;
  subtle: {
    digest(algorithm: "SHA-256", data: Uint8Array): Promise<ArrayBuffer>;
    importKey(
      format: "raw",
      keyData: Uint8Array,
      algorithm: { name: "AES-GCM" },
      extractable: boolean,
      usages: ("encrypt" | "decrypt")[],
    ): Promise<CryptoKey>;
    encrypt(algorithm: AesGcmParams, key: CryptoKey, data: Uint8Array): Promise<ArrayBuffer>;
    decrypt(algorithm: AesGcmParams, key: CryptoKey, data: Uint8Array): Promise<ArrayBuffer>;
  };
};
declare function btoa(data: string): string;
declare function atob(data: string): string;
declare class TextEncoder {
  encode(input?: string): Uint8Array;
}
declare class TextDecoder {
  decode(input?: ArrayBuffer | Uint8Array): string;
}
