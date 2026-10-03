/** Small SVG charts in the app's palette. Each has a text alternative for screen readers. */
const fmt = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : `${Math.round(n * 100) / 100}`);

export function LineChart({ series, dates, label }: { series: { name: string; color: string; values: number[] }[]; dates: string[]; label: string }) {
  const W = 900, H = 200, P = 24, L = 52;
  const raw = Math.max(1, ...series.flatMap((s) => s.values));
  const step = 10 ** Math.floor(Math.log10(raw));
  const max = Math.ceil(raw / step) * step; // a round number at the top of the axis
  const x = (i: number) => L + (i * (W - L - P)) / Math.max(1, dates.length - 1);
  const y = (v: number) => H - P - (v / max) * (H - P * 2);
  return (
    <figure className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${label}. ${series.map((s) => `${s.name}: ${fmt(s.values.reduce((a, b) => a + b, 0))} total`).join(". ")}`}>
        {[0, 0.5, 1].map((t) => (
          <g key={t}>
            <line x1={L} x2={W - P} y1={y(max * t)} y2={y(max * t)} className="grid" />
            <text x={L - 8} y={y(max * t) + 4} textAnchor="end" className="tick">{fmt(max * t)}</text>
          </g>
        ))}
        {series.map((s) => (
          <polyline key={s.name} fill="none" stroke={s.color} strokeWidth="2.5" strokeLinejoin="round" points={s.values.map((v, i) => `${x(i)},${y(v)}`).join(" ")} />
        ))}
        {dates.map((d, i) => (i % Math.ceil(dates.length / 6) === 0 || i === dates.length - 1 ? <text key={d} x={x(i)} y={H - 8} textAnchor="middle" className="tick">{d.slice(5)}</text> : null))}
      </svg>
      {series.length > 1 && (
        <figcaption className="legend">
          {series.map((s) => (
            <span key={s.name}><i style={{ background: s.color }} />{s.name}</span>
          ))}
        </figcaption>
      )}
    </figure>
  );
}

export function Bars({ items, unit = "" }: { items: { label: string; value: number; color?: string; note?: string }[]; unit?: string }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  if (!items.length) return <p className="muted">No data yet.</p>;
  return (
    <ul className="bars">
      {items.map((i) => (
        <li key={i.label}>
          <span className="bar-label">{i.label}</span>
          <span className="bar-track"><span className="bar-fill" style={{ width: `${(i.value / max) * 100}%`, background: i.color ?? "var(--ion)" }} /></span>
          <span className="bar-value">{fmt(i.value)}{unit}{i.note ? <span className="muted"> {i.note}</span> : null}</span>
        </li>
      ))}
    </ul>
  );
}

export { fmt };
