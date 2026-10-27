import { useEffect, useRef, useState } from "react";
import { EveOrb, YouOrb } from "../components/Orb";
import { useEve } from "../data/store";
import { navigate } from "../router";
import { MAX_TALK_MIN, TALK_MODES, talkMode, todaysTalk, weekdayNames, WEEKDAYS, type CorrectionStyle, type TalkModeId } from "../data/talk";
import { api } from "../data/api";
import { playAudio } from "../data/speech";
import { openLive, talkApi, type CloseResult, type LiveConnection } from "../live/client";
import { loadAudioPrefs, micConstraints, saveAudioPrefs, setOutput, useAudioDevices, type AudioPrefs } from "../live/devices";
import { levelMeter, type LevelMeter } from "../live/levels";
import { TranscriptSink } from "../live/transcript";

// connecting → live ⇄ (pausing → paused → resuming) → ending. Pause CLOSES the GPT-Live session (it bills per
// second while open; muting would keep billing) and Resume opens a new one seeded with the transcript so far.
type Phase = "idle" | "connecting" | "live" | "pausing" | "paused" | "resuming" | "ending";

// The talk that just ended (TalkReview reads it; the full session lives in the database under `id`).
export const lastSession = { id: 0, mode: "daily" as TalkModeId, seconds: 0 };

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]);
}

export function TalkHub() {
  const { interviewDays } = useEve();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const today = todaysTalk(interviewDays);
  const others = TALK_MODES.filter((m) => m.id !== today.id);
  return (
    <div className="stack" style={{ gap: 24 }}>
      <div className="row">
        <h1>Talk</h1>
        <div className="spacer" />
        <button className="btn" onClick={() => setSettingsOpen((o) => !o)} aria-expanded={settingsOpen}>⚙️ Settings</button>
      </div>
      {settingsOpen && <TalkSettingsPanel onClose={() => setSettingsOpen(false)} />}
      <section className="panel" style={{ background: "linear-gradient(160deg, var(--surface) 45%, var(--talk-soft))" }}>
        <span className="chip" style={{ background: "var(--talk)", color: "var(--talk-ink)" }}>Today's talk</span>
        <h2 style={{ fontSize: 26, margin: "12px 0 6px" }}>{today.title}</h2>
        <p className="muted" style={{ marginTop: 0 }}>{today.blurb} · Goal: {today.goalMin} min</p>
        <button className="btn talk big" onClick={() => navigate(`/talk/${today.id}`)}>Open</button>
      </section>
      <h2 className="muted" style={{ fontSize: 15 }}>Other talks</h2>
      <div className="grid">
        {others.map((m) => (
          <section key={m.id} className="panel span-6">
            <h2><span className="dot" style={{ background: "var(--talk)" }} />{m.title}</h2>
            <p className="muted small">{m.blurb}{m.scheduled ? (interviewDays.length ? ` Scheduled on ${weekdayNames(interviewDays)}.` : " Not scheduled on any day.") : ""}</p>
            <button className="btn talk" onClick={() => navigate(`/talk/${m.id}`)}>Open</button>
          </section>
        ))}
      </div>
    </div>
  );
}

type TalkVoice = "marin" | "cedar";
interface TalkSettings { interviewDays: number[]; interviewJob: string; voice: TalkVoice }
// Same voices and names as server/lib/talk-settings.ts TUTOR_NAMES (the tutor takes the voice's name).
const VOICES: { id: TalkVoice; name: string }[] = [
  { id: "marin", name: "Eve" },
  { id: "cedar", name: "Wally" },
];
const MAX_JOB_LENGTH = 30; // same limit as server/lib/talk-settings.ts

