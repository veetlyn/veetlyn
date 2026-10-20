export const CONVERSATION_SPACES = ["request", "project"] as const;
export type ConversationSpace = (typeof CONVERSATION_SPACES)[number];

export const CONVERSATION_AUTHOR_KINDS = ["client", "member", "system"] as const;
export type ConversationAuthorKind = (typeof CONVERSATION_AUTHOR_KINDS)[number];

// `question` comes from the team and is answered by the client; `answer` links its question; `event` is
// written by Payleor in the same transaction as the change it reports.
export const CONVERSATION_MESSAGE_KINDS = ["text", "question", "answer", "event"] as const;
export type ConversationMessageKind = (typeof CONVERSATION_MESSAGE_KINDS)[number];

export const CONVERSATION_SURFACES = ["web", "mcp", "discord", "api", "email"] as const;
export type ConversationSurface = (typeof CONVERSATION_SURFACES)[number];

export const MAX_MESSAGE_LENGTH = 4000;
export const MAX_DECLINE_REASON = 1000;
