export const PROJECT_TABS = [
  { key: "overview", label: "Overview" },
  { key: "quote", label: "Quote" },
  { key: "delivery", label: "Delivery" },
  { key: "conversation", label: "Conversation" },
  { key: "money", label: "Finances" },
  { key: "activity", label: "People & activity" },
] as const;

export type ProjectTab = (typeof PROJECT_TABS)[number]["key"];