// Who you talk to (Eve or Wally: the voice), the interview days and the job you're interviewed for (it goes word
// for word into the Interview prompt).
function TalkSettingsPanel({ onClose }: { onClose: () => void }) {
  const { actions } = useEve();
  const [settings, setSettings] = useState<TalkSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  useEffect(() => {
    api<TalkSettings>("/talk/settings").then(setSettings, (e: Error) => setError(e.message));
  }, []);
  const toggle = (d: number) =>
    setSettings((s) => s && { ...s, interviewDays: s.interviewDays.includes(d) ? s.interviewDays.filter((x) => x !== d) : [...s.interviewDays, d].sort() });
  const job = settings?.interviewJob.trim() ?? "";
  function test() {
    if (!settings) return;
    setTesting(true);
    playAudio("/talk/voice-sample", { voice: settings.voice }, {
      onEnd: () => setTesting(false),
      onError: (m) => {
        setTesting(false);
        setError(m);
      },
    });
  }
  async function save() {
    if (!settings) return;
    setSaving(true);
    setError(null);
    try {
      await api("/talk/settings", { body: { interviewDays: settings.interviewDays, interviewJob: job, voice: settings.voice } });
      await actions.refresh();
      actions.notify("Talk settings saved.");
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }
  return (
    <section className="panel fade-in">
      <h2 style={{ marginTop: 0 }}>Talk</h2>
      {!settings ? (
        <p className="small muted">{error ?? "Loading…"}</p>
      ) : (
        <div className="stack" style={{ gap: 16 }}>
          <div className="stack" style={{ gap: 8 }}>
            <span className="small muted">Who you talk to</span>
            <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
              {VOICES.map((v) => {
                const on = settings.voice === v.id;
                return (
                  <button key={v.id} className="chip" aria-pressed={on} onClick={() => setSettings({ ...settings, voice: v.id })}
                    style={{ cursor: "pointer", border: 0, padding: "8px 14px", background: "var(--talk)", color: "var(--talk-ink)", opacity: on ? 1 : 0.4 }}>
                    {on ? "✓ " : ""}{v.name}
                  </button>
                );
              })}
              <button className="btn" style={{ padding: "8px 16px" }} disabled={testing} onClick={test}>{testing ? "Playing…" : "▶ Test"}</button>
            </div>
          </div>
          <div className="stack" style={{ gap: 8 }}>
            <span className="small muted">Days when Interview is today's talk (the other days are Daily-talk)</span>
            <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
              {WEEKDAYS.map((name, d) => {
                const on = settings.interviewDays.includes(d);
                return (
                  <button key={d} className="chip" aria-pressed={on} onClick={() => toggle(d)}
                    style={{ cursor: "pointer", border: 0, padding: "8px 14px", background: "var(--talk)", color: "var(--talk-ink)", opacity: on ? 1 : 0.4 }}>
                    {on ? "✓ " : ""}{name}
                  </button>
                );
              })}
            </div>
          </div>
          <label className="stack" style={{ gap: 8 }}>
            <span className="small muted">Job you're applying for (you're interviewed for it)</span>
            <div className="row" style={{ gap: 10 }}>
              <input className="text-input" value={settings.interviewJob} maxLength={MAX_JOB_LENGTH} placeholder="e.g. Backend Engineer"
                onChange={(e) => setSettings({ ...settings, interviewJob: e.target.value })} />
              <span className="small muted">{settings.interviewJob.length}/{MAX_JOB_LENGTH}</span>
            </div>
          </label>
          {error && <p className="small" role="alert" style={{ color: "var(--mistake-ink)", margin: 0 }}>{error}</p>}
          <div className="row" style={{ gap: 10 }}>
            <button className="btn talk" disabled={saving || !job} onClick={save}>{saving ? "Saving…" : "Save"}</button>
            <button className="btn" onClick={onClose}>Cancel</button>
            {!job && <span className="small muted">Write the job first.</span>}
          </div>
        </div>
      )}
    </section>
  );
}

