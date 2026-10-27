// Owned by the talk module. Lucas's talk settings (settings table): the weekdays on which Interview is the day's
// talk, the job he's interviewing for, which goes word for word into the Interview prompt (prompts/tutor.ts), and
// Eve's voice in the talks (GPT-Live audio.output.voice).
import { db } from "../db.ts";

export const MAX_JOB_LENGTH = 30;
const DEFAULT_DAYS = [3, 6]; // Wednesday & Saturday (0 = Sunday)
const DEFAULT_JOB = "Software Engineer";
// Two GPT-Live voices (developers.openai.com/api/docs/guides/live-conversations#voice-options), each with the
// tutor's name in the talks: a man called Eve made no sense. They are also TTS voices, so Settings can play a
// sample of each without opening a live session.
export const TUTOR_NAMES = { marin: "Eve", cedar: "Wally" } as const;
export type TalkVoice = keyof typeof TUTOR_NAMES;
export const TALK_VOICES = Object.keys(TUTOR_NAMES) as TalkVoice[];
const DEFAULT_VOICE: TalkVoice = "marin";
const isVoice = (v: unknown): v is TalkVoice => TALK_VOICES.includes(v as TalkVoice);

export interface TalkSettings {
  interviewDays: number[];
  interviewJob: string;
  voice: TalkVoice;
  tutorName: string;
}

const read = (key: string) => (db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined)?.value;
const write = (key: string, value: string) =>
  db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value").run(key, value);

const cleanDays = (v: unknown): number[] | null =>
  Array.isArray(v) && v.every((d) => Number.isInteger(d) && d >= 0 && d <= 6) ? [...new Set(v as number[])].sort() : null;
// One line of plain text: no quotes or control characters, so it can't break out of the prompt sentence.
const cleanJob = (v: unknown) => (typeof v === "string" ? v.replace(/[\u0000-\u001f"“”]/g, " ").replace(/\s+/g, " ").trim() : "");

export function talkSettings(): TalkSettings {
  const days = cleanDays(JSON.parse(read("talk.interviewDays") ?? "null"));
  const voice = read("talk.voice");
  return {
    interviewDays: days ?? DEFAULT_DAYS,
    interviewJob: cleanJob(read("talk.interviewJob")) || DEFAULT_JOB,
    voice: isVoice(voice) ? voice : DEFAULT_VOICE,
    tutorName: TUTOR_NAMES[isVoice(voice) ? voice : DEFAULT_VOICE],
  };
}

// Throws a user-facing message when a value is invalid; returns the saved settings.
export function saveTalkSettings(body: { interviewDays?: unknown; interviewJob?: unknown; voice?: unknown }): TalkSettings {
  const days = cleanDays(body.interviewDays);
  if (!days) throw new Error("Interview days must be weekdays from 0 (Sunday) to 6 (Saturday)");
  const job = cleanJob(body.interviewJob);
  if (!job) throw new Error("Write the job you're applying for");
  if (job.length > MAX_JOB_LENGTH) throw new Error(`The job can have at most ${MAX_JOB_LENGTH} characters`);
  const voice = body.voice ?? talkSettings().voice;
  if (!isVoice(voice)) throw new Error(`The voice must be one of: ${TALK_VOICES.join(", ")}`);
  write("talk.interviewDays", JSON.stringify(days));
  write("talk.voice", voice);
  write("talk.interviewJob", job);
  return talkSettings();
}
