// Talk types. Adding a new one = one entry here; Home, the Talk tab and the session screen read this list.
// Mode ids and correction styles must match server/prompts/tutor.ts (the GPT-Live prompt layers).
export type TalkModeId = "daily" | "interview";
export type CorrectionStyle = "after-turn" | "interject";

// Cost guard: a talk ends on its own after this many minutes of open GPT-Live time (US$0.05/min).
export const MAX_TALK_MIN = 40;

export interface TalkMode {
  id: TalkModeId;
  title: string;
  blurb: string;
  goalMin: number;
  scheduled?: boolean; // on the interview days from the Talk settings; the unscheduled mode fills the rest
}

export const TALK_MODES: TalkMode[] = [
  { id: "interview", title: "Interview", blurb: "Eve is the interviewer: a mock job interview, question by question.", goalMin: 20, scheduled: true },
  { id: "daily", title: "Daily-talk", blurb: "A free conversation. Eve follows your interests and corrects you as you go.", goalMin: 15 },
];

export function talkMode(id: string): TalkMode {
  return TALK_MODES.find((m) => m.id === id) ?? TALK_MODES.find((m) => m.id === "daily")!;
}

// Interview on the interview days (Talk → ⚙️ Settings, default Wed & Sat; served with /api/today), Daily-talk on
// the other days.
export const DEFAULT_INTERVIEW_DAYS = [3, 6];
export function todaysTalk(interviewDays = DEFAULT_INTERVIEW_DAYS, date = new Date()): TalkMode {
  return interviewDays.includes(date.getDay()) ? talkMode("interview") : talkMode("daily");
}

export const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export const weekdayNames = (days: number[]) =>
  days.map((d) => WEEKDAYS[d]).join(" & ");