export function TalkSession({ mode }: { mode: TalkModeId }) {
  const { actions, tutorName: tutor } = useEve();
  const cfg = talkMode(mode);
  const [phase, setPhase] = useState<Phase>("idle");
  const [style, setStyle] = useState<CorrectionStyle>("after-turn");
  const [seconds, setSeconds] = useState(0);
  const [you, setYou] = useState(0);
  const [eve, setEve] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [step, setStep] = useState("");
  const devices = useAudioDevices();
  const [audio, setAudio] = useState<AudioPrefs>(loadAudioPrefs);
  const pickAudio = (p: Partial<AudioPrefs>) =>
    setAudio((prev) => {
      const next = { ...prev, ...p };
      saveAudioPrefs(next);
      return next;
    });

  // Everything that outlives a render. One talk = one `sessions` row (talkId) + one GPT-Live session per segment.
  const r = useRef<{
    talkId: number | null;
    mic: MediaStream | null;
    ctx: AudioContext | null;
    youMeter: LevelMeter | null;
    eveMeter: LevelMeter | null;
    conn: LiveConnection | null;
    sink: TranscriptSink | null;
    segments: CloseResult[];
    seconds: number;
    phase: Phase;
    done: boolean; // the talk row is ended (or was never created and everything is released)
    cancelled: boolean; // the screen is being left: in-flight start/resume must not leave anything open
    pending: Promise<void> | null; // start / pause / resume in flight; finish() waits for it
    finishing: Promise<number | null> | null;
  }>({
    talkId: null, mic: null, ctx: null, youMeter: null, eveMeter: null, conn: null, sink: null, segments: [],
    seconds: 0, phase: "idle", done: false, cancelled: false, pending: null, finishing: null,
  });
  const audioEl = useRef<HTMLAudioElement>(null);
  r.current.seconds = seconds;
  r.current.phase = phase;

  // Timer: counts only while the line to Eve is open. Cost guard: auto-end at MAX_TALK_MIN.
  useEffect(() => {
    if (phase !== "live") return;
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [phase]);
  useEffect(() => {
    if (phase !== "live") return;
    if (seconds === (MAX_TALK_MIN - 2) * 60) setNotice(`Two minutes left: talks end on their own at ${MAX_TALK_MIN} minutes.`);
    if (seconds >= MAX_TALK_MIN * 60) {
      setNotice(`That's ${MAX_TALK_MIN} minutes, great work! ${tutor} wrapped up the talk to keep costs in check.`);
      void end();
    }
  }, [seconds, phase]);

  // Orbs follow the real audio: your mic and Eve's GPT-Live voice.
  useEffect(() => {
    if (phase !== "live") {
      setYou(0);
      setEve(0);
      return;
    }
    let raf = 0;
    const tick = () => {
      const e = r.current.eveMeter?.read() ?? 0;
      const y = r.current.youMeter?.read() ?? 0;
      setEve(e > 0.04 ? e : 0);
      // The built-in mic hears the room (fan, keys, the speakers), and the meter's gain turns that into a shake:
      // gate the background out, as for Eve.
      setYou(y > 0.06 ? y : 0);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [phase]);

  // Eve's voice goes to the chosen speaker; can be switched mid-talk.
  useEffect(() => {
    if (audioEl.current) void setOutput(audioEl.current, audio.output, devices.outputs);
  }, [audio.output, devices.outputs]);

  // Leaving the screen any other way: tab closed → one beacon (transcript + end together, so the evaluator
  // never runs before the last utterances are stored; review stays on because Lucas did talk). Unmount
  // (top-bar link) → cancel whatever is in flight and end the talk without review, like Back.
  useEffect(() => {
    // React's StrictMode (dev) runs this cleanup once right after mounting, then mounts again: start fresh, or
    // every later Start would see "cancelled" and stop silently.
    r.current.cancelled = false;
    r.current.done = false;
    const onHide = () => {
      const s = r.current;
      if (s.done || s.talkId === null) return;
      const segments = s.conn ? [...s.segments, s.conn.usage()] : s.segments;
      talkApi.beacon(s.talkId, s.seconds, segments, s.sink?.pending() ?? []);
      s.done = true;
    };
    addEventListener("pagehide", onHide);
    return () => {
      removeEventListener("pagehide", onHide);
      r.current.cancelled = true;
      void finish(false).catch(() => {});
    };
  }, []);

  function release() {
    const s = r.current;
    s.youMeter?.dispose();
    s.eveMeter?.dispose();
    s.mic?.getTracks().forEach((t) => t.stop());
    void s.ctx?.close();
    s.sink?.dispose();
    Object.assign(s, { mic: null, ctx: null, youMeter: null, eveMeter: null, conn: null });
  }

  const setMic = (on: boolean) => r.current.mic?.getAudioTracks().forEach((t) => (t.enabled = on));
  const showError = (m: string) =>
    // An empty message clears the autoplay warning once Eve's audio plays (client.ts).
    setError((prev) => (m ? m : prev?.startsWith("The browser blocked") ? null : prev));

  // Runs a start / pause / resume step; finish() waits for it before closing anything.
  function track(op: Promise<void>) {
    const s = r.current;
    s.pending = op;
    return op.finally(() => {
      if (s.pending === op) s.pending = null;
    });
  }

  // Opens one GPT-Live session (a new talk, or the next segment after a pause). If OpenAI created the
  // session but the connection then failed, its 15 s minimum is still billed: record it as a segment.
  async function connect() {
    const s = r.current;
    let created: string | null = null;
    let conn: LiveConnection;
    try {
      conn = await openLive({
        mic: s.mic!,
        audioEl: audioEl.current!,
        onStep: setStep,
        create: async (sdp) => {
          const res = await talkApi.create(s.talkId === null ? { mode, style, sdp } : { resumeId: s.talkId, sdp });
          s.talkId = res.id;
          created = res.liveSessionId;
          if (!s.sink) {
            s.sink = new TranscriptSink(res.id);
            s.sink.onError = showError;
          }
          return res;
        },
        handlers: {
          onTranscript: (speaker, delta, a, b) => s.sink?.add(speaker, delta, a, b),
          onError: showError,
          onDropped: (seg) => {
            s.segments.push(seg);
            s.conn = null;
            s.eveMeter?.dispose();
            s.eveMeter = null;
            setMic(false);
            void s.sink?.flush(true).catch(() => {}); // retried by the next flush / End
            if (s.phase === "live" && !s.cancelled) {
              setNotice(`The line to ${tutor} dropped (${seg.reason.replace("_", " ")}). Resume to keep talking.`);
              setPhase("paused");
            }
          },
        },
      });
    } catch (e) {
      if (created) s.segments.push({ liveSessionId: created, seconds: 15, reason: "connect_failed", confirmed: false });
      throw e;
    }
    s.conn = conn; // if the screen was left meanwhile, finish() (waiting on this step) closes it
    s.eveMeter = conn.remote.getAudioTracks().length && s.ctx ? levelMeter(s.ctx, conn.remote) : null;
  }

  function start() {
    setError(null);
    setNotice(null);
    setPhase("connecting");
    const s = r.current;
    s.ctx = new AudioContext(); // created inside the click so it isn't suspended
    return track(
      (async () => {
        let mic: MediaStream;
        try {
          setStep("opening the microphone");
          const asked = navigator.mediaDevices.getUserMedia({ audio: micConstraints(audio.input, devices.inputs) });
          // If it answers after the timeout, turn that late mic off again.
          mic = await withTimeout(asked, 10_000).catch((e) => {
            void asked.then((m) => m.getTracks().forEach((t) => t.stop()), () => {});
            throw e;
          });
        } catch (e) {
          release();
          if (s.cancelled) return;
          setError(
            e instanceof Error && e.message === "timeout"
              ? "The microphone didn't respond in 10 s. Try another microphone in the list below, then press Start again."
              : `${tutor} can't hear you: allow the microphone for this page, then press Start again.`,
          );
          return setPhase("idle");
        }
        s.mic = mic;
        if (s.cancelled || !s.ctx) return release();
        s.youMeter = levelMeter(s.ctx, mic);
        try {
          await connect();
          if (!s.cancelled) setPhase("live");
        } catch (e) {
          if (!s.cancelled) setError(e instanceof Error ? e.message : String(e));
          // The GPT-Live session may have been created before the failure: end the row so its 15 s are recorded.
          if (s.talkId !== null) await talkApi.end(s.talkId, 0, s.segments, { review: false }).catch(() => {});
          s.sink?.dispose();
          Object.assign(s, { talkId: null, sink: null, segments: [] });
          release();
          if (!s.cancelled) setPhase("idle");
        }
      })(),
    );
  }

  function togglePause() {
    const s = r.current;
    setError(null);
    if (phase === "live") {
      setPhase("pausing");
      return track(
        (async () => {
          setMic(false);
          const conn = s.conn;
          s.conn = null;
          if (conn) s.segments.push(await conn.close());
          s.eveMeter?.dispose();
          s.eveMeter = null;
          await s.sink?.flush(true).catch((e) => !s.cancelled && setError(`Not saved yet: ${e.message}. It will retry.`));
          if (s.cancelled) return;
          setNotice(null);
          setPhase("paused");
        })(),
      );
    }
    if (phase === "paused") {
      setPhase("resuming");
      setNotice(null);
      return track(
        (async () => {
          if (s.sink) s.sink.offsetMs = s.sink.lastEndMs + 2000; // the new GPT-Live session's timeline starts at 0
          setMic(true);
          try {
            await connect();
            if (!s.cancelled) setPhase("live");
          } catch (e) {
            setMic(false);
            if (s.cancelled) return;
            setError(`Couldn't reconnect: ${e instanceof Error ? e.message : e}`);
            setPhase("paused");
          }
        })(),
      );
    }
  }

  // Waits for any start/pause/resume in flight, closes the GPT-Live session (final usage), saves the transcript
  // and ends the row. review = false (Back, leaving the screen) skips the evaluator. Returns the talk id.
  // With review, a transcript that can't be saved throws so End can be retried; without, the leftovers ride
  // along in the /end request instead.
  function finish(review: boolean): Promise<number | null> {
    const s = r.current;
    if (s.finishing) return s.finishing;
    const run = (async () => {
      await s.pending?.catch(() => {});
      if (s.done) return null;
      if (s.talkId === null) {
        s.done = s.cancelled;
        release();
        return null;
      }
      setMic(false);
      const conn = s.conn;
      s.conn = null;
      if (conn) s.segments.push(await conn.close());
      let items: unknown[] = [];
      if (review) await s.sink?.flush(true);
      else items = await (s.sink?.flush(true).then(() => [], () => s.sink?.pending() ?? []) ?? []);
      const id = s.talkId;
      await talkApi.end(id, s.seconds, s.segments, { review, items });
      s.done = true;
      release();
      if (review) {
        lastSession.id = id;
        lastSession.mode = mode;
        lastSession.seconds = s.seconds;
        actions.completeTalk(Math.round(s.seconds / 60));
      }
      return id;
    })();
    s.finishing = run;
    return run.finally(() => {
      s.finishing = null;
    });
  }

  async function end() {
    if (r.current.phase === "ending" || r.current.finishing) return;
    setPhase("ending");
    setError(null);
    try {
      const id = await finish(true);
      if (id !== null && !r.current.cancelled) navigate(`/talk/review/${id}`);
    } catch (e) {
      if (r.current.cancelled) return;
      setError(`Couldn't save the talk: ${e instanceof Error ? e.message : e}. Press End to try again.`);
      setPhase("paused");
    }
  }

  async function back() {
    if (phase !== "idle" && !confirm("End this conversation? It won't be reviewed.")) return;
    r.current.cancelled = true;
    await finish(false).catch(() => {});
    navigate("/talk");
  }

  const goal = cfg.goalMin * 60;
  const mmss = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  const eveSpeaking = eve > 0;
  const status = {
    idle: "Ready when you are",
    connecting: `Connecting to ${tutor}…${step ? ` (${step})` : ""}`,
    live: eveSpeaking ? `${tutor} is speaking…` : "Listening…",
    pausing: "Pausing…",
    paused: `Paused · the line to ${tutor} is closed, so the clock and the cost are stopped`,
    resuming: `Reconnecting to ${tutor}…${step ? ` (${step})` : ""}`,
    ending: "Saving your talk…",
  }[phase];
  const busy = phase === "connecting" || phase === "pausing" || phase === "resuming" || phase === "ending";

  return (
    <div className="stack talk-screen" style={{ alignItems: "center", gap: 22 }}>
      <div className="talk-head">
        <button className="btn round" onClick={back} aria-label="Back" disabled={busy}>←</button>
        <h1>{cfg.title}</h1>
      </div>
      <audio ref={audioEl} autoPlay hidden />

      <div className="row talk-orbs" style={{ gap: 64, justifyContent: "center", margin: "18px 0" }}>
        <div className="stack" style={{ alignItems: "center" }}>
          <EveOrb level={eve} speaking={eveSpeaking} />
          <b>{tutor}</b>
        </div>
        <div className="stack" style={{ alignItems: "center" }}>
          <YouOrb level={you} speaking={you > 0.12} />
          <b>You</b>
        </div>
      </div>

      <div className="muted">{status}</div>
      {notice && <div className="small muted">{notice}</div>}
      {error && <div className="small" role="alert" style={{ color: "var(--mistake-ink)", maxWidth: 520, textAlign: "center" }}>{error}</div>}
      <div className="talk-timer" style={{ fontSize: 30, fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>{mmss}</div>
      <div style={{ width: "min(520px, 100%)" }}>
        <div className="bar">
          <div style={{ width: `${Math.min(100, (seconds / goal) * 100)}%`, background: seconds >= goal ? "var(--streak)" : "var(--talk)" }} />
        </div>
        <div className="row small muted" style={{ marginTop: 6 }}>
          <span>Time goal</span>
          <span className="spacer" />
          <span>{seconds >= goal ? "Goal reached 🎉 keep going or end" : `${cfg.goalMin} min`}</span>
        </div>
      </div>

      {phase === "idle" || phase === "connecting" ? (
        <div className="stack" style={{ alignItems: "center" }}>
          <div className="tabs style-tabs">
            <button className={`tab ${style === "after-turn" ? "active" : ""}`} onClick={() => setStyle("after-turn")} disabled={busy}>Correct after my turn</button>
            <button className={`tab ${style === "interject" ? "active" : ""}`} onClick={() => setStyle("interject")} disabled={busy}>Interject mid-sentence</button>
          </div>
          <button className="btn talk big" onClick={start} disabled={busy}>{phase === "connecting" ? "Connecting…" : "Start"}</button>
        </div>
      ) : (
        <div className="row" style={{ gap: 16 }}>
          <button className="btn mistake big" onClick={end} disabled={busy}>End</button>
          <button className="btn big" onClick={togglePause} disabled={busy}>{phase === "live" || phase === "pausing" ? "Pause" : "Resume"}</button>
        </div>
      )}

      {/* Hidden on phones: iOS picks the mic and speaker itself (and has no setSinkId) */}
      <div className="row small talk-devices" style={{ gap: 16, flexWrap: "wrap", justifyContent: "center" }}>
        {devices.labelled ? (
          <>
            <label className="row" style={{ gap: 6 }}>
              <span className="muted">🎙 Microphone</span>
              <select className="select" value={audio.input} onChange={(e) => pickAudio({ input: e.target.value })} disabled={phase !== "idle"} title={phase !== "idle" ? "Change it before you start" : undefined}>
                <option value="">System default</option>
                {devices.inputs.map((d) => <option key={d.deviceId} value={d.deviceId}>{d.label || "Microphone"}</option>)}
              </select>
            </label>
            <label className="row" style={{ gap: 6 }}>
              <span className="muted">🎧 {tutor}'s voice</span>
              <select className="select" value={audio.output} onChange={(e) => pickAudio({ output: e.target.value })}>
                <option value="">System default</option>
                {devices.outputs.map((d) => <option key={d.deviceId} value={d.deviceId}>{d.label || "Speaker"}</option>)}
              </select>
            </label>
          </>
        ) : (
          <button className="btn" onClick={devices.askPermission}>Choose microphone and speaker</button>
        )}
      </div>
    </div>
  );
}
