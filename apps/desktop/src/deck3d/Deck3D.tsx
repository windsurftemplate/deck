import { useEffect, useRef, useState } from "react";
import type { Approval } from "../bridge";
import { DeckScene, type DeckStats } from "./scene";
import { STATIONS, STATUS_TEXT, stationForAgent, stationStatus } from "./stations";

export interface DeckState {
  crew: Record<string, { status: string; task?: string }>;
  pending: Approval[];
  stopped: boolean;
}

/** The 3D command deck with a side panel for the selected station. */
export function Deck3D({ state, signal, onDecide, onOpenBrain, stats, tours = false }: { state: DeckState; signal: { beam?: string; archive?: number; visit?: string }; onDecide: (id: string, approve: boolean) => void; onOpenBrain?: () => void; stats?: DeckStats | null; tours?: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const overlay = useRef<HTMLDivElement>(null);
  /* Labs: camera tour through every station. Any manual choice stops it. */
  const [touring, setTouring] = useState(false);
  const tourTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stopTour = () => {
    if (tourTimer.current) clearTimeout(tourTimer.current);
    setTouring(false);
  };
  const startTour = () => {
    setTouring(true);
    const step = (i: number) => {
      if (i >= STATIONS.length) {
        setSelected(null);
        setTouring(false);
        return;
      }
      setSelected(STATIONS[i]!.id);
      tourTimer.current = setTimeout(() => step(i + 1), 4200);
    };
    step(0);
  };
  useEffect(() => () => void (tourTimer.current && clearTimeout(tourTimer.current)), []);
  const deck = useRef<DeckScene | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!canvas.current || !overlay.current) return;
    let d: DeckScene;
    try {
      d = new DeckScene(canvas.current, overlay.current, { onSelect: setSelected });
    } catch (e) {
      setFailed(`3D view could not start (${String(e)}). Switch to the list view in the header.`);
      return;
    }
    deck.current = d;
    d.ready.then(() => setLoading(false)).catch((e) => setFailed(`Could not load the station models: ${String(e)}`));
    const ro = new ResizeObserver(() => d.resize());
    ro.observe(canvas.current);
    return () => {
      ro.disconnect();
      d.dispose();
      deck.current = null;
    };
  }, []);

  // Live status: agent tasks and approvals light their stations; the vault lights when anything waits for you.
  useEffect(() => {
    const d = deck.current;
    if (!d) return;
    d.setStopped(state.stopped);
    for (const s of STATIONS) {
      if (s.agent) {
        const c = state.crew[s.agent];
        d.setStation(s.id, stationStatus(c?.status, state.pending.filter((a) => a.agent === s.agent).length, state.stopped), c?.task ?? "");
      }
    }
    d.setStation("vault", state.stopped ? "idle" : state.pending.length ? "needs" : "idle", state.pending.length ? `${state.pending.length} waiting` : "");
    d.setStation("core", state.stopped ? "idle" : Object.values(state.crew).some((c) => c.status === "running") ? "working" : "idle", "");
  }, [state, loading]);

  useEffect(() => {
    if (signal.beam) {
      const st = stationForAgent(signal.beam);
      if (st) deck.current?.beam(st.id);
    }
  }, [signal.beam]);
  useEffect(() => {
    if (stats) deck.current?.setStats(stats);
  }, [stats, loading]);
  useEffect(() => {
    if (signal.archive) deck.current?.pulseArchive();
  }, [signal.archive]);
  useEffect(() => {
    const st = signal.visit && stationForAgent(signal.visit.split("#")[0]!);
    if (st) deck.current?.visitCommand(st.id);
  }, [signal.visit]);
  useEffect(() => {
    deck.current?.focus(selected);
  }, [selected]);

  const s = STATIONS.find((x) => x.id === selected);
  const pendingHere = s ? state.pending.filter((a) => (s.id === "vault" ? true : a.agent === s.agent)) : [];
  const c = s?.agent ? state.crew[s.agent] : undefined;
  const st = s?.agent ? stationStatus(c?.status, pendingHere.length, state.stopped) : null;

  return (
    <div className="deck3d">
      <canvas ref={canvas} className="deck-canvas" aria-label="3D command deck. Click a station to see its crew member." />
      <div ref={overlay} className="deck-tags" aria-hidden="true" />
      {loading && !failed && <p className="deck-note">Loading the station…</p>}
      {failed && <p className="deck-note error">{failed}</p>}
      <nav className="deck-chips" aria-label="Stations">
        {tours && (
          <button type="button" className={`chip tour ${touring ? "on" : ""}`} aria-pressed={touring} onClick={() => (touring ? stopTour() : startTour())}>
            {touring ? "Stop tour" : "Tour"}
          </button>
        )}
        {STATIONS.map((x) => (
          <button key={x.id} type="button" className={`chip ${x.id === selected ? "on" : ""}`} onClick={() => setSelected(x.id === selected ? null : x.id)}>
            {x.name}
          </button>
        ))}
      </nav>
      {s && (
        <aside className="deck-panel" aria-label={`${s.name} station`}>
          <div className="deck-panel-head">
            <div>
              <h3>{s.name}</h3>
              {s.crew !== s.name && <p className="muted">{s.crew}</p>}
            </div>
            <button className="btn" type="button" onClick={() => setSelected(null)}>
              Back to overview
            </button>
          </div>
          <p>{s.about}</p>
          {s.id === "archive" && onOpenBrain && (
            <button className="primary" type="button" onClick={onOpenBrain}>
              Open the second brain
            </button>
          )}
          {st && (
            <p className={`deck-status ${st}`}>
              {STATUS_TEXT[st]}
              {c?.task && st !== "idle" ? `: ${c.task}` : ""}
            </p>
          )}
          {pendingHere.length > 0 && (
            <div className="deck-approvals">
              <b>Waiting for you</b>
              {pendingHere.map((a) => (
                <div key={a.id} className="deck-approval">
                  <p>{a.summary}</p>
                  <div className="row">
                    <button className="primary" type="button" onClick={() => onDecide(a.id, true)}>
                      Approve
                    </button>
                    <button className="btn" type="button" onClick={() => onDecide(a.id, false)}>
                      Reject
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </aside>
      )}
    </div>
  );
}
