// Deck categories shared by every screen (ids match server/lib/cards-repo.ts). All data comes from the server.

export type Category = "vocabulary" | "collocations" | "phrasal" | "grammar" | "pronunciation";

export const CATEGORIES: { id: Category; name: string; emoji: string }[] = [
  { id: "vocabulary", name: "Vocabulary", emoji: "📖" },
  { id: "collocations", name: "Collocations", emoji: "🔗" },
  { id: "phrasal", name: "Phrasal verbs", emoji: "🧩" },
  { id: "grammar", name: "Grammar", emoji: "✏️" },
  { id: "pronunciation", name: "Pronunciation", emoji: "🗣️" },
];

export interface Deck { total: number; newCount: number; due: number }
