// Owned by the cards module. Lucas's daily card limits (settings table), like Anki's deck options: how many new
// cards are introduced per day and how many review cards are shown per day, across all decks. Cards being
// learned (new ones just seen, reviews just missed) are never limited: once started, they finish.
import { db } from "../db.ts";

export const MAX_NEW_PER_DAY = 200;
export const MAX_REVIEWS_PER_DAY = 2000;
const DEFAULTS = { newPerDay: 20, reviewsPerDay: 200 }; // Anki's defaults

export interface CardSettings { newPerDay: number; reviewsPerDay: number }

const read = (key: string) => (db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined)?.value;
const write = (key: string, value: string) =>
  db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value").run(key, value);

const clean = (v: unknown, max: number): number | null => (Number.isInteger(v) && (v as number) >= 0 && (v as number) <= max ? (v as number) : null);

export function cardSettings(): CardSettings {
  return {
    newPerDay: clean(Number(read("cards.newPerDay")), MAX_NEW_PER_DAY) ?? DEFAULTS.newPerDay,
    reviewsPerDay: clean(Number(read("cards.reviewsPerDay")), MAX_REVIEWS_PER_DAY) ?? DEFAULTS.reviewsPerDay,
  };
}

// Throws a user-facing message when a value is invalid; returns the saved settings.
export function saveCardSettings(body: { newPerDay?: unknown; reviewsPerDay?: unknown }): CardSettings {
  const fresh = clean(body.newPerDay, MAX_NEW_PER_DAY);
  if (fresh === null) throw new Error(`New cards per day must be a whole number from 0 to ${MAX_NEW_PER_DAY}`);
  const reviews = clean(body.reviewsPerDay, MAX_REVIEWS_PER_DAY);
  if (reviews === null) throw new Error(`Reviews per day must be a whole number from 0 to ${MAX_REVIEWS_PER_DAY}`);
  write("cards.newPerDay", String(fresh));
  write("cards.reviewsPerDay", String(reviews));
  return cardSettings();
}
