import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { TokenId } from '../engine/types';
import { brickTexture, coinFace, diceFace, labelTexture, towerWindows } from './textures';

// "Plastic toy" finish like printed board-game pieces.
const plastic = (color: THREE.ColorRepresentation, extra: Partial<THREE.MeshPhysicalMaterialParameters> = {}) =>
  new THREE.MeshPhysicalMaterial({ color, roughness: 0.42, metalness: 0, clearcoat: 0.6, clearcoatRoughness: 0.35, ...extra });
const metal = (color: THREE.ColorRepresentation, rough = 0.22) => new THREE.MeshStandardMaterial({ color, metalness: 1, roughness: rough });

const mesh = (g: THREE.BufferGeometry, m: THREE.Material | THREE.Material[], x = 0, y = 0, z = 0) => {
  const o = new THREE.Mesh(g, m);
  o.position.set(x, y, z);
  o.castShadow = true; o.receiveShadow = true;
  return o;
};
const rbox = (w: number, h: number, d: number, r = 0.012) => new RoundedBoxGeometry(w, h, d, 3, Math.min(r, w / 2.1, h / 2.1, d / 2.1));

/* ───────────── Houses & hotels ───────────── */
let brickSide: THREE.Texture, brickFront: THREE.Texture;
export function makeHouse(ownerColor: string): THREE.Group {
  brickSide ??= brickTexture(false);
  brickFront ??= brickTexture(true);
  const g = new THREE.Group();
  const side = plastic('#ffffff', { map: brickSide });
  const front = plastic('#ffffff', { map: brickFront });
  const slate = plastic('#4a4350', { roughness: 0.55 });
  g.add(mesh(rbox(0.19, 0.025, 0.17, 0.006), plastic('#3a3140'), 0, 0.0125, 0));
  // body: [+x, -x, +y, -y, +z(front), -z]
  g.add(mesh(new THREE.BoxGeometry(0.16, 0.13, 0.14), [side, side, slate, slate, front, side], 0, 0.09, 0));
  // mansard roof (square frustum)
  const roof = mesh(new THREE.CylinderGeometry(0.075, 0.118, 0.08, 4, 1), slate, 0, 0.195, 0);
  roof.rotation.y = Math.PI / 4; roof.scale.set(1, 1, 0.88);
  g.add(roof);
  g.add(mesh(rbox(0.09, 0.012, 0.075, 0.004), plastic(ownerColor), 0, 0.24, 0)); // owner-coloured roof cap
  // dormers
  for (const x of [-0.04, 0.04]) {
    g.add(mesh(new THREE.BoxGeometry(0.03, 0.035, 0.03), plastic('#f4efe3'), x, 0.195, 0.062));
    g.add(mesh(new THREE.BoxGeometry(0.018, 0.022, 0.005), plastic('#3f6f8f'), x, 0.195, 0.078));
  }
  g.add(mesh(new THREE.BoxGeometry(0.022, 0.05, 0.022), plastic('#8a3220'), 0.05, 0.25, -0.03));
  return g;
}

export function makeHotel(ownerColor: string, seed: number): THREE.Group {
  const g = new THREE.Group();
  const win = towerWindows(seed);
  const glass = new THREE.MeshPhysicalMaterial({ color: '#ffffff', map: win, emissive: '#ffffff', emissiveMap: win, emissiveIntensity: 0.55, roughness: 0.25, clearcoat: 1 });
  const cream = plastic('#f1dfae');
  g.add(mesh(rbox(0.36, 0.04, 0.27, 0.01), cream, 0, 0.02, 0));
  g.add(mesh(new THREE.BoxGeometry(0.3, 0.62, 0.22), [glass, glass, cream, cream, glass, glass], 0, 0.35, 0));
  // pilasters
  for (const x of [-0.152, 0.152]) g.add(mesh(new THREE.BoxGeometry(0.018, 0.62, 0.23), cream, x, 0.35, 0));
  g.add(mesh(rbox(0.34, 0.06, 0.26, 0.015), cream, 0, 0.69, 0));
  g.add(mesh(rbox(0.16, 0.05, 0.12, 0.012), cream, 0, 0.745, 0));
  // owner sign on the crown
  const sign = mesh(new THREE.BoxGeometry(0.2, 0.05, 0.01), plastic(ownerColor, { emissive: ownerColor, emissiveIntensity: 0.35 }), 0, 0.69, 0.133);
  g.add(sign);
  return g;
}

