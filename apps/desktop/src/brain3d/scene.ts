import * as THREE from "three";
import { layout3d } from "./layout";

export interface BrainNode { id: string; label: string; type: "subject" | "doc" | "owner"; kind?: string; size: number }
export interface BrainLink { source: string; target: string; label: string }

const NODE_COLOR = (n: BrainNode) =>
  n.type === "owner" ? 0xff9a3d : n.type === "subject" ? 0xc59bff : n.kind === "note" ? 0x7cf5b0 : n.kind === "page" ? 0xff9dd2 : ["obsidian", "notion", "apple-notes", "chatgpt", "codex"].includes(n.kind ?? "") ? 0xffd27a : 0x6fd6ff;

/** The second brain as a constellation: facts' subjects and documents as stars, links as faint lines. */
export class BrainScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(50, 1, 0.1, 2000);
  private group = new THREE.Group();
  private meshes = new Map<string, THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>>();
  private pos = new Map<string, THREE.Vector3>();
  private lines: THREE.LineSegments | null = null;
  private rig = { theta: 0.6, phi: 1.2, radius: 90, target: new THREE.Vector3() };
  private goal: { target: THREE.Vector3; radius: number } | null = null;
  private raf = 0;
  private hover: string | null = null;
  private selected: string | null = null;
  private highlight = new Set<string>();
  private label: HTMLDivElement;
  private reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  private cleanup: (() => void)[] = [];
  private nodes: BrainNode[] = [];
  private tags: { id: string; el: HTMLDivElement }[] = [];
  private v = new THREE.Vector3();

  constructor(private canvas: HTMLCanvasElement, private overlayEl: HTMLDivElement, private onSelect: (id: string | null) => void) {
    const overlay = overlayEl;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.scene.background = new THREE.Color(0x14131c);
    this.scene.add(this.group);
    // Distant stars for depth.
    const g = new THREE.BufferGeometry();
    const pts = new Float32Array(1500 * 3);
    for (let i = 0; i < pts.length; i++) pts[i] = (Math.random() * 2 - 1) * 600;
    g.setAttribute("position", new THREE.BufferAttribute(pts, 3));
    this.scene.add(new THREE.Points(g, new THREE.PointsMaterial({ color: 0x55546a, size: 1.2 })));
    this.label = document.createElement("div");
    this.label.className = "brain-label";
    overlay.append(this.label);
    this.input();
    this.frame();
  }

  setData(nodes: BrainNode[], links: BrainLink[]) {
    this.nodes = nodes;
    for (const m of this.meshes.values()) (this.group.remove(m), m.geometry.dispose(), m.material.dispose());
    this.meshes.clear();
    if (this.lines) (this.group.remove(this.lines), this.lines.geometry.dispose());
    const placed = layout3d(nodes.map((n) => ({ id: n.id, size: n.size })), links);
    this.pos = new Map(placed.map((p) => [p.id, new THREE.Vector3(p.x, p.y, p.z)]));
    for (const n of nodes) {
      const r = n.type === "owner" ? 2 : 0.55 + Math.min(2, Math.sqrt(n.size) * 0.45);
      const m = new THREE.Mesh(new THREE.SphereGeometry(r, 16, 12), new THREE.MeshBasicMaterial({ color: NODE_COLOR(n), transparent: true, opacity: 0.95 }));
      m.position.copy(this.pos.get(n.id)!);
      m.userData.id = n.id;
      this.group.add(m);
      this.meshes.set(n.id, m);
    }
    const seg: number[] = [];
    for (const l of links) {
      const a = this.pos.get(l.source), b = this.pos.get(l.target);
      if (a && b) seg.push(a.x, a.y, a.z, b.x, b.y, b.z);
    }
    const lg = new THREE.BufferGeometry();
    lg.setAttribute("position", new THREE.Float32BufferAttribute(seg, 3));
    this.lines = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0x8f8ab8, transparent: true, opacity: 0.28 }));
    this.group.add(this.lines);
    const radius = Math.max(40, ...[...this.pos.values()].map((p) => p.length() * 2.6));
    // Always-on names for the biggest people and things; everything else shows on hover.
    for (const t of this.tags) t.el.remove();
    this.tags = nodes
      .filter((n) => n.type !== "doc")
      .sort((a, b) => b.size - a.size)
      .slice(0, 14)
      .map((n) => {
        const el = document.createElement("div");
        el.className = "brain-tag";
        el.textContent = n.label;
        this.overlayEl.append(el);
        return { id: n.id, el };
      });
    this.goal = { target: new THREE.Vector3(), radius };
    this.paint();
  }

  /** Brighten matching nodes and dim the rest; empty clears. Flies to the first match. */
  search(q: string): number {
    const t = q.trim().toLowerCase();
    this.highlight = new Set(t ? this.nodes.filter((n) => n.label.toLowerCase().includes(t)).map((n) => n.id) : []);
    this.paint();
    const first = [...this.highlight][0];
    if (first) this.focus(first);
    return this.highlight.size;
  }

  focus(id: string | null) {
    this.selected = id;
    this.paint();
    const p = id && this.pos.get(id);
    if (p) this.goal = { target: p.clone(), radius: 28 };
  }

  private paint() {
    const any = this.highlight.size > 0;
    for (const [id, m] of this.meshes) {
      const on = id === this.selected || id === this.hover || this.highlight.has(id);
      m.material.opacity = any && !on ? 0.18 : 0.95;
      m.scale.setScalar(on ? 1.6 : 1);
    }
  }

  private input() {
    const c = this.canvas;
    let down: { x: number; y: number } | null = null, moved = 0;
    const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
    const pick = (e: PointerEvent) => {
      const r = c.getBoundingClientRect();
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, this.camera);
      return (ray.intersectObjects([...this.meshes.values()], false)[0]?.object.userData.id as string | undefined) ?? null;
    };
    const pd = (e: PointerEvent) => ((down = { x: e.clientX, y: e.clientY }), (moved = 0), c.setPointerCapture(e.pointerId));
    const pm = (e: PointerEvent) => {
      if (down) {
        const dx = e.clientX - down.x, dy = e.clientY - down.y;
        moved += Math.abs(dx) + Math.abs(dy);
        this.rig.theta -= dx * 0.006;
        this.rig.phi = Math.min(2.9, Math.max(0.2, this.rig.phi - dy * 0.006));
        down = { x: e.clientX, y: e.clientY };
        return;
      }
      const h = pick(e);
      if (h !== this.hover) (this.hover = h), this.paint();
      const n = h && this.nodes.find((x) => x.id === h);
      this.label.textContent = n ? n.label : "";
      this.label.style.display = n ? "block" : "none";
      this.label.style.left = `${e.offsetX + 14}px`;
      this.label.style.top = `${e.offsetY + 10}px`;
      c.style.cursor = n ? "pointer" : "grab";
    };
    const pu = (e: PointerEvent) => {
      if (down && moved < 6) {
        const h = pick(e);
        this.onSelect(h);
      }
      down = null;
    };
    const wheel = (e: WheelEvent) => (e.preventDefault(), (this.rig.radius = Math.min(900, Math.max(8, this.rig.radius * (1 + e.deltaY * 0.001)))), (this.goal = null));
    c.addEventListener("pointerdown", pd);
    c.addEventListener("pointermove", pm);
    c.addEventListener("pointerup", pu);
    c.addEventListener("wheel", wheel, { passive: false });
    this.cleanup.push(() => (c.removeEventListener("pointerdown", pd), c.removeEventListener("pointermove", pm), c.removeEventListener("pointerup", pu), c.removeEventListener("wheel", wheel)));
  }

  resize() {
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private frame = () => {
    if (this.goal) {
      const k = this.reduce ? 1 : 0.08;
      this.rig.target.lerp(this.goal.target, k);
      this.rig.radius += (this.goal.radius - this.rig.radius) * k;
      if (this.rig.target.distanceTo(this.goal.target) < 0.05 && Math.abs(this.rig.radius - this.goal.radius) < 0.1) this.goal = null;
    }
    if (!this.reduce && !this.selected) this.rig.theta += 0.0008;
    const { theta, phi, radius, target } = this.rig;
    this.camera.position.set(target.x + radius * Math.sin(phi) * Math.sin(theta), target.y + radius * Math.cos(phi), target.z + radius * Math.sin(phi) * Math.cos(theta));
    this.camera.lookAt(target);
    for (const t of this.tags) {
      const p = this.pos.get(t.id);
      if (!p) continue;
      this.v.copy(p).project(this.camera);
      const hidden = this.v.z > 1 || (this.highlight.size > 0 && !this.highlight.has(t.id));
      t.el.style.display = hidden ? "none" : "";
      t.el.style.left = `${(this.v.x * 0.5 + 0.5) * this.canvas.clientWidth}px`;
      t.el.style.top = `${(-this.v.y * 0.5 + 0.5) * this.canvas.clientHeight + 10}px`;
    }
    this.renderer.render(this.scene, this.camera);
    this.raf = requestAnimationFrame(this.frame);
  };

  dispose() {
    cancelAnimationFrame(this.raf);
    this.cleanup.forEach((f) => f());
    this.label.remove();
    for (const t of this.tags) t.el.remove();
    this.renderer.dispose();
  }
}
