import * as THREE from "three";

/** Procedural polished-concrete texture with speckle and expansion joints. */
export function makeConcreteTexture() {
  const size = 512;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#6d6f73";
  ctx.fillRect(0, 0, size, size);

  for (let i = 0; i < 24000; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const v = 90 + Math.random() * 70;
    ctx.fillStyle = `rgba(${v},${v},${v + 4},${0.05 + Math.random() * 0.2})`;
    ctx.fillRect(x, y, 1 + Math.random() * 2, 1 + Math.random() * 2);
  }
  // subtle blotches
  for (let i = 0; i < 60; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const r = 20 + Math.random() * 60;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, "rgba(255,255,255,0.05)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  // expansion joints
  ctx.strokeStyle = "rgba(40,42,45,0.55)";
  ctx.lineWidth = 3;
  ctx.strokeRect(0, 0, size, size);

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.repeat.set(14, 10);
  return tex;
}

/** Corrugated steel panel texture for walls. */
export function makeWallTexture() {
  const size = 256;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#9aa3ab";
  ctx.fillRect(0, 0, size, size);
  for (let x = 0; x < size; x += 16) {
    const g = ctx.createLinearGradient(x, 0, x + 16, 0);
    g.addColorStop(0, "rgba(255,255,255,0.18)");
    g.addColorStop(0.5, "rgba(0,0,0,0.12)");
    g.addColorStop(1, "rgba(255,255,255,0.10)");
    ctx.fillStyle = g;
    ctx.fillRect(x, 0, 16, size);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.repeat.set(10, 1);
  return tex;
}

/** Cardboard carton texture with tape seam. */
export function makeCartonTexture() {
  const size = 128;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#b5813f";
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 3000; i++) {
    const v = 140 + Math.random() * 60;
    ctx.fillStyle = `rgba(${v},${v * 0.75},${v * 0.45},0.25)`;
    ctx.fillRect(Math.random() * size, Math.random() * size, 2, 2);
  }
  ctx.fillStyle = "rgba(215,205,180,0.85)";
  ctx.fillRect(size / 2 - 6, 0, 12, size);
  ctx.strokeStyle = "rgba(80,55,25,0.5)";
  ctx.lineWidth = 4;
  ctx.strokeRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