/* ───────────── Tokens ───────────── */
export function makeToken(id: TokenId, color: string): THREE.Group {
  const body = new THREE.MeshPhysicalMaterial({ color, metalness: 0.55, roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.1 });
  const chrome = metal('#e3e6ea', 0.12);
  const dark = plastic('#1c1d22');
  const white = plastic('#fafafa');
  const g = new THREE.Group();
  const add = (o: THREE.Object3D) => { g.add(o); return o; };
  // base disc
  add(mesh(new THREE.CylinderGeometry(0.2, 0.22, 0.05, 40), chrome, 0, 0.025, 0));
  add(mesh(new THREE.TorusGeometry(0.205, 0.016, 10, 48), body, 0, 0.05, 0)).rotation.x = Math.PI / 2;
  const top = new THREE.Group(); top.position.y = 0.05; g.add(top);
  const t = (o: THREE.Object3D) => { top.add(o); return o; };
  switch (id) {
    case 'car': {
      t(mesh(rbox(0.36, 0.08, 0.17, 0.03), body, 0, 0.08, 0));
      t(mesh(rbox(0.16, 0.07, 0.14, 0.03), body, -0.02, 0.15, 0));
      t(mesh(rbox(0.12, 0.055, 0.15, 0.02), new THREE.MeshPhysicalMaterial({ color: '#9fd3ff', roughness: 0.05, transmission: 0.2, metalness: 0.3 }), -0.02, 0.152, 0));
      t(mesh(new THREE.BoxGeometry(0.03, 0.06, 0.2), body, -0.18, 0.13, 0));
      for (const [x, z] of [[0.11, 0.09], [-0.11, 0.09], [0.11, -0.09], [-0.11, -0.09]]) {
        const w = t(mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.035, 20), dark, x, 0.05, z)); w.rotation.x = Math.PI / 2;
        const h = t(mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.037, 12), chrome, x, 0.05, z)); h.rotation.x = Math.PI / 2;
      }
      break;
    }
    case 'ship': {
      const shape = new THREE.Shape();
      shape.moveTo(-0.17, 0.0); shape.lineTo(0.13, 0); shape.lineTo(0.2, 0.08); shape.lineTo(-0.2, 0.08); shape.closePath();
      const hull = t(mesh(new THREE.ExtrudeGeometry(shape, { depth: 0.14, bevelEnabled: true, bevelSize: 0.01, bevelThickness: 0.01, bevelSegments: 2 }), body, 0, 0.02, -0.07));
      hull.castShadow = true;
      t(mesh(rbox(0.22, 0.06, 0.11, 0.015), white, -0.02, 0.14, 0));
      t(mesh(rbox(0.12, 0.05, 0.09, 0.012), white, -0.03, 0.195, 0));
      for (const x of [-0.06, 0.03]) {
        t(mesh(new THREE.CylinderGeometry(0.022, 0.026, 0.09, 16), body, x, 0.26, 0));
        t(mesh(new THREE.CylinderGeometry(0.024, 0.024, 0.015, 16), dark, x, 0.3, 0));
      }
      break;
    }
    case 'cat': case 'dog': {
      const cat = id === 'cat';
      t(mesh(new THREE.SphereGeometry(0.1, 24, 16), body, 0, 0.11, 0)).scale.set(1.25, 0.95, 0.9);
      t(mesh(new THREE.SphereGeometry(0.075, 24, 16), body, 0.1, 0.23, 0));
      if (cat) {
        for (const z of [-0.04, 0.04]) t(mesh(new THREE.ConeGeometry(0.025, 0.06, 12), body, 0.1, 0.31, z));
        const tail = t(mesh(new THREE.TorusGeometry(0.07, 0.014, 8, 20, Math.PI), body, -0.12, 0.17, 0)); tail.rotation.z = Math.PI / 2;
      } else {
        for (const z of [-0.06, 0.06]) { const e = t(mesh(new THREE.SphereGeometry(0.03, 12, 10), dark, 0.09, 0.24, z)); e.scale.set(0.6, 1.4, 0.5); }
        t(mesh(new THREE.SphereGeometry(0.035, 16, 12), body, 0.17, 0.21, 0)).scale.set(1.2, 0.8, 0.9);
        t(mesh(new THREE.SphereGeometry(0.014, 10, 8), dark, 0.205, 0.22, 0));
        const tail = t(mesh(new THREE.CylinderGeometry(0.012, 0.016, 0.09, 8), body, -0.14, 0.18, 0)); tail.rotation.z = 0.8;
      }
      for (const z of [-0.025, 0.025]) t(mesh(new THREE.SphereGeometry(0.011, 10, 8), dark, 0.165, 0.245, z));
      for (const [x, z] of [[0.07, 0.05], [0.07, -0.05], [-0.07, 0.05], [-0.07, -0.05]]) t(mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.06, 10), body, x, 0.03, z));
      break;
    }
    case 'rocket': {
      t(mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.24, 24), white, 0, 0.17, 0));
      t(mesh(new THREE.ConeGeometry(0.06, 0.11, 24), body, 0, 0.345, 0));
      t(mesh(new THREE.TorusGeometry(0.03, 0.01, 8, 20), chrome, 0.06, 0.22, 0)).rotation.y = Math.PI / 2;
      t(mesh(new THREE.CylinderGeometry(0.024, 0.024, 0.01, 20), new THREE.MeshPhysicalMaterial({ color: '#7fd3ff', roughness: 0.05 }), 0.063, 0.22, 0)).rotation.z = Math.PI / 2;
      for (let k = 0; k < 3; k++) {
        const fin = new THREE.BoxGeometry(0.012, 0.09, 0.07); fin.translate(0, 0, 0.08);
        t(mesh(fin, body, 0, 0.08, 0)).rotation.y = (k / 3) * Math.PI * 2;
      }
      t(mesh(new THREE.ConeGeometry(0.04, 0.05, 16), metal('#ffb347', 0.4), 0, 0.04, 0)).rotation.x = Math.PI;
      break;
    }
    case 'crown': {
      const gold = metal('#f0c64a', 0.2);
      t(mesh(new THREE.CylinderGeometry(0.13, 0.12, 0.09, 32, 1, true), gold, 0, 0.065, 0));
      t(mesh(new THREE.TorusGeometry(0.125, 0.015, 10, 40), gold, 0, 0.02, 0)).rotation.x = Math.PI / 2;
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2;
        t(mesh(new THREE.ConeGeometry(0.03, 0.1, 12), gold, Math.cos(a) * 0.12, 0.16, Math.sin(a) * 0.12));
        t(mesh(new THREE.SphereGeometry(0.016, 12, 10), gold, Math.cos(a) * 0.12, 0.215, Math.sin(a) * 0.12));
        t(mesh(new THREE.SphereGeometry(0.018, 12, 10), new THREE.MeshPhysicalMaterial({ color, roughness: 0.05, clearcoat: 1, metalness: 0.2 }), Math.cos(a + 0.5) * 0.128, 0.07, Math.sin(a + 0.5) * 0.128));
      }
      t(mesh(new THREE.SphereGeometry(0.1, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), body, 0, 0.08, 0));
      break;
    }
    case 'plane': {
      const fus = t(mesh(new THREE.CapsuleGeometry(0.04, 0.26, 8, 16), body, 0, 0.12, 0)); fus.rotation.z = Math.PI / 2;
      t(mesh(rbox(0.09, 0.012, 0.36, 0.005), white, 0.02, 0.12, 0));
      t(mesh(rbox(0.05, 0.01, 0.14, 0.004), white, -0.15, 0.13, 0));
      t(mesh(rbox(0.05, 0.08, 0.01, 0.004), body, -0.15, 0.17, 0));
      t(mesh(new THREE.CylinderGeometry(0.008, 0.03, 0.06, 12), dark, 0.03, 0.05, 0));
      const prop = t(mesh(new THREE.BoxGeometry(0.005, 0.12, 0.016), dark, 0.18, 0.12, 0));
      prop.name = 'prop';
      break;
    }
    case 'robot': {
      t(mesh(rbox(0.16, 0.14, 0.12, 0.02), body, 0, 0.12, 0));
      t(mesh(rbox(0.12, 0.09, 0.1, 0.02), chrome, 0, 0.25, 0));
      for (const z of [-0.025, 0.025]) t(mesh(new THREE.SphereGeometry(0.014, 12, 10), new THREE.MeshStandardMaterial({ color: '#7ff', emissive: '#3ff', emissiveIntensity: 1.5 }), 0.06, 0.26, z));
      t(mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.06, 8), chrome, 0, 0.325, 0));
      t(mesh(new THREE.SphereGeometry(0.015, 12, 10), body, 0, 0.36, 0));
      for (const z of [-0.095, 0.095]) t(mesh(rbox(0.04, 0.11, 0.03, 0.01), chrome, 0, 0.12, z));
      for (const z of [-0.035, 0.035]) t(mesh(rbox(0.05, 0.05, 0.045, 0.01), dark, 0, 0.025, z));
      break;
    }
  }
  g.scale.setScalar(1.25);
  return g;
}

