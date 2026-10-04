import { useState } from "react";
import { attachFile, SnapshotButton, type Picture } from "../Camera";
import { engineCall } from "../bridge";
import { toast } from "../ui/toast";

type Card = { name: string; title: string; company: string; email: string; phone: string; website: string };

/** Capture a business card, whiteboard or document: deck reads the text, you check it, then it is saved. */
export function CaptureBox({ onSaved }: { onSaved: () => void }) {
  const [kind, setKind] = useState<"card" | "whiteboard" | "document">("card");
  const [busy, setBusy] = useState(false);
  const [card, setCard] = useState<Card | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const read = async (p: Picture) => {
    setBusy(true);
    setCard(null);
    setText(null);
    try {
      const r = await engineCall<{ text?: string; card?: Card }>("capture.read", { kind, image: { mediaType: p.mediaType, data: p.data } });
      if (r?.card) setCard(r.card);
      if (r?.text !== undefined) setText(r.text);
    } catch (e) {
      toast("Could not read it", String(e).replace(/^Error: /, ""), "error");
    }
    setBusy(false);
  };
  const save = async () => {
    try {
      const r = await engineCall<{ title: string }>("capture.save", { kind, ...(card ? { card } : { text, title }) });
      toast("Saved to your second brain", r?.title ?? "");
      setCard(null);
      setText(null);
      setTitle("");
      onSaved();
    } catch (e) {
      toast("Not saved", String(e).replace(/^Error: /, ""), "error");
    }
  };
  return (
    <div className="capture">
      <b>Capture a card, whiteboard or document</b>
      <span className="muted">deck reads the text (never identifies people), you check it, then it is saved. Needs Camera and pictures in Settings.</span>
      <div className="seg" role="group" aria-label="What are you capturing">
        {(
          [
            ["card", "Business card"],
            ["whiteboard", "Whiteboard"],
            ["document", "Document"],
          ] as const
        ).map(([k, l]) => (
          <button key={k} type="button" className={kind === k ? "on" : ""} aria-pressed={kind === k} onClick={() => (setKind(k), setCard(null), setText(null))}>{l}</button>
        ))}
      </div>
      <div className="row">
        <SnapshotButton onPicture={(p) => void read(p)} />
        <label className="btn file-btn">
          Choose a picture
          <input type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={async (e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void read(await attachFile(f)); }} />
        </label>
        {busy && <span className="muted">Reading…</span>}
      </div>
      {card && (
        <div className="capture-card">
          {(Object.keys(card) as (keyof Card)[]).map((k) => (
            <label key={k} className="field">
              {k[0]!.toUpperCase() + k.slice(1)}
              <input value={card[k]} onChange={(e) => setCard({ ...card, [k]: e.target.value })} />
            </label>
          ))}
          <button className="primary" type="button" onClick={save}>Save contact</button>
        </div>
      )}
      {text !== null && (
        <div className="capture-card">
          <label className="field">
            Title
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={kind === "whiteboard" ? "Q4 planning board" : "Document title"} />
          </label>
          <textarea rows={10} value={text} onChange={(e) => setText(e.target.value)} aria-label="Text read from the picture" />
          <button className="primary" type="button" onClick={save}>Save to second brain</button>
        </div>
      )}
    </div>
  );
}
