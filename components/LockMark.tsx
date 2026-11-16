'use client';
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const seg = (p: number, a: number, b: number) => clamp01((p - a) / (b - a));
const ease = (t: number) => 1 - Math.pow(1 - t, 3);

function roundedRect(w: number, h: number, r: number) {
  const s = new THREE.Shape();
  const x = -w / 2, y = -h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

/**
 * 3D padlock. Scroll inserts the key, turns it, and springs the shackle open.
 * Click to slam it shut again. Tilts toward the cursor.
 */
export default function LockMark() {
  const ref = useRef<HTMLCanvasElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const canvas = ref.current!;
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true }); } catch { setFailed(true); return; }
    if (!renderer.getContext()) { setFailed(true); return; }
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

    const scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(renderer);
    const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = env;
    const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
    camera.position.set(0, 0.5, 13.5);
    camera.lookAt(0, 0.45, 0);

    const isDark = () => document.documentElement.dataset.theme === 'dark';
    const ink = new THREE.MeshStandardMaterial({ color: 0x0e0c0a, metalness: 0.6, roughness: 0.35, envMapIntensity: 0.9 });
    const red = new THREE.MeshStandardMaterial({ color: 0xff3b12, metalness: 0.25, roughness: 0.45 });
    const steel = new THREE.MeshStandardMaterial({ color: 0xd9d2c4, metalness: 1, roughness: 0.18 });
    const tint = () => ink.color.set(isDark() ? 0xe9e2d4 : 0x0e0c0a);
    tint();
    const themeObs = new MutationObserver(tint);
    themeObs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

    const lock = new THREE.Group();
    scene.add(lock);

    // body with a real keyhole cut through it; bevel/sides in vermilion
    const shape = roundedRect(2.6, 2.2, 0.28);
    const cy = 0.22, cr = 0.24, sx = 0.09;
    const sy = cy - Math.sqrt(cr * cr - sx * sx);
    const hole = new THREE.Path();
    hole.moveTo(sx, sy);
    hole.lineTo(0.15, -0.55);
    hole.lineTo(-0.15, -0.55);
    hole.lineTo(-sx, sy);
    hole.absarc(0, cy, cr, Math.atan2(sy - cy, -sx), Math.atan2(sy - cy, sx), true);
    shape.holes.push(hole);
    const bodyGeo = new THREE.ExtrudeGeometry(shape, { depth: 0.9, bevelEnabled: true, bevelThickness: 0.08, bevelSize: 0.08, bevelSegments: 4, curveSegments: 48 });
    bodyGeo.translate(0, 0, -0.45);
    const body = new THREE.Mesh(bodyGeo, [ink, red]);
    body.position.y = -0.7;
    lock.add(body);

    // shackle: half torus + two legs, pivoting on the right leg
    const shackle = new THREE.Group();
    const R = 0.82, tube = 0.17;
    const arc = new THREE.Mesh(new THREE.TorusGeometry(R, tube, 24, 72, Math.PI), steel);
    arc.position.y = 0.95;
    // like a real padlock: the free leg is short, the pivot leg is long and stays seated in the body when open
    const legGeo = new THREE.CylinderGeometry(tube, tube, 0.95, 24);
    const pivotGeo = new THREE.CylinderGeometry(tube, tube, 1.75, 24);
    const legL = new THREE.Mesh(legGeo, steel); legL.position.set(-R, 0.475, 0);       // y 0 .. 0.95
    const legR = new THREE.Mesh(pivotGeo, steel); legR.position.set(R, 0.95 - 1.75 / 2, 0); // y -0.8 .. 0.95
    const inner = new THREE.Group();
    inner.add(arc, legL, legR);
    inner.position.x = -R; // put the pivot on the right leg
    shackle.add(inner);
    shackle.position.set(R, 0.3, 0);
    lock.add(shackle);

    // key: ring head + shaft + teeth
    const key = new THREE.Group();
    const head = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.09, 16, 48), red);
    head.position.z = 2.15;
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 1.7, 16), steel);
    shaft.rotation.x = Math.PI / 2; shaft.position.z = 1.05;
    const t1 = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.26, 0.16), steel); t1.position.set(0, -0.15, 0.4);
    const t2 = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.18, 0.12), steel); t2.position.set(0, -0.11, 0.65);
    key.add(head, shaft, t1, t2);
    lock.add(key);

    scene.add(new THREE.AmbientLight(0xfff1e0, 0.4));
    const keyL = new THREE.DirectionalLight(0xffd2a8, 2.4); keyL.position.set(4, 5, 6); scene.add(keyL);
    const rim = new THREE.DirectionalLight(0xff3b12, 2.6); rim.position.set(-5, -1, -4); scene.add(rim);

    // drivers
    let p = reduced ? 1 : 0;          // scroll progress
    let forced = 0;                   // 1 = clicked shut
    const shut = { v: 0 };            // animated override (0 follow scroll, 1 locked)
    const tilt = { x: 0, y: 0 }, tiltT = { x: 0, y: 0 };
    let visible = true, raf = 0;

    const st = reduced ? null : ScrollTrigger.create({
      trigger: canvas, start: 'top 85%', end: 'center 35%', scrub: 1,
      onUpdate: (s) => { p = s.progress; },
    });

    const click = () => {
      forced = forced ? 0 : 1;
      gsap.to(shut, { v: forced, duration: forced ? 0.35 : 0.8, ease: forced ? 'power4.in' : 'elastic.out(1, 0.45)' });
      if (forced) gsap.fromTo(lock.position, { y: -0.12 }, { y: 0, duration: 0.6, ease: 'elastic.out(1.2, 0.3)', delay: 0.33 });
    };
    requestAnimationFrame(() => ScrollTrigger.refresh());
    canvas.addEventListener('click', click);
    const move = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      tiltT.y = Math.max(-0.35, Math.min(0.35, ((e.clientX - r.left) / r.width - 0.5) * 0.6));
      tiltT.x = Math.max(-0.2, Math.min(0.2, ((e.clientY - r.top) / r.height - 0.5) * 0.4));
    };
    addEventListener('pointermove', move);

    const resize = () => {
      const w = canvas.clientWidth, h = canvas.clientHeight;
      renderer.setSize(w, h, false);
      camera.aspect = w / Math.max(1, h); camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize); ro.observe(canvas); resize();
    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible) { cancelAnimationFrame(raf); raf = requestAnimationFrame(loop); } });
    io.observe(canvas);

    const clock = new THREE.Clock();
    const loop = () => {
      if (!visible) return;
      const t = clock.getElapsedTime();
      const k = p * (1 - shut.v); // effective unlock amount

      // key: fly in (0–.45), turn (.45–.65)
      const fly = ease(seg(k, 0, 0.45));
      const turn = ease(seg(k, 0.45, 0.65));
      // key stays on the keyhole axis: hovers in front, slides in, then turns
      key.position.set(0, -0.48, -0.3 + (1 - fly) * 3.2); // inserted: shaft tip at z = -0.1, inside the body
      key.rotation.set(0, 0, turn * (Math.PI / 2) + (1 - fly) * Math.sin(t * 1.4) * 0.15);
      key.visible = true;

      // shackle: lift (.65–.8) then swing (.75–1)
      const lift = ease(seg(k, 0.65, 0.8));
      const swing = ease(seg(k, 0.75, 1));
      shackle.position.y = 0.3 + lift * 0.42; // pivot leg bottom stays at y <= -0.08, inside the body
      shackle.rotation.y = -swing * 1.75;

      tilt.x += (tiltT.x - tilt.x) * 0.06;
      tilt.y += (tiltT.y - tilt.y) * 0.06;
      lock.rotation.set(0.12 + tilt.x, -0.45 + tilt.y + Math.sin(t * 0.6) * 0.06, Math.sin(t * 0.8) * 0.02);
      lock.position.y += ((reduced ? 0 : Math.sin(t * 1.2) * 0.06) - lock.position.y) * 0.05;

      renderer.render(scene, camera);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf); ro.disconnect(); io.disconnect(); themeObs.disconnect(); st?.kill();
      canvas.removeEventListener('click', click); removeEventListener('pointermove', move);
      scene.traverse((o) => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
      ink.dispose(); red.dispose(); steel.dispose(); env.dispose(); pmrem.dispose(); renderer.dispose();
    };
  }, []);

  return failed ? (
    <svg className="lock3d" viewBox="0 0 200 240" aria-hidden>
      <path d="M50 110 V70 a50 50 0 0 1 100 0 V110" fill="none" stroke="var(--ink)" strokeWidth="18" />
      <rect x="20" y="105" width="160" height="125" fill="var(--ink)" />
    </svg>
  ) : (
    <canvas ref={ref} className="lock3d" role="img" aria-label="A padlock that unlocks as you scroll. Click to lock it again." data-cursor="lock" />
  );
}