/* ───────────── Dice ───────────── */
// Face order for BoxGeometry groups: +x, -x, +y, -y, +z, -z  (opposite faces sum to 7)
export const DIE_FACES = [1, 6, 2, 5, 3, 4];
export const DIE_NORMALS = [
  new THREE.Vector3(1, 0, 0), new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 1, 0),
  new THREE.Vector3(0, -1, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, -1),
];
export function makeDie(): THREE.Mesh {
  const mats = DIE_FACES.map(n => new THREE.MeshPhysicalMaterial({ map: diceFace(n), roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.15 }));
  return mesh(new RoundedBoxGeometry(0.5, 0.5, 0.5, 4, 0.07), mats);
}

/* ───────────── Coins & cash ───────────── */
export const DENOMS = [500, 100, 50, 20, 10, 5, 1];
const coinCache = new Map<number, THREE.Material[]>();
export function coinSpec(v: number) {
  const tone: 'gold' | 'silver' | 'bronze' = v >= 100 ? 'gold' : v >= 20 ? 'silver' : 'bronze';
  const r = v >= 500 ? 0.17 : v >= 100 ? 0.15 : v >= 20 ? 0.135 : 0.12;
  return { tone, r };
}
export function makeCoin(v: number): THREE.Mesh {
  const { tone, r } = coinSpec(v);
  if (!coinCache.has(v)) {
    const face = coinFace(v >= 500 ? '500' : String(v), tone);
    const col = { gold: '#e2b33c', silver: '#c9ced6', bronze: '#c27a3e' }[tone];
    const edge = new THREE.MeshStandardMaterial({ color: col, metalness: 1, roughness: 0.35 });
    const top = new THREE.MeshStandardMaterial({ map: face, metalness: 0.85, roughness: 0.28 });
    coinCache.set(v, [edge, top, top]);
  }
  return mesh(new THREE.CylinderGeometry(r, r, 0.045, 36), coinCache.get(v)!);
}
export function coinsFor(amount: number, cap = 14): number[] {
  const out: number[] = [];
  let left = amount;
  for (const d of DENOMS) while (left >= d && out.length < cap) { out.push(d); left -= d; }
  return out.length ? out : [1];
}

