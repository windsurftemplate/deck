import { useEffect, useRef } from "react";
import * as THREE from "three";

const COLORS: Record<string, number> = { ok: 0x5fd39a, degraded: 0xf2b34a, blocking: 0xf06a63, dark: 0x2a3344 };

/** Labs: the power-up check as a 3D reactor. Each segment lights as its check finishes; the core glows when models are online. */
export function Reactor3D({ segments, status, lit }: { segments: readonly string[]; status: Record<string, string | undefined>; lit: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const state = useRef<{ mats: THREE.MeshStandardMaterial[]; core: THREE.MeshStandardMaterial; light: THREE.PointLight } | null>(null);
  useEffect(() => {
    const el = host.current!;
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(2, devicePixelRatio));
    renderer.setSize(360, 360);
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
    camera.position.set(0, 5.2, 7.2);
    camera.lookAt(0, 0, 0);
    scene.add(new THREE.AmbientLight(0x8899bb, 0.6));
    const key = new THREE.DirectionalLight(0xffffff, 1.2);
    key.position.set(3, 6, 4);
    scene.add(key);
    const rig = new THREE.Group();
    scene.add(rig);
    const n = segments.length;
    const mats = segments.map((_, i) => {
      const m = new THREE.MeshStandardMaterial({ color: COLORS.dark, emissive: COLORS.dark, emissiveIntensity: 0.2, metalness: 0.6, roughness: 0.35 });
      const a0 = (i / n) * Math.PI * 2 + 0.03, a1 = ((i + 1) / n) * Math.PI * 2 - 0.03;
      const seg = new THREE.Mesh(new THREE.TorusGeometry(2.4, 0.28, 16, 24, a1 - a0), m);
      seg.rotation.x = Math.PI / 2;
      seg.rotation.z = a0;
      rig.add(seg);
      return m;
    });
    const core = new THREE.MeshStandardMaterial({ color: 0x1a2533, emissive: 0x7fe3ff, emissiveIntensity: 0, metalness: 0.2, roughness: 0.2 });
    rig.add(new THREE.Mesh(new THREE.SphereGeometry(1.05, 40, 24), core));
    const housing = new THREE.Mesh(new THREE.TorusGeometry(1.55, 0.08, 12, 64), new THREE.MeshStandardMaterial({ color: 0x3a4658, metalness: 0.8, roughness: 0.3 }));
    housing.rotation.x = Math.PI / 2;
    rig.add(housing);
    const light = new THREE.PointLight(0x7fe3ff, 0, 10);
    rig.add(light);
    state.current = { mats, core, light };
    let raf = 0;
    const tick = (t: number) => {
      if (!reduce) rig.rotation.y = t / 4000;
      const pulse = 0.85 + Math.sin(t / 400) * 0.15;
      if (core.emissiveIntensity > 0) core.emissiveIntensity = 1.4 * pulse;
      renderer.render(scene, camera);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      renderer.dispose();
      el.innerHTML = "";
    };
  }, [segments.join(",")]);
  useEffect(() => {
    const s = state.current;
    if (!s) return;
    segments.forEach((id, i) => {
      const c = COLORS[status[id] ?? "dark"] ?? COLORS.dark!;
      s.mats[i]!.color.setHex(c);
      s.mats[i]!.emissive.setHex(c);
      s.mats[i]!.emissiveIntensity = status[id] ? 0.9 : 0.15;
    });
    s.core.emissiveIntensity = lit ? 1.4 : 0;
    s.light.intensity = lit ? 3 : 0;
  }, [status, lit, segments]);
  return <div ref={host} className="ring reactor3d" role="img" aria-label="Power core with subsystem ring" />;
}
