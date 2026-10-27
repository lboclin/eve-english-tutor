// Groups GPT-Live transcript deltas into utterances per speaker and posts them to the server in batches.
// Deltas have no turn/item ids (live-conversations.md), so an utterance ends when that speaker's next fragment
// starts more than GAP_MS after the previous one on the session timeline, or when no fragment arrived for IDLE_MS.
// Utterances are posted in start order: one is only sent when no still-open utterance started before it.
import { api } from "../data/api";

export type Speaker = "you" | "eve";
export interface Utterance {
  speaker: Speaker;
  text: string;
  start_ms: number;
  end_ms: number;
}

const GAP_MS = 1500;
const IDLE_MS = 2500;
const FLUSH_EVERY_MS = 5000;

export class TranscriptSink {
  private open: Partial<Record<Speaker, Utterance & { touched: number }>> = {};
  private done: Utterance[] = [];
  private posting: Promise<unknown> = Promise.resolve();
  private timer: ReturnType<typeof setInterval>;
  sessionId: number;
  offsetMs = 0; // added to every timing; a resumed GPT-Live session restarts its timeline at 0
  lastEndMs = 0; // latest timeline position seen (with offset), used to place the next segment
  onError: (message: string) => void = () => {};

  constructor(sessionId: number) {
    this.sessionId = sessionId;
    this.timer = setInterval(() => {
      this.closeIdle();
      void this.flush(false);
    }, FLUSH_EVERY_MS / 5);
  }

  add(speaker: Speaker, delta: string, startMs: number, endMs: number) {
    const start = startMs + this.offsetMs;
    const end = endMs + this.offsetMs;
    this.lastEndMs = Math.max(this.lastEndMs, end);
    const cur = this.open[speaker];
    if (cur && start - cur.end_ms <= GAP_MS) {
      cur.text += delta; // fragments are appended exactly as received (they carry their own spaces)
      cur.end_ms = Math.max(cur.end_ms, end);
      cur.touched = Date.now();
      return;
    }
    if (cur) this.finish(speaker);
    this.open[speaker] = { speaker, text: delta, start_ms: start, end_ms: end, touched: Date.now() };
  }

  private finish(speaker: Speaker) {
    const u = this.open[speaker];
    delete this.open[speaker];
    if (u && u.text.trim()) this.done.push({ speaker, text: u.text.trim(), start_ms: u.start_ms, end_ms: u.end_ms });
  }

  private closeIdle() {
    for (const s of ["you", "eve"] as const) {
      const u = this.open[s];
      if (u && Date.now() - u.touched > IDLE_MS) this.finish(s);
    }
  }

  private lastPost = 0;
  private lastError: string | null = null;
  // all = true (End / Pause) closes every open utterance, posts everything and THROWS if anything is still
  // unsaved, so the caller can stop and offer a retry instead of ending the talk with utterances lost.
  async flush(all: boolean): Promise<void> {
    if (all) {
      this.finish("you");
      this.finish("eve");
    } else if (Date.now() - this.lastPost < FLUSH_EVERY_MS) return;
    // A batch already in flight either lands or puts its items back into `done` before we pick ours.
    await this.posting;
    const openStarts = Object.values(this.open).map((u) => u!.start_ms);
    const limit = openStarts.length ? Math.min(...openStarts) : Infinity;
    this.done.sort((a, b) => a.start_ms - b.start_ms);
    const ready = this.done.filter((u) => u.start_ms < limit);
    if (ready.length) {
      this.done = this.done.filter((u) => u.start_ms >= limit);
      this.lastPost = Date.now();
      const id = this.sessionId;
      this.posting = api(`/talk/sessions/${id}/transcript`, { body: { items: ready } }).then(
        () => {
          this.lastError = null;
        },
        (e) => {
          this.done.unshift(...ready); // keep them for the next flush
          this.lastError = e instanceof Error ? e.message : String(e);
          if (!all) this.onError(`Transcript not saved yet: ${this.lastError}`);
        },
      );
    }
    if (!all) return;
    await this.posting; // also covers a concurrent periodic flush that picked items after us
    if (this.done.length) throw new Error(`the transcript couldn't be saved (${this.lastError ?? "server unreachable"})`);
  }

  // Everything not yet posted, for a last-chance sendBeacon on page hide.
  pending(): Utterance[] {
    const open = Object.values(this.open)
      .filter((u) => u && u.text.trim())
      .map((u) => ({ speaker: u!.speaker, text: u!.text.trim(), start_ms: u!.start_ms, end_ms: u!.end_ms }));
    return [...this.done, ...open].sort((a, b) => a.start_ms - b.start_ms);
  }

  dispose() {
    clearInterval(this.timer);
  }
}
