// App state, backed by Eve's server: /api/today (to-do, streak) and /api/cards/decks (deck counts).
// Screens that change data on the server call actions.refresh() afterwards so Home, the top bar and the
// decks stay in step. A small localStorage copy of the last snapshot gives an instant first paint only.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api } from "./api";
import { CATEGORIES, type Category, type Deck } from "./categories";
import { DEFAULT_INTERVIEW_DAYS } from "./talk";

export interface DecksResponse {
  decks: Record<Category, Deck>;
  total: number;
  due: number;
  newCount: number; // across decks, capped by today's new-card limit
  newPerDay: number;
  newLeftToday: number;
  reviewsPerDay: number;
  reviewsLeftToday: number;
  ankiCards: number;
}

export interface TodayResponse {
  date: string; // local YYYY-MM-DD
  talkedMinutes: number;
  talkedToday: boolean;
  reviewedToday: number;
  readIds: string[]; // articles read today
  due: number;
  newCount: number;
  tasks: { talk: boolean; cards: boolean; read: boolean };
  days: number[]; // tasks done per day (0–3), oldest first, ending today
  streak: number;
  longest: number;
  interviewDays?: number[]; // weekdays with Interview as the day's talk (absent in old cached snapshots)
  tutorName?: string; // the talk tutor's name, after the voice: Eve or Wally
}

interface State {
  loaded: boolean; // false until the first server answer (or cached snapshot)
  decks: Record<Category, Deck>;
  totalCards: number;
  cardsDue: number; // across decks
  cardsNew: number; // across decks, capped by today's new-card limit
  ankiImported: boolean;
  today: TodayResponse;
  talkedMinutes: number; // today
  reviewed: number; // cards reviewed today
  readIds: string[]; // articles read today
}

const KEY = "eve:snapshot";
const emptyDecks = () => Object.fromEntries(CATEGORIES.map((c) => [c.id, { total: 0, newCount: 0, due: 0 }])) as Record<Category, Deck>;
const EMPTY_DECKS: DecksResponse = { decks: emptyDecks(), total: 0, due: 0, newCount: 0, newPerDay: 20, newLeftToday: 20, reviewsPerDay: 200, reviewsLeftToday: 200, ankiCards: 0 };
const EMPTY_TODAY: TodayResponse = {
  date: "", talkedMinutes: 0, talkedToday: false, reviewedToday: 0, readIds: [], due: 0, newCount: 0,
  tasks: { talk: false, cards: false, read: false }, days: Array(364).fill(0), streak: 0, longest: 0,
};

function build(decks: DecksResponse, today: TodayResponse, loaded: boolean): State {
  return {
    loaded, decks: decks.decks, totalCards: decks.total, cardsDue: decks.due, cardsNew: decks.newCount, ankiImported: decks.ankiCards > 0, today,
    talkedMinutes: today.talkedMinutes, reviewed: today.reviewedToday, readIds: today.readIds,
  };
}

function cached(): { decks: DecksResponse; today: TodayResponse } | null {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? "null") as { decks: DecksResponse; today: TodayResponse } | null;
    return s?.decks?.decks && Array.isArray(s.today?.days) ? s : null;
  } catch {
    return null;
  }
}

function useEveState() {
  const [state, setState] = useState<State>(() => {
    const c = cached();
    return c ? build(c.decks, c.today, true) : build(EMPTY_DECKS, EMPTY_TODAY, false);
  });
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0); // ignore answers that arrive after a newer refresh

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    if (error) setToast(`Can't reach Eve's server (${error}). Is npm run dev running?`);
  }, [error]);

  const refresh = useCallback(async () => {
    const mine = ++seq.current;
    try {
      const [decks, today] = await Promise.all([api<DecksResponse>("/cards/decks"), api<TodayResponse>("/today")]);
      if (mine !== seq.current) return;
      setState(build(decks, today, true));
      setError(null);
      try {
        localStorage.setItem(KEY, JSON.stringify({ decks, today }));
      } catch {
        /* private mode etc.: just no instant first paint */
      }
    } catch (e) {
      if (mine === seq.current) setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    refresh();
    // Catch the day rolling over (or work done in another tab) when Eve comes back into view.
    const onFocus = () => document.visibilityState === "visible" && refresh();
    document.addEventListener("visibilitychange", onFocus);
    return () => document.removeEventListener("visibilitychange", onFocus);
  }, [refresh]);

  const actions = useMemo(
    () => ({
      // Re-read decks + today from the server. Call after anything that saves cards, reviews, sessions or reads.
      refresh,
      notify: setToast,
      // Talk calls this on End; the talk itself is saved by the server, so this only refreshes Today.
      completeTalk: (_minutes: number) => void refresh(),
      markRead: async (articleId: string, score?: number) => {
        await api("/reads", { body: { articleId, score } });
        await refresh();
      },
    }),
    [refresh],
  );

  const derived = useMemo(() => {
    const { today } = state;
    const days = today.days;
    return {
      due: state.cardsDue, newCount: state.cardsNew, doneToday: days[days.length - 1] > 0, days, streak: today.streak, longest: today.longest, tasks: today.tasks,
      interviewDays: today.interviewDays ?? DEFAULT_INTERVIEW_DAYS,
      tutorName: today.tutorName ?? "Eve",
    };
  }, [state]);

  return { state, toast, error, actions, ...derived };
}

type Eve = ReturnType<typeof useEveState>;
const EveContext = createContext<Eve | null>(null);

export function EveProvider({ children }: { children: ReactNode }) {
  const value = useEveState();
  return <EveContext.Provider value={value}>{children}</EveContext.Provider>;
}

export function useEve(): Eve {
  const ctx = useContext(EveContext);
  if (!ctx) throw new Error("useEve outside EveProvider");
  return ctx;
}
