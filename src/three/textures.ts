import * as THREE from 'three';
import { GROUP_BY_ID, TILES } from '../engine/data/board';
import { BAND, C, S, tileGeom } from './layout';

const canvas = (w: number, h: number) => {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')!] as const;
};
const tex = (c: HTMLCanvasElement, srgb = true) => {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
};
// Deterministic pseudo-random so the board looks the same every load.
function prng(seed: number) { return () => ((seed = (seed * 16807) % 2147483647) / 2147483647); }

function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    const t = line ? `${line} ${w}` : w;
    if (ctx.measureText(t).width > maxW && line) { lines.push(line); line = w; } else line = t;
  }
  if (line) lines.push(line);
  return lines;
}

const FONT = '"Outfit", "Helvetica Neue", Arial, sans-serif';
const INK = '#1d2433';
const IVORY = '#FBF5E6';

export function boardTexture(): THREE.CanvasTexture {
  const N = 2048, k = N / S;
  const [c, ctx] = canvas(N, N);
  const r = prng(7);
  // Centre: a little park with roads, a pond and trees, like a printed city board.
  const inner = (S - 2 * C) * k, o = C * k;
  const g = ctx.createRadialGradient(N / 2, N / 2, 50, N / 2, N / 2, inner * 0.75);
  g.addColorStop(0, '#9fd27e'); g.addColorStop(1, '#5fa75a');
  ctx.fillStyle = g; ctx.fillRect(0, 0, N, N);
  // flower speckles
  for (let i = 0; i < 900; i++) {
    ctx.fillStyle = ['#ffffff55', '#f6d36b66', '#e98bb066', '#2f7a3a44'][i % 4];
    ctx.beginPath(); ctx.arc(o + r() * inner, o + r() * inner, 2 + r() * 4, 0, Math.PI * 2); ctx.fill();
  }
  // ring road
  const road = (pad: number, rad: number) => {
    ctx.beginPath(); ctx.roundRect(o + pad, o + pad, inner - pad * 2, inner - pad * 2, rad);
  };
  ctx.lineCap = 'round';
  road(80, 160); ctx.strokeStyle = '#6b6f78'; ctx.lineWidth = 64; ctx.stroke();
  road(80, 160); ctx.strokeStyle = '#8a8e97'; ctx.lineWidth = 54; ctx.stroke();
  road(80, 160); ctx.setLineDash([26, 26]); ctx.strokeStyle = '#f5f1e4'; ctx.lineWidth = 5; ctx.stroke(); ctx.setLineDash([]);
  // pond
  ctx.fillStyle = '#5cc3e8';
  ctx.beginPath(); ctx.ellipse(o + inner * 0.78, o + inner * 0.62, 120, 80, -0.4, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#ffffff88'; ctx.lineWidth = 6; ctx.stroke();
  // trees
  for (let i = 0; i < 70; i++) {
    const x = o + 140 + r() * (inner - 280), y = o + 140 + r() * (inner - 280);
    const d = Math.hypot(x - N / 2, y - N / 2);
    if (d < 360) continue;
    ctx.fillStyle = '#2f7a3a66'; ctx.beginPath(); ctx.arc(x + 6, y + 8, 22, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = ['#3f9a4a', '#4fae55', '#2e8a43'][i % 3]; ctx.beginPath(); ctx.arc(x, y, 22, 0, Math.PI * 2); ctx.fill();
  }
  // card slots
  const slot = (x: number, z: number, label: string, color: string) => {
    ctx.save(); ctx.translate((x / S + 0.5) * N, (z / S + 0.5) * N); ctx.rotate(-Math.PI / 4);
    ctx.fillStyle = color + '33'; ctx.strokeStyle = color; ctx.lineWidth = 6; ctx.setLineDash([18, 12]);
    ctx.beginPath(); ctx.roundRect(-140, -95, 280, 190, 18); ctx.fill(); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = color; ctx.font = `800 26px ${FONT}`; ctx.textAlign = 'center'; ctx.fillText(label, 0, 135);
    ctx.restore();
  };
  slot(-2.6, 2.3, 'CHANCE', '#E76F1E');
  slot(2.6, 2.3, 'COMMUNITY CHEST', '#138A8A');
  // logo plaque
  ctx.save(); ctx.translate(N / 2, N / 2 - 30);
  ctx.fillStyle = '#12355b'; ctx.strokeStyle = '#E8C268'; ctx.lineWidth = 10;
  ctx.beginPath(); ctx.roundRect(-330, -95, 660, 190, 40); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#F6D57A'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = `900 112px ${FONT}`; ctx.fillText('TYCOON', 0, -12);
  ctx.font = `700 34px ${FONT}`; ctx.fillStyle = '#ffffffcc'; ctx.fillText('T  A  B  L  E', 0, 62);
  ctx.restore();

  for (let i = 0; i < 40; i++) drawTile(ctx, i, k);
  // board outline
  ctx.strokeStyle = INK; ctx.lineWidth = 6;
  ctx.strokeRect(3, 3, N - 6, N - 6);
  ctx.strokeRect(o, o, inner, inner);
  return tex(c);
}

function drawTile(ctx: CanvasRenderingContext2D, i: number, k: number) {
  const N = S * k, t = TILES[i], g = tileGeom(i);
  const w = g.w * k, d = g.d * k;
  ctx.save();
  ctx.translate((g.cx / S + 0.5) * N, (g.cz / S + 0.5) * N);
  ctx.rotate(g.rot);
  ctx.fillStyle = IVORY;
  ctx.fillRect(-w / 2, -d / 2, w, d);
  ctx.strokeStyle = INK; ctx.lineWidth = 3; ctx.strokeRect(-w / 2, -d / 2, w, d);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = INK;
  const name = (text: string, y: number, size = 21) => {
    ctx.font = `800 ${size}px ${FONT}`;
    wrap(ctx, text.toUpperCase(), w - 16).forEach((l, j) => ctx.fillText(l, 0, y + j * (size + 3)));
  };
  const icon = (e: string, y: number, size = 64) => { ctx.font = `${size}px "Apple Color Emoji","Segoe UI Emoji",sans-serif`; ctx.fillText(e, 0, y); };
  const price = (p: number) => { ctx.font = `700 22px ${FONT}`; ctx.fillStyle = INK; ctx.fillText(`$${p}`, 0, d / 2 - 24); };
  if (g.corner) {
    ctx.rotate(Math.PI / 4 * (i === 0 || i === 20 ? -1 : 1) * 0);
    drawCorner(ctx, i, w);
  } else if (t.kind === 'property') {
    const col = GROUP_BY_ID[t.group!].color;
    ctx.fillStyle = col; ctx.fillRect(-w / 2, -d / 2, w, BAND * k);
    ctx.strokeRect(-w / 2, -d / 2, w, BAND * k);
    ctx.fillStyle = INK; name(t.name, -d / 2 + BAND * k + 34);
    // little street illustration
    ctx.fillStyle = col + '33'; ctx.beginPath(); ctx.roundRect(-w / 2 + 14, 20, w - 28, 50, 10); ctx.fill();
    price(t.price!);
  } else if (t.kind === 'railway') {
    name(t.name, -d / 2 + 34); icon('🚆', 10, 70); price(t.price!);
  } else if (t.kind === 'utility') {
    name(t.name, -d / 2 + 34); icon(i === 12 ? '⚡' : '🚰', 10, 70); price(t.price!);
  } else if (t.kind === 'chance') {
    ctx.fillStyle = '#E76F1E'; ctx.font = `900 120px ${FONT}`; ctx.fillText('?', 0, 10);
    ctx.fillStyle = INK; name('Chance', -d / 2 + 34);
  } else if (t.kind === 'community') {
    name('Community Chest', -d / 2 + 34); icon('🧰', 30, 66);
  } else if (t.kind === 'tax') {
    name(t.name, -d / 2 + 34); icon(i === 4 ? '💰' : '💎', 10, 66);
    ctx.font = `700 21px ${FONT}`; ctx.fillText(`PAY $${t.tax}`, 0, d / 2 - 24);
  }
  ctx.restore();
}

function drawCorner(ctx: CanvasRenderingContext2D, i: number, w: number) {
  ctx.save();
  ctx.rotate(-Math.PI / 4);
  ctx.textAlign = 'center'; ctx.fillStyle = INK;
  if (i === 0) {
    ctx.fillStyle = '#D7263D'; ctx.font = `900 70px ${FONT}`; ctx.fillText('START', 0, -20);
    ctx.fillStyle = INK; ctx.font = `700 22px ${FONT}`; ctx.fillText('COLLECT SALARY', 0, 30);
    ctx.fillStyle = '#D7263D';
    ctx.beginPath(); ctx.moveTo(-90, 80); ctx.lineTo(60, 80); ctx.lineTo(60, 60); ctx.lineTo(110, 95); ctx.lineTo(60, 130); ctx.lineTo(60, 110); ctx.lineTo(-90, 110); ctx.fill();
  } else if (i === 10) {
    ctx.restore(); ctx.save();
    // jail cell in the inner corner
    ctx.fillStyle = '#F08A24'; ctx.fillRect(-w * 0.1, -w / 2, w * 0.6, w * 0.6);
    ctx.strokeStyle = INK; ctx.lineWidth = 4; ctx.strokeRect(-w * 0.1, -w / 2, w * 0.6, w * 0.6);
    for (let b = 0; b < 5; b++) { ctx.fillStyle = '#2b2b2b'; ctx.fillRect(-w * 0.07 + b * w * 0.12, -w / 2 + 8, 6, w * 0.6 - 16); }
    ctx.save(); ctx.translate(w * 0.2, -w * 0.2); ctx.rotate(-Math.PI / 4);
    ctx.fillStyle = '#fff'; ctx.font = `900 44px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.strokeStyle = INK; ctx.lineWidth = 6; ctx.strokeText('JAIL', 0, 0); ctx.fillText('JAIL', 0, 0);
    ctx.restore();
    ctx.fillStyle = INK; ctx.font = `800 24px ${FONT}`; ctx.textAlign = 'center';
    ctx.save(); ctx.translate(-w * 0.32, -w * 0.05); ctx.rotate(Math.PI / 2); ctx.fillText('JUST', 0, 0); ctx.restore();
    ctx.fillText('VISITING', w * 0.1, w * 0.38);
  } else if (i === 20) {
    ctx.font = `92px "Apple Color Emoji","Segoe UI Emoji",sans-serif`; ctx.fillText('🚗', 0, 10);
    ctx.font = `900 30px ${FONT}`; ctx.fillText('FREE', 0, -70); ctx.fillText('PARKING', 0, 95);
  } else if (i === 30) {
    ctx.font = `92px "Apple Color Emoji","Segoe UI Emoji",sans-serif`; ctx.fillText('👮', 0, 10);
    ctx.font = `900 30px ${FONT}`; ctx.fillText('GO TO', 0, -70); ctx.fillText('JAIL', 0, 95);
  }
  ctx.restore();
}

export function woodTexture(): THREE.CanvasTexture {
  const [c, ctx] = canvas(1024, 1024);
  const r = prng(3);
  ctx.fillStyle = '#5a3520'; ctx.fillRect(0, 0, 1024, 1024);
  for (let plank = 0; plank < 8; plank++) {
    const y0 = plank * 128;
    const base = ['#6b3f24', '#5e3720', '#734628', '#633a22'][plank % 4];
    ctx.fillStyle = base; ctx.fillRect(0, y0, 1024, 126);
    for (let l = 0; l < 40; l++) {
      ctx.strokeStyle = `rgba(${r() > 0.5 ? '30,15,5' : '140,90,55'},${0.08 + r() * 0.15})`;
      ctx.lineWidth = 1 + r() * 2.5;
      ctx.beginPath();
      const yy = y0 + r() * 126;
      ctx.moveTo(0, yy);
      for (let x = 0; x <= 1024; x += 64) ctx.lineTo(x, yy + Math.sin(x / 90 + l) * 4 + (r() - 0.5) * 3);
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(0, y0 + 126, 1024, 2);
  }
  const t = tex(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(4, 4);
  return t;
}

export function diceFace(n: number): THREE.CanvasTexture {
  const [c, ctx] = canvas(256, 256);
  ctx.fillStyle = '#fbfaf5'; ctx.fillRect(0, 0, 256, 256);
  const pos: Record<number, [number, number][]> = {
    1: [[128, 128]], 2: [[70, 70], [186, 186]], 3: [[64, 64], [128, 128], [192, 192]],
    4: [[70, 70], [186, 70], [70, 186], [186, 186]], 5: [[64, 64], [192, 64], [128, 128], [64, 192], [192, 192]],
    6: [[70, 60], [186, 60], [70, 128], [186, 128], [70, 196], [186, 196]],
  };
  for (const [x, y] of pos[n]) {
    const g = ctx.createRadialGradient(x - 4, y - 4, 2, x, y, 24);
    g.addColorStop(0, n === 1 ? '#ff4b4b' : '#3a3a3a'); g.addColorStop(1, n === 1 ? '#a50f0f' : '#050505');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, n === 1 ? 30 : 22, 0, Math.PI * 2); ctx.fill();
  }
  return tex(c);
}

export function coinFace(label: string, tone: 'gold' | 'silver' | 'bronze'): THREE.CanvasTexture {
  const [c, ctx] = canvas(256, 256);
  const tones = { gold: ['#fff2b0', '#e2b33c', '#8c6510'], silver: ['#ffffff', '#c9ced6', '#6d737d'], bronze: ['#ffd3a8', '#c27a3e', '#6e3b14'] }[tone];
  const g = ctx.createRadialGradient(100, 90, 10, 128, 128, 140);
  g.addColorStop(0, tones[0]); g.addColorStop(0.6, tones[1]); g.addColorStop(1, tones[2]);
  ctx.fillStyle = g; ctx.fillRect(0, 0, 256, 256);
  ctx.strokeStyle = tones[2]; ctx.lineWidth = 10; ctx.beginPath(); ctx.arc(128, 128, 104, 0, Math.PI * 2); ctx.stroke();
  ctx.strokeStyle = tones[0]; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(128, 128, 96, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = tones[2]; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = `900 ${label.length > 2 ? 78 : 100}px ${FONT}`; ctx.fillText(label, 128, 134);
  return tex(c);
}

export function towerWindows(seed: number): THREE.CanvasTexture {
  const [c, ctx] = canvas(128, 256);
  const r = prng(seed + 11);
  ctx.fillStyle = '#20232e'; ctx.fillRect(0, 0, 128, 256);
  const pal = ['#5ee6d0', '#ffd65c', '#a77bff', '#ff7bb4', '#7fc8ff', '#b6f07a'];
  for (let y = 0; y < 16; y++) for (let x = 0; x < 6; x++) {
    ctx.fillStyle = r() < 0.18 ? '#2d3242' : pal[Math.floor(r() * pal.length)];
    ctx.fillRect(6 + x * 20, 6 + y * 15.6, 14, 10);
  }
  return tex(c);
}

export function brickTexture(door: boolean): THREE.CanvasTexture {
  const [c, ctx] = canvas(128, 128);
  ctx.fillStyle = '#b5482f'; ctx.fillRect(0, 0, 128, 128);
  ctx.strokeStyle = '#8a3220'; ctx.lineWidth = 1.5;
  for (let y = 0; y < 128; y += 8) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(128, y); ctx.stroke();
    for (let x = (y / 8) % 2 ? 0 : 8; x < 128; x += 16) { ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + 8); ctx.stroke(); }
  }
  const win = (x: number, y: number) => {
    ctx.fillStyle = '#f4efe3'; ctx.fillRect(x - 3, y - 3, 26, 34);
    ctx.fillStyle = '#3f6f8f'; ctx.fillRect(x, y, 20, 28);
    ctx.fillStyle = '#f4efe3'; ctx.fillRect(x + 9, y, 2, 28); ctx.fillRect(x, y + 13, 20, 2);
  };
  win(18, 16); win(90, 16);
  if (door) {
    ctx.fillStyle = '#f4efe3'; ctx.fillRect(48, 70, 32, 58);
    ctx.fillStyle = '#3b2a20'; ctx.fillRect(52, 74, 24, 54);
    ctx.fillStyle = '#e8c268'; ctx.fillRect(70, 100, 3, 3);
    win(54, 16);
  } else { win(18, 76); win(90, 76); win(54, 46); }
  return tex(c);
}

export function cardBack(deck: 'chance' | 'community'): THREE.CanvasTexture {
  const [c, ctx] = canvas(384, 256);
  const col = deck === 'chance' ? '#E76F1E' : '#138A8A';
  ctx.fillStyle = col; ctx.fillRect(0, 0, 384, 256);
  ctx.strokeStyle = '#ffffffcc'; ctx.lineWidth = 8; ctx.strokeRect(14, 14, 356, 228);
  ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  if (deck === 'chance') { ctx.font = `900 130px ${FONT}`; ctx.fillText('?', 192, 110); ctx.font = `800 34px ${FONT}`; ctx.fillText('CHANCE', 192, 205); }
  else { ctx.font = `800 40px ${FONT}`; ctx.fillText('COMMUNITY', 192, 105); ctx.fillText('CHEST', 192, 155); }
  return tex(c);
}

export function labelTexture(text: string, bg: string, fg = '#fff'): THREE.CanvasTexture {
  const [c, ctx] = canvas(256, 96);
  ctx.fillStyle = bg; ctx.beginPath(); ctx.roundRect(4, 4, 248, 88, 20); ctx.fill();
  ctx.fillStyle = fg; ctx.font = `900 50px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(text, 128, 52);
  return tex(c);
}
