import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { STATIONS, STATUS_COLOR, STATUS_TEXT, type StationStatus } from "./stations";

/**
 * The 3D command deck, built from the Kenney Space Station Kit (CC0).
 * Imperative three.js scene; React drives it through the small API at the bottom.
 */
const FLOOR_Y = 0.3;
const MODELS = ["floor", "floor-panel", "floor-detail", "wall", "wall-window", "wall-banner", "wall-corner", "wall-door", "door-double-closed", "rail", "computer", "computer-screen", "computer-wide", "computer-system", "chair-headrest", "chair-armrest-headrest", "chair-cushion", "table-display-planet", "table-display-small", "table-display", "table-inset", "table-large", "display-wall", "display-wall-wide", "container", "container-tall", "container-wide", "container-flat", "container-flat-open", "structure", "structure-barrier-high", "structure-panel", "pipe", "pipe-ring-colored", "pipe-end-colored", "rocks", "skip-rocks", "skip", "stairs"];
const PLACE: Record<string, { c: [number, number]; face: [number, number]; crew?: [number, number] }> = {
  command: { c: [0, -4], face: [0, -5.2], crew: [0, -4.4] },
  comms: { c: [-5.5, -4], face: [-4.8, -5.2], crew: [-4.8, -4.55] },
  engineering: { c: [5.5, -4], face: [5.5, -5.2], crew: [5.5, -4.5] },
  operations: { c: [-5.5, 0], face: [-7.6, 0], crew: [-6.5, 0] },
  science: { c: [5.5, 0], face: [5.5, -1.2], crew: [5.5, -0.45] },
  archive: { c: [-5.5, 4], face: [-5.5, 2.9], crew: [-5.5, 3.4] },
  core: { c: [0, 4], face: [0, 4] },
  vault: { c: [5.5, 4], face: [7, 4.8], crew: [6.3, 4.2] },
};

type Step = THREE.Vector3 | { wait: number } | { face: true };

interface Crew {
  mesh: THREE.Group;
  legL: THREE.Mesh;
  legR: THREE.Mesh;
  home: THREE.Vector3;
  face: [number, number];
  path: Step[];
  ring: THREE.Mesh<THREE.TorusGeometry, THREE.MeshBasicMaterial>;
  lamp: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  bob: number;
}

export interface DeckOptions {
  onSelect: (stationId: string | null) => void;
  /** Base URL of the Kenney models. */
  assetBase?: string;
}

