// Audio for 🔊 Listen (Google Translate's voice, mp3) and the talk-voice samples (OpenAI TTS, mp3): made by the server,
// cached there and here, played on one shared <audio> element. If the server can't make it, Listen falls back to
// the browser's own voice. iOS only lets a page play sound in response to a tap, and the audio arrives after an
// await: so the tap first plays a silent clip on the element, which unlocks it for the real one.
const SILENT = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=";
const urls = new Map<string, Promise<string>>(); // request → object URL of its audio
let player: HTMLAudioElement | null = null;
let current = 0; // the newest play owns the element; older ones end silently

export interface PlayCallbacks { onEnd: () => void; onError: (message: string) => void }

function fetchAudio(path: string, body: unknown): Promise<string> {
  const key = `${path} ${JSON.stringify(body)}`;
  let url = urls.get(key);
  if (!url) {
    url = fetch(`/api${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      .then(async (r) => {
        if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { error?: string }).error ?? `HTTP ${r.status}`);
        return URL.createObjectURL(await r.blob());
      });
    url.catch(() => urls.delete(key)); // a failure is retried next time
    urls.set(key, url);
  }
  return url;
}

// Plays the audio of POST /api{path} with `body`; call it straight from the tap. Returns a stop function.
export function playAudio(path: string, body: unknown, cb: PlayCallbacks): () => void {
  const id = ++current;
  const audio = (player ??= new Audio());
  audio.pause();
  audio.onended = null;
  audio.src = SILENT;
  audio.play().catch(() => {});
  fetchAudio(path, body).then(
    (src) => {
      if (id !== current) return;
      audio.src = src;
      audio.onended = () => id === current && cb.onEnd();
      audio.play().catch((e: Error) => id === current && cb.onError(e.message));
    },
    (e: Error) => id === current && cb.onError(e.message),
  );
  return () => {
    if (id !== current) return;
    current++;
    audio.pause();
  };
}

// The browser's voice, for when the server has no audio (offline, OpenAI down).
export function speakLocally(text: string, onEnd: () => void) {
  if (typeof speechSynthesis === "undefined") return onEnd();
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "en-US";
  u.onend = u.onerror = onEnd;
  speechSynthesis.speak(u);
}
