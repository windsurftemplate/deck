import { useEffect, useRef, useState } from "react";
import type { Settings } from "@deck/settings";
import { saveSettings } from "./bridge";

export type Picture = { mediaType: "image/jpeg" | "image/png" | "image/webp"; data: string; preview: string };

/** Takes one snapshot. The camera is on only while this panel is open, with a visible badge; it turns off right after. */
export function SnapshotButton({ onPicture }: { onPicture: (p: Picture) => void }) {
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const close = () => {
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    setOpen(false);
  };
  useEffect(() => () => close(), []);

  const start = async () => {
    setErr(null);
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 } });
      setOpen(true);
      requestAnimationFrame(() => {
        if (video.current && stream.current) {
          video.current.srcObject = stream.current;
          void video.current.play();
        }
      });
    } catch {
      setErr("Camera not available. Allow camera access for deck in your system settings.");
    }
  };
  const take = () => {
    const v = video.current;
    if (!v) return;
    const c = document.createElement("canvas");
    const scale = Math.min(1, 1280 / (v.videoWidth || 1280));
    c.width = Math.round((v.videoWidth || 1280) * scale);
    c.height = Math.round((v.videoHeight || 720) * scale);
    c.getContext("2d")!.drawImage(v, 0, 0, c.width, c.height);
    const url = c.toDataURL("image/jpeg", 0.85);
    close(); // camera off immediately
    onPicture({ mediaType: "image/jpeg", data: url.split(",")[1]!, preview: url });
  };

  return (
    <>
      <button className="btn" type="button" onClick={open ? close : start} aria-label={open ? "Close camera" : "Take a snapshot"}>
        {open ? "Close camera" : "Snapshot"}
      </button>
      {err && <span className="error">{err}</span>}
      {open && (
        <div className="camera" role="dialog" aria-label="Camera">
          <span className="mic-on">Camera on</span>
          <video ref={video} muted playsInline />
          <div className="row">
            <button className="primary" type="button" onClick={take}>
              Take snapshot
            </button>
            <button className="btn" type="button" onClick={close}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </>
  );
}

/** Attach a picture from a file instead of the camera. */
export function attachFile(file: File): Promise<Picture> {
  return new Promise((resolve, reject) => {
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) return reject(new Error("Use a JPEG, PNG or WebP picture."));
    if (file.size > 5_000_000) return reject(new Error("That picture is larger than 5 MB."));
    const r = new FileReader();
    r.onload = () => {
      const url = String(r.result);
      resolve({ mediaType: file.type as Picture["mediaType"], data: url.split(",")[1]!, preview: url });
    };
    r.onerror = () => reject(new Error("Could not read that file."));
    r.readAsDataURL(file);
  });
}

export function CameraCard({ s, onSaved }: { s: Settings; onSaved: (s: Settings) => void }) {
  const [msg, setMsg] = useState<string | null>(null);
  const toggle = async (on: boolean) => {
    onSaved(await saveSettings({ camera: { enabled: on } }));
    setMsg(on ? "On. Snapshot and Attach buttons appear next to Send." : "Off.");
  };
  return (
    <div className="card">
      <h3>Camera and pictures</h3>
      <p className="muted">Show the crew a whiteboard, a document or a screen. The camera turns on only while you take a picture, with a badge on screen. Pictures go to your chosen model with your message and are not stored in memory. Your model must support images.</p>
      <label className="check">
        <input type="checkbox" checked={s.camera.enabled} onChange={(e) => toggle(e.target.checked)} />
        Allow snapshots and pictures in chat
      </label>
      {msg && <p className="ok">{msg}</p>}
    </div>
  );
}
