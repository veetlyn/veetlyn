// AES-GCM 256 for secrets Payleor stores on behalf of a team, such as its PayPal REST app secret.

export type SealedSecret = { ciphertext: string; iv: string; keyId: string };

const KEY_BYTES = 32;
const IV_BYTES = 12;

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(text), (char) => char.charCodeAt(0));
}

export async function importSecretKey(base64Key: string): Promise<CryptoKey> {
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    bytes = fromBase64(base64Key);
  } catch (cause) {
    throw new Error("The secret key is not valid base64.", { cause });
  }
  if (bytes.length !== KEY_BYTES) throw new Error(`The secret key must be ${KEY_BYTES} bytes, not ${bytes.length}.`);
  return crypto.subtle.importKey("raw", bytes, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

// `context` is bound as additional data: a sealed secret copied to another row (another team) does not open.
export async function sealSecret(
  key: CryptoKey,
  keyId: string,
  plaintext: string,
  context: string,
): Promise<SealedSecret> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(context) },
    key,
    new TextEncoder().encode(plaintext),
  );
  return { ciphertext: toBase64(new Uint8Array(ciphertext)), iv: toBase64(iv), keyId };
}

// Throws when the key, the context or the ciphertext does not match.
export async function openSecret(key: CryptoKey, sealed: SealedSecret, context: string): Promise<string> {
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromBase64(sealed.iv), additionalData: new TextEncoder().encode(context) },
    key,
    fromBase64(sealed.ciphertext),
  );
  return new TextDecoder().decode(plaintext);
}
