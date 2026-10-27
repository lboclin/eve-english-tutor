// Shared WebRTC setup for the two OpenAI providers: mic track out, model audio track in, JSON events on
// the "oai-events" data channel. `exchange(sdp)` sends the offer to our server and returns the answer SDP.
export async function connectWebRTC({ exchange, onEvent, audioEl }) {
  const pc = new RTCPeerConnection();
  const output = new Promise((resolveTrack, reject) => {
    setTimeout(() => reject(new Error("No audio track from the model after 15 s")), 15_000);
    pc.addEventListener("track", (event) => {
      const stream = new MediaStream([event.track]);
      audioEl.srcObject = stream;
      audioEl.play().catch(() => {});
      resolveTrack(stream);
    });
  });

  const mic = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });
  for (const track of mic.getAudioTracks()) pc.addTrack(track, mic);

  // The data channel must exist before the offer is created.
  const events = pc.createDataChannel("oai-events");
  events.addEventListener("message", ({ data }) => onEvent(JSON.parse(data)));

  await pc.setLocalDescription(await pc.createOffer());
  await waitForIce(pc);
  const answer = await exchange(pc.localDescription.sdp);
  await pc.setRemoteDescription({ type: "answer", sdp: answer });

  return {
    pc,
    events,
    mic,
    output,
    send: (event) => events.readyState === "open" && events.send(JSON.stringify(event)),
    close() {
      mic.getTracks().forEach((t) => t.stop());
      events.close();
      pc.close();
      audioEl.srcObject = null;
    },
  };
}

function waitForIce(pc) {
  if (pc.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Timed out gathering ICE candidates")), 10_000);
    pc.addEventListener("icegatheringstatechange", () => {
      if (pc.iceGatheringState !== "complete") return;
      clearTimeout(timeout);
      resolve();
    });
  });
}

export async function postJson(url, body) {
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error ?? `HTTP ${r.status}`);
  return data;
}
