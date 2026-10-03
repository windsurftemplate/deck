import { useEffect, useRef, useState } from "react";
import { engineCall } from "./bridge";
import { matchWake } from "./wake";

const toB64 = async (b: Blob) => {
  const u = new Uint8Array(await b.arrayBuffer());
  let s = "";
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
};

/**
 * Hands-free voice. While on, the microphone listens on this machine; speech is cut into short clips
 * when you pause, turned into text locally, and only a clip that starts with the wake word is sent.
 * After a reply you can answer without the wake word for a few seconds. A badge shows whenever it listens.
 */
export function HandsFree({ wakeWord, onRequest, busy }: { wakeWord: string; onRequest: (text: string) => Promise<string>; busy: boolean }) {
  const [on, setOn] = useState(false);
  const [state, setState] = useState<"listening" | "hearing" | "thinking" | "speaking" | "awake">("listening");
  const [heard, setHeard] = useState("");
  const stop = useRef<() => void>(() => {});
  const followUntil = useRef(0);
  const paused = useRef(false);
  paused.current = busy || state === "thinking" || state === "speaking";

  useEffect(() => {
    if (!on) return;
    let alive = true;
    let stream: MediaStream | null = null;
    let ctx: AudioContext | null = null;
    let rec: MediaRecorder | null = null;
    let chunks: Blob[] = [];
    let loud = 0, quiet = 0, floor = 0.01, started = 0;
    const handle = async (blob: Blob) => {
      if (blob.size < 2000) return setState("listening");
      setState("thinking");
      try {
        const text = ((await engineCall<string>("voice.transcribe", { audio: await toB64(blob) })) ?? "").trim();
        setHeard(text);
        const w = matchWake(text, wakeWord);
        const following = Date.now() < followUntil.current;
        const request = w.woke ? w.request : following ? text : "";
        if (w.woke && !request) {
          followUntil.current = Date.now() + 8000;
          return setState("awake");
        }
        if (!request) return setState("listening");
        const reply = await onRequest(request);
        if (!alive) return;
        setState("speaking");
        await new Promise<void>((res) => {
          if (!("speechSynthesis" in window)) return res();
          const u = new SpeechSynthesisUtterance(reply.slice(0, 1200));
          u.onend = () => res();
          u.onerror = () => res();
          speechSynthesis.speak(u);
        });
        followUntil.current = Date.now() + 8000;
        setState("awake");
      } catch {
        setState("listening");
      }
    };
    void (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      } catch {
        setHeard("Microphone not available. Allow microphone access for deck in System Settings.");
        return setOn(false);
      }
      ctx = new AudioContext();
      const an = ctx.createAnalyser();
      an.fftSize = 1024;
      ctx.createMediaStreamSource(stream).connect(an);
      const buf = new Float32Array(an.fftSize);
      const tick = setInterval(() => {
        if (!alive || !stream) return;
        an.getFloatTimeDomainData(buf);
        const rms = Math.sqrt(buf.reduce((a, x) => a + x * x, 0) / buf.length);
        const speaking = rms > Math.max(0.015, floor * 3);
        if (!rec) floor = floor * 0.98 + rms * 0.02; // track background noise between clips
        if (paused.current) return;
        if (!rec && speaking && ++loud >= 2) {
          chunks = [];
          rec = new MediaRecorder(stream);
          rec.ondataavailable = (e) => chunks.push(e.data);
          rec.onstop = () => void handle(new Blob(chunks, { type: rec?.mimeType || "audio/webm" }));
          rec.start();
          started = Date.now();
          quiet = 0;
          setState("hearing");
        } else if (!speaking) loud = 0;
        if (rec) {
          quiet = speaking ? 0 : quiet + 1;
          if (quiet >= 18 || Date.now() - started > 20_000) {
            const r = rec;
            rec = null;
            r.stop();
          }
        }
      }, 50);
      stop.current = () => clearInterval(tick);
    })();
    return () => {
      alive = false;
      stop.current();
      if (rec?.state === "recording") rec.stop();
      stream?.getTracks().forEach((t) => t.stop()); // microphone fully off
      void ctx?.close();
      speechSynthesis.cancel();
    };
  }, [on, wakeWord]);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOn(false);
    addEventListener("keydown", esc);
    return () => removeEventListener("keydown", esc);
  }, []);

  const label = { listening: `Listening for "${wakeWord}"`, hearing: "Hearing you", thinking: "Working on it", speaking: "Speaking", awake: "Go ahead" }[state];
  return (
    <>
      <button className={on ? "danger" : "btn"} type="button" aria-pressed={on} onClick={() => (setOn((v) => !v), setState("listening"), setHeard(""))}>
        {on ? "Stop hands-free" : "Hands-free"}
      </button>
      {on && (
        <span className="mic-on" role="status" title={heard ? `Last heard: ${heard}` : undefined}>
          Microphone on · {label}
        </span>
      )}
    </>
  );
}
