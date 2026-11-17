import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { Deck, GameState, TokenId } from '../engine/types';
import { isOwnable } from '../engine/managers';
import { S, TOP_Y, buildingSpot, tileAt, tileGeom, tokenSpot } from './layout';
import {
  DIE_FACES, DIE_NORMALS, coinsFor, makeCardStack, makeCashBundle, makeCoin, makeCoinStack, makeDie, makeHotel, makeHouse, makeToken, makeVault,
} from './models';
import { boardTexture, cardBack, woodTexture } from './textures';

export type Quality = 'low' | 'medium' | 'high';
type Job = { t0: number; dur: number; fn: (t: number) => void; done: () => void };

export const ease = {
  outCubic: (t: number) => 1 - (1 - t) ** 3,
  inOut: (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2),
  outBack: (t: number) => { const c = 1.9; return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2; },
};

export class BoardScene {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  speed = 1;
  follow = true;
  idleSpin = false;
  onTileClick: (i: number) => void = () => {};
  onStep: () => void = () => {};

  private jobs: Job[] = [];
  private tokens = new Map<string, THREE.Group>();
  private tokenMeta = new Map<string, { inJail: boolean; pos: number }>();
  private buildings = new Map<number, THREE.Group>();
  private ownerPlates = new Map<number, THREE.Mesh>();
  private dice: THREE.Mesh[] = [];
  private vault!: THREE.Group;
  private pot!: THREE.Group;
  private highlight!: THREE.Mesh;
  private ring!: THREE.Mesh;
  private activeId: string | null = null;
  private camGoal = new THREE.Vector3();
  private sun!: THREE.DirectionalLight;
  private raycaster = new THREE.Raycaster();
  private boardTop!: THREE.Mesh;
  private colors = new Map<string, string>();

  constructor(private host: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    host.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(38, 1, 0.1, 200);
    this.camera.position.set(0, 13.5, 13.5);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 5;
    this.controls.maxDistance = 45;
    this.controls.maxPolarAngle = 1.32;
    this.controls.target.set(0, 0, 0.4);
    this.controls.addEventListener('start', () => { this.userCam = true; });

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.55;
    this.scene.background = new THREE.Color('#1a1410');
    this.scene.fog = new THREE.Fog('#1a1410', 28, 60);

    this.buildWorld();
    this.setQuality('high');
    this.resize();
    new ResizeObserver(() => this.resize()).observe(host);
    this.bindPointer();
    this.renderer.setAnimationLoop(t => this.frame(t));
  }
  private userCam = false;
  private fit = 1;

