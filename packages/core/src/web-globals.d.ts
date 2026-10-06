// Core compiles with no runtime types on purpose. These are the few web-standard globals it uses,
// which exist in Workers, Node 20+ and browsers alike.
declare const crypto: { randomUUID(): string };
declare function btoa(data: string): string;
declare function atob(data: string): string;
declare class TextEncoder {
  encode(input?: string): Uint8Array;
}
