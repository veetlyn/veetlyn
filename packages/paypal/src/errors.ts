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

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
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
  const record = asRecord(body);
  const details: PayPalErrorDetail[] = [];
  if (record && Array.isArray(record.details)) {
    for (const item of record.details) {
      const detail = asRecord(item);
      if (!detail) continue;
      details.push({
        field: typeof detail.field === "string" ? detail.field : undefined,
        value: typeof detail.value === "string" ? detail.value : undefined,
        issue: typeof detail.issue === "string" ? detail.issue : undefined,
        description: typeof detail.description === "string" ? detail.description : undefined,
      });
    }
  }
  return new PayPalError({
    status: response.status,
    message: typeof record?.message === "string" ? record.message : `PayPal answered ${response.status}`,
    debugId: typeof record?.debug_id === "string" ? record.debug_id : undefined,
    name: typeof record?.name === "string" ? record.name : undefined,
    details,
  });
}