  /* ───────────── setup ───────────── */
  private buildWorld() {
    const sc = this.scene;
    sc.add(new THREE.HemisphereLight('#fff4e0', '#3a2a1c', 0.55));
    const sun = new THREE.DirectionalLight('#fff1dc', 2.4);
    sun.position.set(-7, 14, 8);
    sun.castShadow = true;
    sun.shadow.camera.left = -9; sun.shadow.camera.right = 9; sun.shadow.camera.top = 9; sun.shadow.camera.bottom = -9;
    sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.02;
    sc.add(sun); this.sun = sun;
    const rim = new THREE.DirectionalLight('#9cc4ff', 0.6); rim.position.set(8, 6, -9); sc.add(rim);
    const lamp = new THREE.PointLight('#ffd9a0', 30, 30, 1.6); lamp.position.set(0, 9, 0); sc.add(lamp);

    // table
    const wood = woodTexture();
    const table = new THREE.Mesh(new THREE.CircleGeometry(40, 64), new THREE.MeshStandardMaterial({ map: wood, roughness: 0.55, metalness: 0.05 }));
    table.rotation.x = -Math.PI / 2; table.receiveShadow = true; sc.add(table);

    // board base with rounded edges + printed top
    const base = new THREE.Mesh(new RoundedBoxGeometry(S + 0.5, 0.36, S + 0.5, 6, 0.16),
      new THREE.MeshPhysicalMaterial({ color: '#13233d', roughness: 0.35, clearcoat: 0.8 }));
    base.position.y = 0.0; base.castShadow = true; base.receiveShadow = true; sc.add(base);
    const top = new THREE.Mesh(new THREE.PlaneGeometry(S, S),
      new THREE.MeshPhysicalMaterial({ map: boardTexture(), roughness: 0.5, clearcoat: 0.35, clearcoatRoughness: 0.4 }));
    top.rotation.x = -Math.PI / 2; top.position.y = TOP_Y - 0.019; top.receiveShadow = true; sc.add(top);
    this.boardTop = top;
    const trim = new THREE.Mesh(new THREE.TorusGeometry(1, 1, 1, 1), new THREE.MeshBasicMaterial()); trim.visible = false;

    // bank vault + cash stacks
    this.vault = makeVault(); this.vault.position.set(0, TOP_Y, -2.7); sc.add(this.vault);
    for (const [x, z, n] of [[-1.25, -2.6, 9], [-1.6, -2.95, 6], [1.3, -2.55, 11], [1.65, -2.95, 5]] as const) {
      const st = makeCoinStack(n, n > 8 ? 500 : 100); st.position.set(x, TOP_Y, z); sc.add(st);
    }
    for (const [x, z, r] of [[-1.3, -1.95, 0.3], [1.35, -1.95, -0.2]] as const) {
      const b = makeCashBundle(); b.position.set(x, TOP_Y, z); b.rotation.y = r; sc.add(b);
    }
    // decks
    const ch = makeCardStack(cardBack('chance'), '#E76F1E'); ch.position.set(-2.6, TOP_Y, 2.3); ch.rotation.y = Math.PI / 4; sc.add(ch);
    const cm = makeCardStack(cardBack('community'), '#138A8A'); cm.position.set(2.6, TOP_Y, 2.3); cm.rotation.y = -Math.PI / 4; sc.add(cm);
    // free-parking pot
    this.pot = new THREE.Group(); const pg = tileGeom(20); this.pot.position.set(pg.cx + 0.3, TOP_Y, pg.cz + 0.3); sc.add(this.pot);
    // dice
    for (let k = 0; k < 2; k++) {
      const d = makeDie(); d.position.set(-0.4 + k * 0.8, TOP_Y + 0.25, 1.4); d.rotation.y = k * 0.5; sc.add(d); this.dice.push(d);
    }
    // hover highlight + active ring
    this.highlight = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: '#ffe27a', transparent: true, opacity: 0.28, depthWrite: false }));
    this.highlight.rotation.x = -Math.PI / 2; this.highlight.position.y = TOP_Y + 0.003; this.highlight.visible = false; sc.add(this.highlight);
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.3, 0.36, 48), new THREE.MeshBasicMaterial({ color: '#ffe27a', transparent: true, opacity: 0.9, depthWrite: false }));
    this.ring.rotation.x = -Math.PI / 2; this.ring.position.y = TOP_Y + 0.006; sc.add(this.ring);
    void trim;
  }

  setQuality(q: Quality) {
    const dpr = window.devicePixelRatio || 1;
    this.renderer.setPixelRatio(q === 'high' ? Math.min(dpr, 2) : q === 'medium' ? Math.min(dpr, 1.5) : 1);
    this.renderer.shadowMap.enabled = q !== 'low';
    this.sun.castShadow = q !== 'low';
    const size = q === 'high' ? 2048 : 1024;
    this.sun.shadow.mapSize.set(size, size);
    this.sun.shadow.map?.dispose(); (this.sun.shadow as { map: THREE.WebGLRenderTarget | null }).map = null;
    this.scene.traverse(o => { const m = (o as THREE.Mesh).material as THREE.Material | undefined; if (m) m.needsUpdate = true; });
  }

  private resize() {
    const w = this.host.clientWidth || 1, h = this.host.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // Pull back on portrait screens so the whole board fits.
    const aspect = w / h;
    this.camera.fov = aspect < 0.8 ? 50 : 38;
    this.camera.updateProjectionMatrix();
    // Pull the camera back on narrow screens so the whole board fits.
    const fit = aspect < 1 ? Math.min(2, Math.max(1, 0.74 / aspect)) : 1;
    if (fit !== this.fit) {
      this.fit = fit;
      if (!this.userCam && !this.idleSpin) {
        const dir = this.camera.position.clone().sub(this.controls.target).normalize();
        this.camera.position.copy(this.controls.target).addScaledVector(dir, 18.8 * fit);
      }
    }
  }

  private bindPointer() {
    const el = this.renderer.domElement;
    let down: { x: number; y: number } | null = null;
    const pick = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      const v = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      this.raycaster.setFromCamera(v, this.camera);
      const hit = this.raycaster.intersectObject(this.boardTop)[0];
      return hit ? tileAt(hit.point.x, hit.point.z) : null;
    };
    el.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY }; });
    el.addEventListener('pointermove', e => {
      if (e.pointerType !== 'mouse') return;
      const i = pick(e);
      this.showHighlight(i);
      el.style.cursor = i !== null ? 'pointer' : 'grab';
    });
    el.addEventListener('pointerup', e => {
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) return;
      const i = pick(e);
      if (i !== null) this.onTileClick(i);
    });
  }
  showHighlight(i: number | null) {
    if (i === null) { this.highlight.visible = false; return; }
    const g = tileGeom(i);
    this.highlight.visible = true;
    this.highlight.position.x = g.cx; this.highlight.position.z = g.cz;
    const horiz = Math.abs(g.inward[1]) > 0.5;
    this.highlight.scale.set(g.corner ? g.w : horiz ? g.w : g.d, g.corner ? g.d : horiz ? g.d : g.w, 1);
  }

  /* ───────────── animation core ───────────── */
  anim(ms: number, fn: (t: number) => void): Promise<void> {
    return new Promise(done => this.jobs.push({ t0: performance.now(), dur: Math.max(1, ms / this.speed), fn, done }));
  }
  wait(ms: number) { return this.anim(ms, () => {}); }

  private frame(now: number) {
    for (const j of [...this.jobs]) {
      const t = Math.min(1, (now - j.t0) / j.dur);
      j.fn(t);
      if (t >= 1) { this.jobs.splice(this.jobs.indexOf(j), 1); j.done(); }
    }
    // active-player ring + camera follow
    const tok = this.activeId ? this.tokens.get(this.activeId) : null;
    if (tok) {
      this.ring.visible = true;
      this.ring.position.x = tok.position.x; this.ring.position.z = tok.position.z;
      const s = 1 + Math.sin(now / 260) * 0.08; this.ring.scale.set(s, s, s);
      if (this.follow && !this.userCam) {
        this.camGoal.set(tok.position.x * 0.35, 0, tok.position.z * 0.35 + 0.4);
        this.controls.target.lerp(this.camGoal, 0.03);
      }
    } else this.ring.visible = false;
    if (this.idleSpin) {
      const a = now / 9000;
      this.camera.position.set(Math.sin(a) * 15 * this.fit, 11 * this.fit, Math.cos(a) * 15 * this.fit);
      this.controls.target.set(0, 0, 0);
    }
    const wheel = this.vault.getObjectByName('wheel');
    if (wheel) wheel.rotation.z += 0.002;
    for (const t of this.tokens.values()) { const p = t.getObjectByName('prop'); if (p) p.rotation.x += 0.4; }
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  /* ───────────── state sync ───────────── */
  /** Rebuild everything from a game state (new game or loaded save). */
  load(s: GameState) {
    for (const t of this.tokens.values()) this.scene.remove(t);
    for (const b of this.buildings.values()) this.scene.remove(b);
    for (const p of this.ownerPlates.values()) this.scene.remove(p);
    this.tokens.clear(); this.tokenMeta.clear(); this.buildings.clear(); this.ownerPlates.clear(); this.colors.clear();
    for (const p of s.players) {
      this.colors.set(p.id, p.color);
      if (p.bankrupt) continue;
      this.addToken(p.id, p.token, p.color);
      this.tokenMeta.set(p.id, { inJail: p.inJail, pos: p.position });
    }
    this.layoutTokens();
    for (const [k, ps] of Object.entries(s.props)) {
      const i = Number(k);
      if (ps.owner) this.setOwner(i, ps.owner, ps.mortgaged);
      if (ps.houses) this.setBuildings(i, ps.houses, ps.owner!, false);
    }
    this.setPot(s.pot);
    this.setActive(s.players[s.turn].id);
  }

  private addToken(id: string, token: TokenId, color: string) {
    const g = makeToken(token, color);
    this.scene.add(g); this.tokens.set(id, g);
  }
  /** Glide back to the default seat at the table. */
  resetCamera() {
    this.idleSpin = false;
    const p0 = this.camera.position.clone(), t0 = this.controls.target.clone();
    const p1 = new THREE.Vector3(0, 13.5 * this.fit, 13.5 * this.fit), t1 = new THREE.Vector3(0, 0, 0.4);
    // swing around the board rather than cutting through it
    const a0 = Math.atan2(p0.x, p0.z), r0 = Math.hypot(p0.x, p0.z);
    let da = -a0; while (da > Math.PI) da -= Math.PI * 2; while (da < -Math.PI) da += Math.PI * 2;
    return this.anim(1400, t => {
      const e = ease.inOut(t), a = a0 + da * e, r = r0 + (Math.hypot(p1.x, p1.z) - r0) * e;
      this.camera.position.set(Math.sin(a) * r, p0.y + (p1.y - p0.y) * e, Math.cos(a) * r);
      this.controls.target.lerpVectors(t0, t1, e);
    });
  }
  setActive(id: string | null) { this.activeId = id; this.userCam = false; }

  private slotFor(id: string): [number, number] {
    const meta = this.tokenMeta.get(id)!;
    const same = [...this.tokenMeta.entries()].filter(([, m]) => m.pos === meta.pos && m.inJail === meta.inJail).map(([k]) => k);
    return tokenSpot(meta.pos, same.indexOf(id), meta.inJail);
  }
  private layoutTokens() {
    for (const [id, t] of this.tokens) {
      const [x, z] = this.slotFor(id);
      t.position.set(x, TOP_Y, z);
      t.rotation.y = this.headingFor(this.tokenMeta.get(id)!.pos);
    }
  }
  private headingFor(i: number) {
    const g = tileGeom((i + 1) % 40);
    return Math.atan2(-g.along[1], g.along[0]);
  }

  tokenWorld(id: string): THREE.Vector3 {
    const t = this.tokens.get(id);
    return t ? t.position.clone().add(new THREE.Vector3(0, 0.35, 0)) : new THREE.Vector3(0, 1, 0);
  }

  async moveToken(id: string, path: number[], teleport = false, inJail = false) {
    const tok = this.tokens.get(id);
    const meta = this.tokenMeta.get(id);
    if (!tok || !meta || path.length < 2) return;
    const settleOthers = () => {
      for (const [oid, t] of this.tokens) {
        if (oid === id) continue;
        const [x, z] = this.slotFor(oid);
        const from = t.position.clone();
        this.anim(220, k => { t.position.x = from.x + (x - from.x) * k; t.position.z = from.z + (z - from.z) * k; });
      }
    };
    if (teleport) {
      meta.pos = path[path.length - 1]; meta.inJail = inJail;
      const from = tok.position.clone();
      const [x, z] = this.slotFor(id);
      await this.anim(900, k => {
        const e = ease.inOut(k);
        tok.position.set(from.x + (x - from.x) * e, TOP_Y + Math.sin(k * Math.PI) * 2.2, from.z + (z - from.z) * e);
        tok.rotation.y += 0.15;
      });
      tok.rotation.y = this.headingFor(meta.pos);
      settleOthers();
      return;
    }
    meta.inJail = false;
    for (let k = 1; k < path.length; k++) {
      meta.pos = path[k];
      const from = tok.position.clone();
      const [x, z] = this.slotFor(id);
      const heading = Math.atan2(-(z - from.z), x - from.x);
      const h0 = tok.rotation.y;
      let dh = heading - h0; while (dh > Math.PI) dh -= Math.PI * 2; while (dh < -Math.PI) dh += Math.PI * 2;
      const last = k === path.length - 1;
      await this.anim(last ? 260 : 170, t => {
        tok.position.set(from.x + (x - from.x) * t, TOP_Y + Math.sin(t * Math.PI) * 0.32, from.z + (z - from.z) * t);
        tok.rotation.y = h0 + dh * Math.min(1, t * 2);
      });
      this.onStep();
    }
    tok.rotation.y = this.headingFor(meta.pos);
    settleOthers();
    await this.anim(160, t => { const s = 1.25 * (1 + Math.sin(t * Math.PI) * 0.12); tok.scale.set(1.25, s, 1.25); });
  }

  setJail(id: string, inJail: boolean) {
    const meta = this.tokenMeta.get(id);
    if (!meta || meta.inJail === inJail) return;
    meta.inJail = inJail;
    const tok = this.tokens.get(id)!;
    const from = tok.position.clone();
    const [x, z] = this.slotFor(id);
    this.anim(400, t => { tok.position.set(from.x + (x - from.x) * t, TOP_Y + Math.sin(t * Math.PI) * 0.4, from.z + (z - from.z) * t); });
  }

  async removeToken(id: string) {
    const tok = this.tokens.get(id);
    if (!tok) return;
    await this.anim(1200, t => { tok.rotation.y += 0.25; tok.position.y = TOP_Y - t * 0.5; tok.scale.setScalar(1.25 * (1 - t)); });
    this.scene.remove(tok); this.tokens.delete(id); this.tokenMeta.delete(id);
  }

  async celebrate(id: string) {
    const tok = this.tokens.get(id);
    if (!tok) return;
    const y0 = tok.position.y;
    this.setActive(id);
    await this.anim(2400, t => { tok.position.y = y0 + Math.sin(t * Math.PI) * 1.6; tok.rotation.y += 0.12; });
  }

  /* ───────────── dice ───────────── */
  async rollDice(d1: number, d2: number) {
    const vals = [d1, d2];
    const up = new THREE.Vector3(0, 1, 0);
    const jobs = this.dice.map((die, k) => {
      const face = DIE_FACES.indexOf(vals[k]);
      const align = new THREE.Quaternion().setFromUnitVectors(DIE_NORMALS[face], up);
      const yaw = new THREE.Quaternion().setFromAxisAngle(up, Math.random() * Math.PI * 2);
      const qEnd = yaw.multiply(align);
      const qStart = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.random() * 6, Math.random() * 6, Math.random() * 6));
      const axis = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
      const spins = 4 + Math.random() * 3;
      const from = new THREE.Vector3(-3.5 + k * 0.6, TOP_Y + 2.6, 4.2 + k * 0.3);
      const to = new THREE.Vector3(-0.45 + k * 0.9 + (Math.random() - 0.5) * 0.4, TOP_Y + 0.25, 1.2 + (Math.random() - 0.5) * 0.5);
      const tmp = new THREE.Quaternion();
      return this.anim(1150 + k * 120, t => {
        const e = ease.outCubic(t);
        die.position.lerpVectors(from, to, e);
        // decaying bounces
        die.position.y = TOP_Y + 0.25 + Math.abs(Math.cos(t * Math.PI * 3.2)) * 2.3 * (1 - t) ** 2;
        tmp.setFromAxisAngle(axis, spins * Math.PI * 2 * (1 - e));
        die.quaternion.copy(qStart).premultiply(tmp).slerp(qEnd, Math.min(1, t * 1.25));
      });
    });
    await Promise.all(jobs);
  }

  /* ───────────── ownership & buildings ───────────── */
  setOwner(i: number, owner: string | null, mortgaged = false) {
    const old = this.ownerPlates.get(i);
    if (old) { this.scene.remove(old); this.ownerPlates.delete(i); }
    if (!owner || !isOwnable(i)) return;
    const g = tileGeom(i);
    const color = new THREE.Color(mortgaged ? '#777' : this.colors.get(owner) ?? '#fff');
    const plate = new THREE.Mesh(new RoundedBoxGeometry(g.w * 0.82, 0.05, 0.12, 2, 0.02),
      new THREE.MeshPhysicalMaterial({ color, emissive: color, emissiveIntensity: mortgaged ? 0 : 0.25, clearcoat: 1, transparent: mortgaged, opacity: mortgaged ? 0.55 : 1 }));
    const n = -(g.d / 2 - 0.1);
    plate.position.set(g.cx + g.inward[0] * n, TOP_Y + 0.025, g.cz + g.inward[1] * n);
    plate.rotation.y = Math.atan2(g.along[1], g.along[0]) * -1;
    plate.castShadow = true;
    this.scene.add(plate);
    this.ownerPlates.set(i, plate);
    const s0 = plate.scale.clone();
    this.anim(420, t => { const e = ease.outBack(t); plate.scale.set(s0.x * e, s0.y, s0.z * e); });
  }

  async setBuildings(i: number, houses: number, owner: string, animate = true) {
    const old = this.buildings.get(i);
    if (old) {
      if (animate) await this.anim(220, t => old.scale.setScalar(1 - t));
      this.scene.remove(old);
      this.buildings.delete(i);
    }
    if (houses <= 0) return;
    const grp = new THREE.Group();
    const color = this.colors.get(owner) ?? '#fff';
    const items: THREE.Object3D[] = [];
    if (houses === 5) {
      const h = makeHotel(color, i);
      const sp = buildingSpot(i, 4);
      h.position.set(sp.x, TOP_Y, sp.z); h.rotation.y = sp.rotY; items.push(h);
    } else for (let k = 0; k < houses; k++) {
      const h = makeHouse(color);
      const sp = buildingSpot(i, k);
      h.position.set(sp.x, TOP_Y, sp.z); h.rotation.y = sp.rotY; items.push(h);
    }
    items.forEach(o => grp.add(o));
    this.scene.add(grp);
    this.buildings.set(i, grp);
    if (!animate) return;
    // drop the newest building in from above
    const fresh = houses === 5 ? items[0] : items[items.length - 1];
    const y = fresh.position.y;
    fresh.scale.setScalar(0.01);
    await this.anim(houses === 5 ? 900 : 600, t => {
      const e = ease.outBack(t);
      fresh.scale.set(e, houses === 5 ? Math.min(1, t * 1.3) * e : e, e);
      fresh.position.y = y + (1 - ease.outCubic(t)) * 1.2;
    });
  }

  setPot(amount: number) {
    this.pot.clear();
    const n = Math.min(14, Math.ceil(amount / 50));
    if (n > 0) this.pot.add(makeCoinStack(n, 50));
  }

  /* ───────────── coins ───────────── */
  entityPos(e: string): THREE.Vector3 {
    if (e === 'bank') return this.vault.position.clone().add(new THREE.Vector3(0, 0.6, 0.5));
    if (e === 'pot') return this.pot.position.clone().add(new THREE.Vector3(0, 0.3, 0));
    return this.tokenWorld(e);
  }

  async flyCoins(from: string, to: string, amount: number) {
    const a = this.entityPos(from), b = this.entityPos(to);
    const coins = coinsFor(amount, 12);
    const flights = coins.map((v, k) => {
      const coin = makeCoin(v);
      coin.position.copy(a); coin.visible = false; this.scene.add(coin);
      const mid = a.clone().lerp(b, 0.5); mid.y += 1.6 + a.distanceTo(b) * 0.12;
      const jitter = new THREE.Vector3((Math.random() - 0.5) * 0.3, 0, (Math.random() - 0.5) * 0.3);
      return this.wait(k * 70).then(() => {
        coin.visible = true;
        return this.anim(650, t => {
          const e = ease.inOut(t);
          const p1 = a.clone().lerp(mid, e), p2 = mid.clone().lerp(b.clone().add(jitter), e);
          coin.position.copy(p1.lerp(p2, e));
          coin.rotation.x = t * Math.PI * 4; coin.rotation.z = t * Math.PI * 2;
          coin.scale.setScalar(t > 0.85 ? 1 - (t - 0.85) / 0.15 * 0.9 : 1);
        });
      }).then(() => { this.scene.remove(coin); });
    });
    await Promise.all(flights);
  }

  /* ───────────── cards ───────────── */
  async drawCard(deck: Deck) {
    const pos = new THREE.Vector3(deck === 'chance' ? -2.6 : 2.6, TOP_Y + 0.2, 2.3);
    const card = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.02, 0.95), [
      new THREE.MeshStandardMaterial({ color: '#f6f1e4' }), new THREE.MeshStandardMaterial({ color: '#f6f1e4' }),
      new THREE.MeshStandardMaterial({ map: cardBack(deck) }), new THREE.MeshStandardMaterial({ color: '#fffdf6' }),
      new THREE.MeshStandardMaterial({ color: '#f6f1e4' }), new THREE.MeshStandardMaterial({ color: '#f6f1e4' }),
    ]);
    card.position.copy(pos); card.rotation.y = deck === 'chance' ? Math.PI / 4 : -Math.PI / 4; card.castShadow = true;
    this.scene.add(card);
    const goal = this.controls.target.clone().add(new THREE.Vector3(0, 3.2, 2.2));
    const r0 = card.rotation.y;
    await this.anim(800, t => {
      const e = ease.inOut(t);
      card.position.lerpVectors(pos, goal, e);
      card.position.y += Math.sin(t * Math.PI) * 0.8;
      card.rotation.set(e * (Math.PI * 0.75), r0 * (1 - e), 0);
    });
    this.anim(500, t => { card.scale.setScalar(1 - t); }).then(() => this.scene.remove(card));
  }
}
