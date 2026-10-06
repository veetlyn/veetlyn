import type { Context } from "./context";

type SessionValue = NonNullable<Context["session"]>;

// A fabricated session for callers whose procedures never touch Better Auth.
export function makeSession(userId: string): SessionValue {
  const now = new Date();
  return {
    session: {
      id: "session-1",
      token: "token-1",
      userId,
      expiresAt: new Date(now.getTime() + 60_000),
      createdAt: now,
      updatedAt: now,
      ipAddress: null,
      userAgent: null,
    },
    user: {
      id: userId,
      name: "Someone",
      email: `${userId}@example.com`,
      emailVerified: true,
      image: null,
      createdAt: now,
      updatedAt: now,
    },
  };
}