export class DeckScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(30, 1, 0.1, 300);
  private world = new THREE.Group();
  private T: Record<string, THREE.Object3D> = {};
  private extras: { mol?: THREE.Group; banks?: THREE.Mesh[]; core?: { col: THREE.Mesh<THREE.CylinderGeometry, THREE.MeshStandardMaterial>; r1: THREE.Mesh; r2: THREE.Mesh }; wheel?: THREE.Group } = {};
  private crew: Record<string, Crew> = {};
  private status: Record<string, StationStatus> = Object.fromEntries(STATIONS.map((s) => [s.id, "idle"]));
  private task: Record<string, string> = {};
  private hits: THREE.Mesh[] = [];
  private beams: { line: THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>; spark: THREE.Mesh; curve: THREE.QuadraticBezierCurve3; t: number }[] = [];
  private archivePulse = 0;
  private stopped = false;
  private coreLight = new THREE.PointLight(0x8fe6ff, 1.1 * Math.PI, 7, 1);
  private rig = { target: new THREE.Vector3(0.5, 0.4, 1.1), radius: 31, theta: Math.PI / 4, phi: 0.92 };
  private fly: { from: { target: THREE.Vector3; radius: number; theta: number; phi: number }; to: { target: THREE.Vector3; radius: number; theta: number; phi: number }; t: number } | null = null;
  private selected: string | null = null;
  private raf = 0;
  private clock = new THREE.Clock();
  private t = 0;
  private reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  private tags: Record<string, { s: HTMLDivElement; c: HTMLDivElement }> = {};
  private cleanup: (() => void)[] = [];
  ready: Promise<void>;

  constructor(
    private canvas: HTMLCanvasElement,
    private overlay: HTMLDivElement,
    private opts: DeckOptions,
  ) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene.background = new THREE.Color(0x2b2b31);
    this.scene.add(new THREE.HemisphereLight(0xe8e6ff, 0x3a3848, 0.85 * Math.PI));
    const sun = new THREE.DirectionalLight(0xffffff, 0.95 * Math.PI);
    sun.position.set(-9, 16, 11);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -14, right: 14, top: 14, bottom: -14, near: 1, far: 50 });
    sun.shadow.bias = -0.0006;
    sun.shadow.normalBias = 0.02;
    this.scene.add(sun);
    this.coreLight.position.set(0, 1.4, 4);
    this.scene.add(this.coreLight, this.world);
    this.ground();
    for (const s of STATIONS) {
      const sTag = document.createElement("div");
      sTag.className = "tag station";
      sTag.textContent = s.name;
      const cTag = document.createElement("div");
      cTag.className = "tag";
      overlay.append(sTag, cTag);
      this.tags[s.id] = { s: sTag, c: cTag };
    }
    this.input();
    this.ready = this.load(opts.assetBase ?? "kenney/").then(() => {
      this.build();
      for (const s of STATIONS) if (PLACE[s.id]!.crew) this.makeCrew(s.id, s.color);
      for (const s of STATIONS) {
        const p = PLACE[s.id]!;
        const hit = new THREE.Mesh(new THREE.BoxGeometry(s.id === "command" || s.id === "core" ? 6 : 5, 2.5, 4), new THREE.MeshBasicMaterial({ visible: false }));
        hit.position.set(p.c[0], 1.2, p.c[1]);
        hit.userData.station = s.id;
        this.scene.add(hit);
        this.hits.push(hit);
      }
      this.resize();
      for (const s of STATIONS) this.apply(s.id);
      this.frame();
    });
  }

  private ground() {
    const c = document.createElement("canvas");
    c.width = c.height = 128;
    const g = c.getContext("2d")!;
    g.fillStyle = "#323238";
    g.fillRect(0, 0, 128, 128);
    g.fillStyle = "#2C2C32";
    g.fillRect(0, 0, 64, 64);
    g.fillRect(64, 64, 64, 64);
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(30, 30);
    t.colorSpace = THREE.SRGBColorSpace;
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(120, 120), new THREE.MeshStandardMaterial({ map: t, roughness: 1 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.001;
    ground.receiveShadow = true;
    this.scene.add(ground);
  }

  private async load(base: string) {
    const loader = new GLTFLoader();
    await Promise.all(
      MODELS.map(async (n) => {
        const g = await loader.loadAsync(`${base}${n}.glb`);
        g.scene.traverse((o) => {
          if ((o as THREE.Mesh).isMesh) {
            o.castShadow = true;
            o.receiveShadow = true;
          }
        });
        this.T[n] = g.scene;
      }),
    );
  }

  private put(n: string, x: number, z: number, ry = 0, y = FLOOR_Y, s = 1) {
    const o = this.T[n]!.clone(true);
    o.position.set(x, y, z);
    o.rotation.y = ry;
    o.scale.setScalar(s);
    this.world.add(o);
    return o;
  }

  private build(){
    const put = this.put.bind(this), world = this.world, extras = this.extras, glowMat = (c: number) => new THREE.MeshBasicMaterial({ color: c });
    // floor tiles
    for (let x = -8; x < 8; x++) for (let z = -6; z < 6; z++){
      const cx = x + .5, cz = z + .5;
      const inCmd = cx > -3 && cx < 3 && cz < -2, inVault = cx > 3 && cz > 2, inCore = cx > -3 && cx < 3 && cz > 2;
      const hub = cx > -3 && cx < 3 && cz > -2 && cz < 2;
      const n = inCmd || inVault ? 'floor-panel' : inCore ? 'floor-detail' : hub && (x + z) % 3 === 0 ? 'floor-detail' : 'floor';
      put(n, cx, cz, 0, 0);
    }
    // back wall with viewport windows, left wall with a door
    for (let x = -8; x < 8; x++){
      const cx = x + .5;
      const n = Math.abs(cx) < 2 ? 'wall-window' : (x % 4 === 0 ? 'wall-banner' : 'wall');
      put(n, cx, -6.15, 0);
    }
    for (let z = -6; z < 6; z++){
      const cz = z + .5;
      const n = Math.abs(cz) < .6 ? 'wall-door' : (z % 4 === 2 ? 'wall-banner' : 'wall');
      put(n, -8.15, cz, Math.PI/2);
    }
    put('door-double-closed', -8.15, .5, Math.PI/2);
    put('wall-corner', -8.15, -6.15, 0);

    // room dividers: low rails with doorways
    const gapsX: number[] = [-5.5, 0, 5.5], gapsZ = [-4, 0, 4];
    [-2, 2].forEach(z => { for (let x = -8; x < 8; x++){ const cx = x + .5; if (gapsX.some(g => Math.abs(g - cx) < .6)) continue; put('rail', cx, z, 0); } });
    [-3, 3].forEach(x => { for (let z = -6; z < 6; z++){ const cz = z + .5; if (gapsZ.some(g => Math.abs(g - cz) < .6)) continue; if (Math.abs(cz) < .6) continue; put('rail', x, cz, Math.PI/2); } });

    // Command
    put('computer-wide', -1.1, -5.4); put('computer-wide', 1.1, -5.4); put('computer', 0, -5.45);
    put('chair-armrest-headrest', 0, -3.3, Math.PI);
    put('table-display-planet', -1.9, -2.9 , 0, FLOOR_Y + .1);
    put('display-wall', 2.3, -5.85, 0, FLOOR_Y + .35);
    // Comms
    put('computer-screen', -6.3, -5.4); put('computer-screen', -4.8, -5.4);
    put('chair-headrest', -6.3, -4.6, Math.PI);
    put('table-display-small', -7, -2.8, 0, FLOOR_Y + .3);
    put('display-wall-wide', -7.85, -4.2, Math.PI/2, FLOOR_Y + .35);
    // Engineering
    put('computer-system', 5.5, -5.4); put('computer', 4.2, -5.45);
    for (let i = 0; i < 3; i++){ put(i === 1 ? 'pipe-ring-colored' : 'pipe', 7.5, -5.6, 0, FLOOR_Y + i * .5); put(i === 2 ? 'pipe-end-colored' : 'pipe', 6.9, -5.6, 0, FLOOR_Y + i * .5); }
    put('container-tall', 7.3, -2.9); put('container', 3.8, -2.8);
    // Operations
    put('table-large', -5.2, .3, Math.PI/2);
    put('chair-cushion', -4.5, -.3, -Math.PI/2); put('chair-cushion', -4.5, .9, -Math.PI/2);
    put('display-wall-wide', -7.85, 0, Math.PI/2, FLOOR_Y + .35);
    put('container', -3.9, 1.4); put('container-wide', -7.2, 1.5);
    // Science lab
    put('table-inset', 5.5, -1.2, 0, FLOOR_Y + .3);
    put('table-display', 5.6, 1.1, Math.PI, FLOOR_Y + .3);
    put('container-flat-open', 7.4, .9, 0); put('pipe-ring-colored', 3.7, -1.3);
    const mol = new THREE.Group(); mol.position.set(5.6, FLOOR_Y + .95, 1.1); world.add(mol);
    ([[0,0,0],[.16,.08,0],[-.13,.1,.05],[.05,-.15,.08],[-.07,-.05,-.15]] as [number,number,number][]).forEach((p,i) => { const b = new THREE.Mesh(new THREE.SphereGeometry(i ? .045 : .07, 12, 8), glowMat(i ? 0xFF9DD2 : 0x6FD6FF)); b.position.set(...p); mol.add(b); });
    extras.mol = mol;
    // Archive: memory crates with light strips
    const banks: THREE.Mesh[] = [];
    ([[-7.3,2.8],[-7.3,3.8],[-7.3,4.8],[-6.4,5.4],[-5.4,5.4]] as [number,number][]).forEach(([x,z], i) => {
      put(i < 3 ? 'container-tall' : 'container-wide', x, z, i < 3 ? Math.PI/2 : 0);
      const strip = new THREE.Mesh(new THREE.BoxGeometry(.05, .5, .25), glowMat(0x9FB7FF)); strip.position.set(x + (i < 3 ? .42 : 0), FLOOR_Y + .45, z - (i < 3 ? 0 : .32)); if (i >= 3) strip.rotation.y = Math.PI/2; world.add(strip); banks.push(strip);
    });
    put('computer', -5.5, 2.75);
    extras.banks = banks;
    // Reactor core: two-story frame around a plasma column
    put('structure', .5, 3.5, 0); put('structure', .5, 3.5, 0, FLOOR_Y + .9);
    put('structure-panel', 0, 4, 0, FLOOR_Y + 1.8);
    const col = new THREE.Mesh(new THREE.CylinderGeometry(.2, .2, 1.65, 24), new THREE.MeshStandardMaterial({ color:0xCFF6FF, emissive:0x6FD6FF, emissiveIntensity:1.3 }));
    col.position.set(0, FLOOR_Y + .85, 4); world.add(col);
    const r1 = new THREE.Mesh(new THREE.TorusGeometry(.36, .03, 8, 40), glowMat(0x6FD6FF)); r1.position.copy(col.position); world.add(r1);
    const r2 = new THREE.Mesh(new THREE.TorusGeometry(.46, .022, 8, 40), glowMat(0xFFC23D)); r2.position.copy(col.position); world.add(r2);
    extras.core = { col, r1, r2 };
    ([[-1.4,3.2],[1.4,3.2],[-1.4,4.8],[1.4,4.8]] as [number,number][]).forEach(([x,z]) => { put('pipe', x, z); put('pipe-end-colored', x, z, 0, FLOOR_Y + .5); });
    // Vault: caged safe
    put('structure-barrier-high', 7.6, 4.0, 0);
    put('container-flat', 7.1, 4.5, 0);
    put('computer', 4.4, 2.75);
    put('door-double-closed', 5.5, 5.95, 0);
    const wheel = new THREE.Group(); wheel.position.set(7.1, FLOOR_Y + .45, 5.06); world.add(wheel);
    for (let i = 0; i < 3; i++){ const sp = new THREE.Mesh(new THREE.BoxGeometry(.03, .26, .03), glowMat(0xFF8F6B)); sp.rotation.z = i * Math.PI / 3; wheel.add(sp); }
    extras.wheel = wheel;
    // Front steps and outside clutter, like a working outpost
    put('stairs', 0, 6.5, Math.PI, 0); put('stairs', 1, 6.5, Math.PI, 0);
    put('rocks', 11, 5.8, .4, 0); put('skip-rocks', 9.6, 2.4, -.3, 0); put('skip', 9.6, 5.0, .2, 0);
    put('container', -9.4, 6.5, .3, 0); put('container-tall', -10.2, 5.2, 0, 0);
    put('rocks', -9.2, 8.8, 1.9, 0);
  }



  private makeCrew(id: string, color: number) {
    const a = new THREE.Group();
    const suit = new THREE.MeshStandardMaterial({ color: 0xd9d7fa, roughness: 0.55, metalness: 0.05 });
    const trim = new THREE.MeshStandardMaterial({ color, roughness: 0.5 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x2a2a3a, roughness: 0.3, metalness: 0.4 });
    const legL = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.055, 0.18, 10), suit);
    legL.position.set(-0.06, 0.09, 0);
    const legR = legL.clone();
    legR.position.x = 0.06;
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.13, 0.24, 14), suit);
    body.position.y = 0.3;
    const belt = new THREE.Mesh(new THREE.CylinderGeometry(0.135, 0.135, 0.04, 14), trim);
    belt.position.y = 0.22;
    const pack = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.2, 0.08), trim);
    pack.position.set(0, 0.32, -0.14);
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.15, 20, 16), suit);
    helmet.position.y = 0.53;
    const visor = new THREE.Mesh(new THREE.SphereGeometry(0.11, 20, 12, -Math.PI * 0.45, Math.PI * 0.9, Math.PI * 0.28, Math.PI * 0.38), dark);
    visor.position.set(0, 0.53, 0.045);
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.025, 8, 6), new THREE.MeshBasicMaterial({ color: 0x55546a }));
    lamp.position.set(0, 0.69, 0.03);
    for (const m of [legL, legR, body, belt, pack, helmet, visor]) {
      m.castShadow = true;
      a.add(m);
    }
    a.add(lamp);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.26, 0.025, 6, 36), new THREE.MeshBasicMaterial({ color: 0x55546a }));
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.02;
    a.add(ring);
    const p = PLACE[id]!;
    a.position.set(p.crew![0], FLOOR_Y, p.crew![1]);
    a.rotation.y = Math.atan2(p.face[0] - a.position.x, p.face[1] - a.position.z);
    this.world.add(a);
    this.crew[id] = { mesh: a, ring, lamp, legL, legR, home: a.position.clone(), face: p.face, path: [], bob: Math.random() * 6 };
  }

  private apply(id: string) {
    const st = this.status[id]!;
    const cr = this.crew[id];
    if (cr) {
      cr.ring.material.color.setHex(STATUS_COLOR[st]);
      cr.lamp.material.color.setHex(st === "idle" ? 0x55546a : STATUS_COLOR[st]);
    }
    const s = STATIONS.find((x) => x.id === id)!;
    const tag = this.tags[id]!.c;
    tag.className = `tag ${st}`;
    tag.textContent = `${s.crew} · ${STATUS_TEXT[st]}${this.task[id] && st !== "idle" ? `: ${this.task[id]}` : ""}`;
  }

  /* ---------- camera and input ---------- */
  private narrow = () => this.canvas.clientWidth < 720;
  private homeRadius = () => (this.narrow() ? 56 : 31);
  private flyTo(target: THREE.Vector3, radius: number, theta: number, phi: number) {
    let dt = theta - this.rig.theta;
    dt = Math.atan2(Math.sin(dt), Math.cos(dt));
    const to = { target, radius, theta: this.rig.theta + dt, phi };
    if (this.reduce) {
      Object.assign(this.rig, to);
      this.fly = null;
      return;
    }
    this.fly = { from: { ...this.rig, target: this.rig.target.clone() }, to, t: 0 };
  }

  private input() {
    const c = this.canvas;
    const pointers = new Map<number, { x: number; y: number }>();
    let moved = 0, pinch0 = 0, radius0 = 0;
    const clampR = (v: number) => Math.min(80, Math.max(6, v));
    const down = (e: PointerEvent) => {
      c.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      moved = 0;
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinch0 = Math.hypot(a!.x - b!.x, a!.y - b!.y);
        radius0 = this.rig.radius;
      }
    };
    const move = (e: PointerEvent) => {
      const p = pointers.get(e.pointerId);
      if (!p) return;
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      p.x = e.clientX;
      p.y = e.clientY;
      if (pointers.size === 1) {
        moved += Math.abs(dx) + Math.abs(dy);
        this.rig.theta -= dx * 0.006;
        this.rig.phi = Math.min(1.3, Math.max(0.3, this.rig.phi - dy * 0.005));
        this.fly = null;
      } else if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        this.rig.radius = clampR((radius0 * pinch0) / Math.hypot(a!.x - b!.x, a!.y - b!.y));
        moved = 99;
        this.fly = null;
      }
    };
    const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
    const up = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      if (moved < 6 && pointers.size === 0) {
        const r = c.getBoundingClientRect();
        ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
        ray.setFromCamera(ndc, this.camera);
        const h = ray.intersectObjects(this.hits, false)[0];
        if (h) this.opts.onSelect(h.object.userData.station as string);
      }
    };
    const cancel = (e: PointerEvent) => pointers.delete(e.pointerId);
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      this.rig.radius = clampR(this.rig.radius * (1 + e.deltaY * 0.001));
      this.fly = null;
    };
    c.addEventListener("pointerdown", down);
    c.addEventListener("pointermove", move);
    c.addEventListener("pointerup", up);
    c.addEventListener("pointercancel", cancel);
    c.addEventListener("wheel", wheel, { passive: false });
    this.cleanup.push(() => {
      c.removeEventListener("pointerdown", down);
      c.removeEventListener("pointermove", move);
      c.removeEventListener("pointerup", up);
      c.removeEventListener("pointercancel", cancel);
      c.removeEventListener("wheel", wheel);
    });
  }

  /* ---------- frame ---------- */
  private v = new THREE.Vector3();
  private project(pos: THREE.Vector3, el: HTMLElement, dy = 0) {
    this.v.copy(pos).project(this.camera);
    el.style.display = this.v.z > 1 ? "none" : "";
    el.style.left = `${(this.v.x * 0.5 + 0.5) * this.canvas.clientWidth}px`;
    el.style.top = `${(-this.v.y * 0.5 + 0.5) * this.canvas.clientHeight + dy}px`;
  }

  private frame = () => {
    const raw = this.clock.getDelta(), dt = Math.min(raw, 0.05);
    this.t += this.reduce ? 0 : dt;
    const t = this.t;
    if (this.fly) {
      const f = this.fly;
      f.t = Math.min(1, f.t + Math.min(raw, 0.25) / 1.1);
      const k = f.t < 0.5 ? 2 * f.t * f.t : 1 - Math.pow(-2 * f.t + 2, 2) / 2;
      this.rig.target.lerpVectors(f.from.target, f.to.target, k);
      this.rig.radius = f.from.radius + (f.to.radius - f.from.radius) * k;
      this.rig.theta = f.from.theta + (f.to.theta - f.from.theta) * k;
      this.rig.phi = f.from.phi + (f.to.phi - f.from.phi) * k;
      if (f.t >= 1) this.fly = null;
    }
    const { target: tg, radius: R, theta: th, phi: ph } = this.rig;
    this.camera.position.set(tg.x + R * Math.sin(ph) * Math.sin(th), tg.y + R * Math.cos(ph), tg.z + R * Math.sin(ph) * Math.cos(th));
    this.camera.lookAt(tg);

    const working = Object.values(this.status).filter((s) => s === "working").length;
    const core = this.extras.core!;
    const power = this.stopped ? 0.15 : 1;
    core.r1.rotation.x = Math.PI / 2 + Math.sin(t * 0.8) * 0.3;
    core.r1.rotation.z = t * (0.7 + working * 0.25) * power;
    core.r2.rotation.x = Math.PI / 2 - Math.sin(t * 0.6) * 0.35;
    core.r2.rotation.y = t * (0.5 + working * 0.2) * power;
    core.col.material.emissiveIntensity = (1.1 + Math.sin(t * 2.5) * 0.25) * power;
    this.coreLight.intensity = (1 + Math.sin(t * 2.5) * 0.2) * Math.PI * power;
    this.extras.mol!.rotation.y = t * 0.8;
    this.extras.wheel!.rotation.z = t * 0.4;
    this.archivePulse = Math.max(0, this.archivePulse - dt);
    for (const [i, b] of this.extras.banks!.entries()) (b.material as THREE.MeshBasicMaterial).color.setHex(this.archivePulse > 0 && Math.sin(t * 10 + i) > 0 ? 0xffffff : 0x9fb7ff);
    for (const [id, cr] of Object.entries(this.crew)) {
      const st = this.status[id];
      if (st === "needs") cr.ring.material.color.setHex(STATUS_COLOR.needs).multiplyScalar(0.55 + Math.sin(t * 5) * 0.45);
      if (st === "blocked") cr.ring.material.color.setHex(Math.sin(t * 8) > 0 ? STATUS_COLOR.blocked : 0x4a2020);
      const m = cr.mesh;
      if (cr.path.length && !this.reduce) {
        const step = cr.path[0]!;
        if ("wait" in step) {
          step.wait -= dt;
          if (step.wait <= 0) cr.path.shift();
        } else if ("face" in step) {
          m.rotation.y = Math.atan2(cr.face[0] - m.position.x, cr.face[1] - m.position.z);
          cr.path.shift();
        } else {
          const dir = step.clone().sub(m.position);
          dir.y = 0;
          const dist = dir.length();
          if (dist < 0.04) cr.path.shift();
          else {
            dir.normalize();
            m.position.addScaledVector(dir, Math.min(dist, dt * 1.6));
            m.rotation.y = Math.atan2(dir.x, dir.z);
          }
        }
        const sw = Math.sin(t * 12) * 0.35;
        cr.legL.rotation.x = sw;
        cr.legR.rotation.x = -sw;
        m.position.y = FLOOR_Y + Math.abs(Math.sin(t * 12)) * 0.02;
      } else {
        if (cr.path.length) cr.path = [];
        cr.legL.rotation.x = cr.legR.rotation.x = 0;
        m.position.y = FLOOR_Y + (this.reduce ? 0 : Math.max(0, Math.sin(t * 1.6 + cr.bob)) * 0.012);
      }
    }
    for (let i = this.beams.length - 1; i >= 0; i--) {
      const b = this.beams[i]!;
      b.t += dt / 1.3;
      b.spark.position.copy(b.curve.getPoint(Math.min(1, b.t)));
      b.line.material.opacity = Math.max(0, 0.95 - Math.max(0, b.t - 0.6) * 2);
      b.spark.visible = b.t < 1;
      if (b.t > 1.1) {
        this.scene.remove(b.line, b.spark);
        b.line.geometry.dispose();
        this.beams.splice(i, 1);
      }
    }
    for (const s of STATIONS) {
      const p = PLACE[s.id]!;
      const tag = this.tags[s.id]!;
      this.project(new THREE.Vector3(p.c[0], FLOOR_Y, p.c[1] + 1.2), tag.s);
      const cr = this.crew[s.id];
      this.project(cr ? cr.mesh.position.clone().setY(cr.mesh.position.y + 0.95) : new THREE.Vector3(p.c[0], FLOOR_Y + 2.2, p.c[1]), tag.c, -4);
      const st = this.status[s.id];
      tag.c.style.visibility = (st === "idle" && this.rig.radius > 16) || (!this.selected && this.rig.radius > 22 && st !== "needs" && st !== "blocked") ? "hidden" : "visible";
    }
    this.renderer.render(this.scene, this.camera);
    this.raf = requestAnimationFrame(this.frame);
  };

  /* ---------- API ---------- */
  resize() {
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    // With a station open, shift the view left so the side panel does not cover it.
    if (this.selected && w >= 720) {
      this.camera.aspect = (w + 360) / h;
      this.camera.setViewOffset(w + 360, h, 360, 0, w, h);
    } else {
      this.camera.aspect = w / h;
      this.camera.clearViewOffset();
    }
    this.camera.updateProjectionMatrix();
  }

  setStation(id: string, status: StationStatus, task?: string) {
    this.status[id] = status;
    if (task !== undefined) this.task[id] = task;
    if (this.crew[id] || this.tags[id]) this.apply(id);
  }

  setStopped(stopped: boolean) {
    this.stopped = stopped;
  }

  /** A beam from the vault to a station: an approved action went out. */
  beam(toStation: string) {
    const cr = this.crew[toStation];
    if (!cr) return;
    const from = new THREE.Vector3(7.1, FLOOR_Y + 0.7, 4.6);
    const to = cr.mesh.position.clone().setY(FLOOR_Y + 0.8);
    const mid = from.clone().add(to).multiplyScalar(0.5);
    mid.y += 2.2;
    const curve = new THREE.QuadraticBezierCurve3(from, mid, to);
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(curve.getPoints(40)), new THREE.LineBasicMaterial({ color: 0xffc23d, transparent: true, opacity: 0.95 }));
    const spark = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffe29a }));
    this.scene.add(line, spark);
    this.beams.push({ line, spark, curve, t: 0 });
  }

  /**
   * A crew member walks to Command and back: picking up a task from the Chief of Staff, or reporting back.
   * Skipped with reduced motion, and for the Chief of Staff, who is already at Command.
   */
  visitCommand(station: string) {
    const cr = this.crew[station];
    if (!cr || station === "command" || cr.path.length || this.reduce) return;
    const c = PLACE[station]!.c;
    const sx = Math.sign(c[0] || 1);
    const door = Math.abs(c[0]) > 3 ? new THREE.Vector3(sx * 3, FLOOR_Y, c[1]) : new THREE.Vector3(c[0], FLOOR_Y, Math.sign(c[1]) * 2);
    const hub = new THREE.Vector3(sx * 0.8, FLOOR_Y, 0);
    const cmdDoor = new THREE.Vector3(0, FLOOR_Y, -2);
    const cmd = new THREE.Vector3(sx * 0.9, FLOOR_Y, -3.6);
    cr.path = [door, hub, cmdDoor, cmd, { wait: 1.6 }, cmdDoor.clone(), hub.clone(), door.clone(), cr.home.clone(), { face: true }];
  }

  /** Archive lights up: memory learned something. */
  pulseArchive() {
    this.archivePulse = 2.5;
  }

  focus(id: string | null) {
    this.selected = id;
    this.resize();
    if (!id) return this.flyTo(new THREE.Vector3(0.5, 0.4, 1.1), this.homeRadius(), Math.PI / 4, 0.92);
    const p = PLACE[id]!;
    this.flyTo(new THREE.Vector3(p.c[0], 0.6, p.c[1]), this.narrow() ? 20 : 13, Math.PI / 4 + (p.c[0] < -1 ? -0.25 : p.c[0] > 1 ? 0.25 : 0), 0.85);
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.cleanup.forEach((f) => f());
    this.overlay.replaceChildren();
    this.renderer.dispose();
  }
}
