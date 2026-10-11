import { errorBodySchema } from "./schemas";

export type PayPalErrorDetail = {
  field?: string;
  value?: string;
  issue?: string;
  description?: string;
};

export class PayPalError extends Error {
  readonly status: number;
  readonly debugId: string | undefined;
  readonly details: PayPalErrorDetail[];

  constructor(input: { status: number; message: string; debugId?: string; name?: string; details?: PayPalErrorDetail[] }) {
    super(input.message);
    // PayPal's error name (INVALID_REQUEST, …) is more useful in logs than the class name.
    this.name = input.name ?? "PayPalError";
    this.status = input.status;
    this.debugId = input.debugId;
    this.details = input.details ?? [];
  }
}

// Error bodies carry name, message, details and debug_id (Fact 3).
export async function payPalErrorFromResponse(response: Response): Promise<PayPalError> {
  const text = await response.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    body = undefined;
  }
  const parsed = errorBodySchema.safeParse(body);
  const record = parsed.success ? parsed.data : null;
  return new PayPalError({
    status: response.status,
    message: record?.message ?? `PayPal answered ${response.status}`,
    debugId: record?.debug_id,
    name: record?.name,
    details: record?.details ?? [],
  });
}
