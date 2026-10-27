// Microphone and speaker choice for talks (e.g. AirPods to listen, the Mac's mic to speak). The choice is
// remembered in this browser only; "" = the system default. Device labels stay empty until the page has had
// microphone permission once, so the list offers a button to ask for it.
import { useEffect, useState } from "react";

export interface AudioPrefs {
  input: string;
  output: string;
}

const KEY = "eve.audio";

export function loadAudioPrefs(): AudioPrefs {
  try {
    return { input: "", output: "", ...JSON.parse(localStorage.getItem(KEY) ?? "{}") };
  } catch {
    return { input: "", output: "" };
  }
}

export function saveAudioPrefs(p: AudioPrefs) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {}
}

export function useAudioDevices() {
  const [inputs, setInputs] = useState<MediaDeviceInfo[]>([]);
  const [outputs, setOutputs] = useState<MediaDeviceInfo[]>([]);
  const [labelled, setLabelled] = useState(true);

  async function refresh() {
    const all = await navigator.mediaDevices.enumerateDevices();
    // Chrome lists "default"/"communications" aliases of real devices; "" already means the default.
    const real = (kind: MediaDeviceKind) => all.filter((d) => d.kind === kind && d.deviceId && !["default", "communications"].includes(d.deviceId));
    setInputs(real("audioinput"));
    setOutputs(real("audiooutput"));
    setLabelled(all.some((d) => d.label));
  }

  useEffect(() => {
    void refresh();
    navigator.mediaDevices.addEventListener("devicechange", refresh);
    return () => navigator.mediaDevices.removeEventListener("devicechange", refresh);
  }, []);

  async function askPermission() {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      s.getTracks().forEach((t) => t.stop());
    } catch {}
    await refresh();
  }

  return { inputs, outputs, labelled, askPermission };
}

// The chosen mic if it's still connected, else the default.
export function micConstraints(input: string, inputs: MediaDeviceInfo[]): MediaTrackConstraints {
  const base = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
  return input && inputs.some((d) => d.deviceId === input) ? { ...base, deviceId: { exact: input } } : base;
}

// Routes Eve's voice to the chosen speaker (Chrome's HTMLMediaElement.setSinkId). Falls back to the default.
export async function setOutput(el: HTMLAudioElement, output: string, outputs: MediaDeviceInfo[]) {
  const sink = el as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> };
  if (!sink.setSinkId) return;
  await sink.setSinkId(output && outputs.some((d) => d.deviceId === output) ? output : "").catch(() => {});
}
