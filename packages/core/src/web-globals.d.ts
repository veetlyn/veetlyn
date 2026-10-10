// Core compiles with no runtime types on purpose. These are the few web-standard globals it uses,
// which exist in Workers, Node 20+ and browsers alike.
declare const crypto: {
  randomUUID(): string;
  getRandomValues<T extends Uint8Array>(array: T): T;
  subtle: { digest(algorithm: "SHA-256", data: Uint8Array): Promise<ArrayBuffer> };
};
declare function btoa(data: string): string;
declare function atob(data: string): string;
declare class TextEncoder {
  encode(input?: string): Uint8Array;
}
