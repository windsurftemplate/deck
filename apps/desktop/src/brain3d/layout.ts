/** A small 3D force layout: linked nodes pull together, all nodes push apart, everything drifts to the center. */
export interface LNode { id: string; x: number; y: number; z: number; vx: number; vy: number; vz: number; size: number }
export interface LLink { source: string; target: string }

export function layout3d(ids: { id: string; size: number }[], links: LLink[], iterations = 260, seed = 7): LNode[] {
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647) * 2 - 1;
  const nodes: LNode[] = ids.map((n) => ({ id: n.id, x: rnd() * 30, y: rnd() * 30, z: rnd() * 30, vx: 0, vy: 0, vz: 0, size: n.size }));
  const at = new Map(nodes.map((n, i) => [n.id, i]));
  const L = links.map((l) => [at.get(l.source), at.get(l.target)]).filter((p): p is [number, number] => p[0] !== undefined && p[1] !== undefined);
  const n = nodes.length;
  for (let it = 0; it < iterations; it++) {
    const alpha = 1 - it / iterations;
    for (let i = 0; i < n; i++) {
      const a = nodes[i]!;
      for (let j = i + 1; j < n; j++) {
        const b = nodes[j]!;
        let dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
        let d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < 0.01) (dx = rnd()), (dy = rnd()), (dz = rnd()), (d2 = 0.01);
        if (d2 > 2500) continue;
        const f = (60 * alpha) / d2;
        a.vx += dx * f; a.vy += dy * f; a.vz += dz * f;
        b.vx -= dx * f; b.vy -= dy * f; b.vz -= dz * f;
      }
    }
    for (const [i, j] of L) {
      const a = nodes[i]!, b = nodes[j]!;
      const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
      const f = ((d - 6) / d) * 0.06 * alpha;
      a.vx += dx * f; a.vy += dy * f; a.vz += dz * f;
      b.vx -= dx * f; b.vy -= dy * f; b.vz -= dz * f;
    }
    for (const a of nodes) {
      a.vx -= a.x * 0.004; a.vy -= a.y * 0.004; a.vz -= a.z * 0.004;
      a.x += a.vx; a.y += a.vy; a.z += a.vz;
      a.vx *= 0.55; a.vy *= 0.55; a.vz *= 0.55;
    }
  }
  return nodes;
}
