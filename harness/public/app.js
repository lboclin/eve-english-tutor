import { startMeter } from "./meter.js";
import { PLANTED, TOPICS } from "./test-script.js";

const PROVIDERS = {
  "openai-live": { label: "OpenAI GPT-Live-1 (full duplex)", key: "openai", module: "./providers/openai-live.js", perMinute: 0.05 },
  gemini: { label: "Gemini 3.8 Live", key: "gemini", module: "./providers/gemini.js" },
  "openai-realtime-mini": { label: "OpenAI gpt-realtime-2.1-mini", key: "openai", module: "./providers/openai-realtime.js" },
};
const RATINGS = [
  ["understood", "Understood my accent"],
  ["corrections", "Corrections were useful"],
  ["flow", "Conversation flowed"],
  ["voice", "Voice / pace natural"],
];

const $ = (id) => document.getElementById(id);
const config = await (await fetch("/api/config")).json();

for (const [id, p] of Object.entries(PROVIDERS)) {
  const missing = !config.keys[p.key];
  $("provider").add(new Option(`${p.label}${missing ? ` — ${p.key.toUpperCase()} key missing` : ""}`, id, false, false));
  $("provider").lastChild.disabled = missing;
}
$("provider").selectedIndex = [...$("provider").options].findIndex((o) => !o.disabled);
$("topics").innerHTML = TOPICS.map((t) => `<li>${t}</li>`).join("");
$("planted").innerHTML = PLANTED.map(
  (m) => `<label class="check"><input type="checkbox" data-id="${m.id}" />
    <span>“${m.say}” <span class="kind">${m.kind}</span><small>→ ${m.fix}</small></span></label>`,
).join("");
$("ratings").innerHTML = RATINGS.map(
  ([id, label]) => `<div class="rating">${label}<select data-rating="${id}"><option value="">–</option>
    ${[1, 2, 3, 4, 5].map((n) => `<option>${n}</option>`).join("")}</select></div>`,
).join("");

let run = null;

$("start").onclick = async () => {
  const providerId = $("provider").value;
  const provider = PROVIDERS[providerId];
  run = { providerId, model: config.models[providerId], style: $("style").value, turns: [], usage: [], log: [] };
  $("transcript").innerHTML = "";
  $("saved").textContent = "";
  setRunning(true);
  $("stop").disabled = true; // enabled once connected
  status("Connecting…");
  try {
    const { start } = await import(provider.module);
    run.session = await start({
      style: run.style,
      audioEl: $("audio"),
      onTranscript: addTranscript,
      onStatus: status,
      onUsage: (u) => run.usage.push(u),
      onLog: log,
    });
    run.meter = startMeter(run.session);
    run.startedAt = Date.now();
    run.ticker = setInterval(renderStats, 1000);
    $("stop").disabled = false;
  } catch (error) {
    status(`Failed: ${error.message}`);
    await run.session?.stop().catch(() => {});
    setRunning(false);
  }
};

$("stop").onclick = async () => {
  $("stop").disabled = true;
  status("Closing…");
  clearInterval(run.ticker);
  renderStats();
  run.stats = run.meter?.stats();
  run.meter?.stop();
  await run.session?.stop();
  run.durationSec = Math.round((Date.now() - run.startedAt) / 1000);
  status("Ended — tick the corrections, rate, then save");
  setRunning(false);
  $("save").disabled = false;
};

$("save").onclick = async () => {
  const corrected = [...document.querySelectorAll("#planted input")].filter((c) => c.checked).map((c) => c.dataset.id);
  const ratings = Object.fromEntries([...document.querySelectorAll("[data-rating]")].map((s) => [s.dataset.rating, Number(s.value) || null]));
  const r = await fetch("/api/results", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      provider: run.providerId,
      model: run.model,
      style: run.style,
      startedAt: new Date(run.startedAt).toISOString(),
      durationSec: run.durationSec,
      measured: run.stats,
      planted: { total: PLANTED.length, corrected },
      ratings,
      notes: $("notes").value,
      transcript: run.turns,
      usage: run.usage,
      log: run.log,
    }),
  });
  const data = await r.json();
  $("saved").textContent = r.ok ? `Saved to ${data.saved}` : `Save failed: ${data.error}`;
};

function addTranscript(who, text, { final = false } = {}) {
  if (!text) return;
  const last = run.turns.at(-1);
  if (!final && last && last.who === who && !last.final) {
    last.text += text;
    last.el.lastChild.textContent = last.text;
  } else {
    const el = document.createElement("div");
    el.className = `turn ${who}`;
    el.innerHTML = `<b>${who === "you" ? "You" : "Tutor"}</b><span></span>`;
    el.lastChild.textContent = text;
    $("transcript").append(el);
    const turn = { who, text, final, atSec: run.startedAt ? Math.round((Date.now() - run.startedAt) / 1000) : 0 };
    Object.defineProperty(turn, "el", { value: el }); // not serialized into results
    run.turns.push(turn);
  }
  $("transcript").scrollTop = $("transcript").scrollHeight;
}

function log(message, detail) {
  run.log.push({ message, detail });
  const el = document.createElement("div");
  el.className = "log";
  el.textContent = message;
  $("transcript").append(el);
  console.log(message, detail ?? "");
}

function renderStats() {
  const sec = Math.round((Date.now() - run.startedAt) / 1000);
  $("timer").textContent = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
  const s = run.meter.stats();
  const perMinute = PROVIDERS[run.providerId].perMinute;
  const rows = [
    ["Replies measured", s.replies],
    ["Median latency", s.medianLatencyMs != null ? `${s.medianLatencyMs} ms` : "–"],
    ["p90 latency", s.p90LatencyMs != null ? `${s.p90LatencyMs} ms` : "–"],
    ["Interjections", s.interjections],
    ["Est. cost", perMinute ? `$${((sec / 60) * perMinute).toFixed(3)}` : "see provider dashboard"],
  ];
  $("stats").innerHTML = rows.map(([k, v]) => `<span>${k}</span><span>${v}</span>`).join("");
}

function status(text) {
  $("status").textContent = text;
}

function setRunning(running) {
  $("start").disabled = running;
  $("stop").disabled = !running;
  $("provider").disabled = running;
  $("style").disabled = running;
  if (running) $("save").disabled = true;
}
