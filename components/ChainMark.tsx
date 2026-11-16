'use client';
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { gsap } from 'gsap';
import { currentBlock, fakeHash, heroState, onBlock } from '@/lib/runtime';

const GAP = 1.9;           // distance between blocks along the chain
const KEEP = 4;            // blocks visible
const SIZE = 1.35;
const DROP = 1.1;          // height a new block falls from
const BASE = Math.PI / 4;  // turns the chain so it runs left → right on screen

/** next/font gives the families hashed names; read the real ones from the CSS variables */
const fam = (v: string, fb: string) => (typeof document === 'undefined' ? fb : getComputedStyle(document.documentElement).getPropertyValue(v).trim() || fb);

function label(n: number, head: boolean) {
  const MONO = fam('--font-mono', 'ui-monospace, monospace');
  const DISPLAY = fam('--font-display', 'system-ui, sans-serif');
  const c = document.createElement('canvas');
  c.width = 512; c.height = 512;
  const g = c.getContext('2d')!;
  g.fillStyle = head ? '#FF3B12' : '#0E0C0A';
  g.fillRect(0, 0, 512, 512);
  g.fillStyle = head ? '#0E0C0A' : '#FF3B12';
  g.font = `700 44px ${MONO}`;
  g.fillText(head ? '● HEAD' : '✓ FINAL', 40, 86);
  g.fillStyle = head ? '#0E0C0A' : '#F1ECE3';
  g.font = `700 190px ${DISPLAY}`;
  g.fillText(`#${String(n).slice(-3)}`, 26, 330);
  g.font = `500 40px ${MONO}`;
  g.globalAlpha = 0.7;
  g.fillText(`0x${fakeHash(n, 8)}`, 40, 448);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

type Blk = { n: number; group: THREE.Group; mats: THREE.Material[]; tex: THREE.Texture; slot: number };

/** Isometric chain of blocks. A new block drops onto the head every block; the tail fades out. Drag to turn. */
export default function ChainMark() {
  const ref = useRef<HTMLCanvasElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const canvas = ref.current!;
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true }); } catch { setFailed(true); return; }
    if (!renderer.getContext()) { setFailed(true); return; }
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-5, 5, 3, -3, 0.1, 100);
    camera.position.set(7, 6, 7);
    camera.lookAt(0, 0, 0);

    scene.add(new THREE.AmbientLight(0xffffff, 1.6));
    const sun = new THREE.DirectionalLight(0xffe6cc, 1.6); sun.position.set(4, 8, 3); scene.add(sun);

    const world = new THREE.Group();      // drag rotation
    const chain = new THREE.Group();      // slides along x
    world.add(chain);
    scene.add(world);

    const geo = new RoundedBoxGeometry(SIZE, SIZE, SIZE, 4, 0.1);
    const edges = new THREE.EdgesGeometry(new THREE.BoxGeometry(SIZE * 1.002, SIZE * 1.002, SIZE * 1.002));
    const linkGeo = new THREE.CylinderGeometry(0.06, 0.06, GAP - SIZE + 0.1, 12);
    linkGeo.rotateZ(Math.PI / 2);
    const linkMat = new THREE.MeshStandardMaterial({ color: 0xff3b12, roughness: 0.5 });
    const edgeMat = new THREE.LineBasicMaterial({ color: 0xff3b12, transparent: true, opacity: 0.9 });

    const blocks: Blk[] = [];

    const make = (n: number, head: boolean): Blk => {
      const tex = label(n, head);
      const side = new THREE.MeshStandardMaterial({ color: head ? 0xff3b12 : 0x1a1714, roughness: 0.55, transparent: true });
      const top = new THREE.MeshStandardMaterial({ color: head ? 0xff6a45 : 0x2a2622, roughness: 0.5, transparent: true });
      const face = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6, transparent: true });
      // +x, -x, +y, -y, +z, -z
      const mats = [face, side, top, side, face, side];
      const mesh = new THREE.Mesh(geo, mats);
      const group = new THREE.Group();
      group.add(mesh, new THREE.LineSegments(edges, edgeMat));
      const link = new THREE.Mesh(linkGeo, linkMat);
      link.position.x = -GAP / 2;
      group.add(link);
      chain.add(group);
      return { n, group, mats: [face, side, top], tex, slot: 0 };
    };
    const retint = (b: Blk, head: boolean) => {
      b.tex.dispose();
      b.tex = label(b.n, head);
      (b.mats[0] as THREE.MeshStandardMaterial).map = b.tex;
      (b.mats[0] as THREE.MeshStandardMaterial).needsUpdate = true;
      (b.mats[1] as THREE.MeshStandardMaterial).color.set(head ? 0xff3b12 : 0x1a1714);
      (b.mats[2] as THREE.MeshStandardMaterial).color.set(head ? 0xff6a45 : 0x2a2622);
    };
    const dispose = (b: Blk) => { chain.remove(b.group); b.tex.dispose(); b.mats.forEach((m) => m.dispose()); };
    const setOpacity = (b: Blk, o: number) => b.mats.forEach((m) => { m.opacity = o; });

    // seed the chain with the last KEEP blocks
    const start = currentBlock();
    for (let i = KEEP - 1; i >= 0; i--) {
      const b = make(start - i, i === 0);
      b.slot = i;
      b.group.position.x = -i * GAP;
      blocks.push(b);
    }

    const push = (n: number) => {
      const prevHead = blocks[blocks.length - 1];
      if (prevHead) retint(prevHead, false);
      const b = make(n, true);
      b.slot = 0;
      blocks.push(b);
      // everything slides back one slot
      blocks.forEach((x) => { if (x !== b) x.slot += 1; });
      blocks.forEach((x) => gsap.to(x.group.position, { x: -x.slot * GAP, duration: reduced ? 0 : 0.7, ease: 'power3.inOut' }));
      // newcomer drops in with a bounce
      if (reduced) b.group.position.set(0, 0, 0);
      else {
        b.group.position.set(0, DROP, 0);
        b.group.rotation.set(0.35, 0.5, 0);
        gsap.to(b.group.position, { y: 0, duration: 0.8, ease: 'bounce.out', delay: 0.3 });
        gsap.to(b.group.rotation, { x: 0, y: 0, duration: 0.8, ease: 'power3.out', delay: 0.35 });
      }
      // tail fades out
      while (blocks.length > KEEP + 1) {
        const old = blocks.shift()!;
        if (reduced) { dispose(old); continue; }
        const o = { v: 1 };
        gsap.to(o, { v: 0, duration: 0.6, onUpdate: () => setOpacity(old, o.v), onComplete: () => dispose(old) });
        gsap.to(old.group.position, { y: -0.4, duration: 0.6, ease: 'power2.in' });
      }
    };
    const unsub = onBlock(push);

    // drag to turn; springs back to the iso angle
    let dragging = false, lastX = 0, spin = 0, vel = 0, visible = true, raf = 0;
    const down = (e: PointerEvent) => { dragging = true; lastX = e.clientX; canvas.setPointerCapture(e.pointerId); };
    const move = (e: PointerEvent) => { if (!dragging) return; vel = (e.clientX - lastX) * 0.01; lastX = e.clientX; };
    const up = () => { dragging = false; };
    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);

    const fit = () => {
      const w = canvas.clientWidth, h = canvas.clientHeight;
      renderer.setSize(w, h, false);
      const aspect = w / Math.max(1, h);
      // everything a block can ever occupy: the tail slot that is fading, the head, the drop height
      const half = SIZE * 0.75;
      const x0 = -(KEEP - 1) * GAP - half, x1 = half;
      const y0 = -half, y1 = half + 0.25;
      const cx = ((KEEP - 1) * GAP) / 2;
      const m = new THREE.Matrix4().makeRotationY(BASE);
      camera.updateMatrixWorld();
      const view = camera.matrixWorldInverse;
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const x of [x0, x1]) for (const y of [y0, y1]) for (const z of [-half, half]) {
        const v = new THREE.Vector3(x + cx, y, z).applyMatrix4(m).applyMatrix4(view);
        minX = Math.min(minX, v.x); maxX = Math.max(maxX, v.x); minY = Math.min(minY, v.y); maxY = Math.max(maxY, v.y);
      }
      const pad = 0.08;
      let hw = (maxX - minX) / 2 + pad, hh = (maxY - minY) / 2 + pad;
      if (hw / hh > aspect) hh = hw / aspect; else hw = hh * aspect;
      const mx = (maxX + minX) / 2, my = (maxY + minY) / 2;
      camera.left = mx - hw; camera.right = mx + hw; camera.top = my + hh; camera.bottom = my - hh;
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(fit); ro.observe(canvas); fit();
    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible) { cancelAnimationFrame(raf); raf = requestAnimationFrame(loop); } });
    io.observe(canvas);

    const clock = new THREE.Clock();
    const loop = () => {
      if (!visible) return;
      const t = clock.getElapsedTime();
      if (dragging) spin += vel; else { spin += (0 - spin) * 0.06; vel *= 0.9; }
      world.rotation.y = BASE + spin + heroState.p * 0.6 + (reduced ? 0 : Math.sin(t * 0.5) * 0.04);
      chain.position.x = ((KEEP - 1) * GAP) / 2;  // centre the chain in view
      chain.position.y = reduced ? 0 : Math.sin(t * 1.1) * 0.08;
      renderer.render(scene, camera);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf); unsub(); ro.disconnect(); io.disconnect();
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
      canvas.removeEventListener('pointercancel', up);
      blocks.forEach(dispose);
      geo.dispose(); edges.dispose(); linkGeo.dispose(); linkMat.dispose(); edgeMat.dispose(); renderer.dispose();
    };
  }, []);

  return failed ? null : (
    <canvas ref={ref} className="chain-canvas" role="img" aria-label="The chain: a new block lands every two seconds. Drag to turn it." data-cursor="drag" />
  );
}
