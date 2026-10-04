import { useEffect, useMemo, useRef, useState } from "react";
import { marked } from "marked";
import { BookOpen, CheckCircle2, ChevronLeft, ChevronRight, GraduationCap, Search, XCircle } from "lucide-react";
import { DOCS, parseQuiz, search, type Doc, type Quiz } from "./content";

marked.setOptions({ gfm: true });
const PROGRESS = "deck.course.progress";
const loadProgress = (): Record<string, { read?: boolean; quiz?: number }> => {
  try {
    return JSON.parse(localStorage.getItem(PROGRESS) ?? "{}");
  } catch {
    return {};
  }
};

function QuizCard({ q: raw, n, onAnswer }: { q: Quiz; n: number; onAnswer: (right: boolean) => void }) {
  const [picked, setPicked] = useState<number | null>(null);
  // Shuffle the options once per question so the right answer is not always in the same place.
  const q = useMemo(() => {
    let seed = [...raw.question].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
    const opts = [...raw.options];
    for (let i = opts.length - 1; i > 0; i--) {
      seed = (seed * 1103515245 + 12345) >>> 0;
      const j = seed % (i + 1);
      [opts[i], opts[j]] = [opts[j]!, opts[i]!];
    }
    return { ...raw, options: opts };
  }, [raw]);
  return (
    <div className="quiz" role="group" aria-label={`Question ${n}`}>
      <p className="quiz-q"><b>Question {n}.</b> {q.question}</p>
      <div className="quiz-options">
        {q.options.map((o, i) => {
          const state = picked === null ? "" : o.correct ? "right" : picked === i ? "wrong" : "";
          return (
            <button key={i} type="button" className={`quiz-opt ${state}`} disabled={picked !== null} aria-pressed={picked === i} onClick={() => (setPicked(i), onAnswer(o.correct))}>
              {state === "right" ? <CheckCircle2 size={15} aria-hidden="true" /> : state === "wrong" ? <XCircle size={15} aria-hidden="true" /> : <span className="quiz-dot" aria-hidden="true" />}
              {o.text}
            </button>
          );
        })}
      </div>
      {picked !== null && (
        <p className={`quiz-explain ${q.options[picked]!.correct ? "ok" : "no"}`} role="status">
          {q.options[picked]!.correct ? "Right. " : "Not quite. "}
          {q.explain}
        </p>
      )}
    </div>
  );
}

/** Renders a chapter: Markdown, with quiz blocks turned into interactive questions. */
function Chapter({ doc, onQuizScore }: { doc: Doc; onQuizScore: (right: number, total: number) => void }) {
  const parts = useMemo(() => doc.body.split(/```quiz\n([\s\S]*?)```/g), [doc]);
  const total = Math.floor(parts.length / 2);
  const answers = useRef<Record<number, boolean>>({});
  useEffect(() => void (answers.current = {}), [doc]);
  let n = 0;
  return (
    <article className="doc">
      {parts.map((p, i) => {
        if (i % 2 === 0) return <div key={i} className="md" dangerouslySetInnerHTML={{ __html: marked.parse(p) as string }} />;
        const q = parseQuiz(p);
        if (!q) return null;
        const k = ++n;
        return (
          <QuizCard
            key={`${doc.id}-${i}`}
            q={q}
            n={k}
            onAnswer={(ok) => {
              answers.current[k] = ok;
              if (Object.keys(answers.current).length === total) onQuizScore(Object.values(answers.current).filter(Boolean).length, total);
            }}
          />
        );
      })}
    </article>
  );
}

/** Help: the user manual and the agent course, with search and course progress. */
export function Help({ start }: { start?: string }) {
  const [id, setId] = useState(start ?? DOCS[0]?.id ?? "");
  const [q, setQ] = useState("");
  const [progress, setProgress] = useState(loadProgress);
  const main = useRef<HTMLDivElement>(null);
  const doc = DOCS.find((d) => d.id === id) ?? DOCS[0];
  const results = useMemo(() => search(q), [q]);
  const course = DOCS.filter((d) => d.section === "course");
  const done = course.filter((d) => progress[d.id]?.read).length;
  const save = (p: typeof progress) => {
    setProgress(p);
    try {
      localStorage.setItem(PROGRESS, JSON.stringify(p));
    } catch {
      /* storage unavailable */
    }
  };
  useEffect(() => main.current?.scrollTo({ top: 0 }), [id]);
  if (!doc) return <section className="page"><p className="muted">No help files were bundled.</p></section>;
  const i = DOCS.indexOf(doc);
  const prev = DOCS[i - 1], next = DOCS[i + 1];
  const open = (x: string) => (setId(x), setQ(""));
  return (
    <section className="help" aria-label="Help">
      <aside className="help-side">
        <label className="help-search">
          <Search size={14} aria-hidden="true" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search the manual and course" aria-label="Search help" />
        </label>
        {q.trim().length >= 2 ? (
          <ul className="help-results" aria-label="Search results">
            {results.length === 0 && <li className="muted">Nothing matches "{q}".</li>}
            {results.map((r) => (
              <li key={r.doc.id}>
                <button type="button" onClick={() => open(r.doc.id)}>
                  <b>{r.doc.title}</b>
                  <span className="muted">{r.snippet}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <>
            <h3><BookOpen size={14} aria-hidden="true" /> User manual</h3>
            <ul className="help-toc">
              {DOCS.filter((d) => d.section === "manual").map((d) => (
                <li key={d.id}><button type="button" className={d.id === doc.id ? "on" : ""} aria-current={d.id === doc.id ? "page" : undefined} onClick={() => open(d.id)}>{d.title}</button></li>
              ))}
            </ul>
            <h3><GraduationCap size={14} aria-hidden="true" /> How AI agents work</h3>
            <p className="help-progress"><span className="meter"><i style={{ width: `${course.length ? (done / course.length) * 100 : 0}%` }} /></span><span className="muted num">{done} of {course.length} chapters</span></p>
            <ul className="help-toc">
              {course.map((d) => (
                <li key={d.id}>
                  <button type="button" className={d.id === doc.id ? "on" : ""} aria-current={d.id === doc.id ? "page" : undefined} onClick={() => open(d.id)}>
                    {progress[d.id]?.read ? <CheckCircle2 size={13} className="help-done" aria-label="Completed" /> : <span className="help-num num">{d.order}</span>}
                    {d.title.replace(/^\d+\.\s*/, "")}
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </aside>
      <div className="help-main" ref={main}>
        <Chapter doc={doc} onQuizScore={(right, total) => save({ ...progress, [doc.id]: { ...progress[doc.id], quiz: Math.round((right / total) * 100) } })} />
        <footer className="help-foot">
          {doc.section === "course" && (
            <button className={progress[doc.id]?.read ? "btn" : "primary"} type="button" onClick={() => save({ ...progress, [doc.id]: { ...progress[doc.id], read: !progress[doc.id]?.read } })}>
              {progress[doc.id]?.read ? "Mark as not done" : "Mark chapter complete"}
            </button>
          )}
          {progress[doc.id]?.quiz !== undefined && <span className="muted">Quiz score: <span className="num">{progress[doc.id]!.quiz}%</span></span>}
          <span className="help-nav">
            {prev && <button className="btn" type="button" onClick={() => open(prev.id)}><ChevronLeft size={14} aria-hidden="true" /> {prev.title}</button>}
            {next && <button className="btn" type="button" onClick={() => open(next.id)}>{next.title} <ChevronRight size={14} aria-hidden="true" /></button>}
          </span>
        </footer>
      </div>
    </section>
  );
}