export function makeCashBundle(): THREE.Group {
  const g = new THREE.Group();
  const bill = plastic('#7bb36b', { roughness: 0.8, clearcoat: 0 });
  for (let k = 0; k < 6; k++) {
    const b = mesh(new THREE.BoxGeometry(0.42, 0.03, 0.2), bill, (Math.random() - 0.5) * 0.02, 0.015 + k * 0.032, (Math.random() - 0.5) * 0.02);
    b.rotation.y = (Math.random() - 0.5) * 0.08; g.add(b);
  }
  g.add(mesh(new THREE.BoxGeometry(0.08, 0.2, 0.205), plastic('#f4efe3'), 0, 0.1, 0));
  return g;
}

export function makeCoinStack(n: number, v = 100): THREE.Group {
  const g = new THREE.Group();
  for (let k = 0; k < n; k++) {
    const c = makeCoin(v);
    c.position.set((Math.random() - 0.5) * 0.015, 0.0225 + k * 0.046, (Math.random() - 0.5) * 0.015);
    c.rotation.y = Math.random() * 6;
    g.add(c);
  }
  return g;
}

/* ───────────── Bank vault ───────────── */
export function makeVault(): THREE.Group {
  const g = new THREE.Group();
  const steel = metal('#8d96a3', 0.3);
  const darkSteel = metal('#4d5560', 0.35);
  const gold = metal('#e8c268', 0.2);
  g.add(mesh(rbox(1.3, 1.0, 0.8, 0.08), steel, 0, 0.5, 0));
  g.add(mesh(rbox(1.36, 0.08, 0.86, 0.03), darkSteel, 0, 0.04, 0));
  const door = mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.08, 48), darkSteel, 0, 0.5, 0.42); door.rotation.x = Math.PI / 2; g.add(door);
  const ring = mesh(new THREE.TorusGeometry(0.36, 0.03, 12, 48), gold, 0, 0.5, 0.46); g.add(ring);
  const wheel = new THREE.Group(); wheel.position.set(0, 0.5, 0.48); wheel.name = 'wheel';
  for (let k = 0; k < 3; k++) { const s = mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.42, 10), gold); s.rotation.z = (k / 3) * Math.PI; wheel.add(s); }
  wheel.add(mesh(new THREE.SphereGeometry(0.06, 16, 12), gold));
  g.add(wheel);
  for (const x of [-0.5, 0.5]) g.add(mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.22, 12), gold, x, 0.5, 0.41));
  const plaque = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.22), new THREE.MeshStandardMaterial({ map: labelTexture('BANK', '#12355b', '#F6D57A'), metalness: 0.3, roughness: 0.4 }));
  plaque.position.set(0, 0.89, 0.405); g.add(plaque);
  return g;
}

export function makeCardStack(tex: THREE.Texture, edgeColor: string): THREE.Group {
  const g = new THREE.Group();
  const paper = plastic('#f6f1e4', { clearcoat: 0, roughness: 0.8 });
  const top = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 });
  const edge = plastic(edgeColor, { clearcoat: 0 });
  g.add(mesh(new THREE.BoxGeometry(1.4, 0.16, 0.95), [paper, paper, top, edge, paper, paper], 0, 0.08, 0));
  return g;
}
