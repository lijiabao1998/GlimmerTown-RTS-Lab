// 戰場畫面：只讀世界、不改世界（AGENTS.md 規則 2）。兩個 tick 之間用 alpha 插值，畫面 60fps、模擬 20 步／秒。
import * as THREE from 'three';
import { hash2 } from '../sim/rng.ts';
import {
  N, SUB, TER_ROAD, TER_FIELD, UK_TANK, UK_HOWITZER, UK_OBSERVER, SHELL_HE, stageOf, STAGE_RUBBLE, idx,
  SIDE_PLAYER, type Unit, type World, type SimEvent,
} from '../sim/world.ts';
import { spotted } from '../sim/step.ts';
import { buildTown, smokeSources } from './buildings.ts';
import { tankHull, tankTurret, howitzer, observer } from './unitArt.ts';
import { Pipeline, type Style } from './post.ts';

const PX = 8;                       // 地面貼圖：每格 8×8 像素
const MAX_UNITS = 64, MAX_SHELLS = 96, MAX_FX = 240, MAX_RINGS = 24;
const ELEV = Math.PI / 6;           // 鏡頭仰角 30°，水平 45°（與 2D 線、3D-lab 相同的 2:1 斜視）
const BASE_HALF_H = 9;              // zoom=1 時畫面上下各看幾格

const SIDE_COL = [new THREE.Color(0x5d6b3a), new THREE.Color(0x77756c)];      // 我方橄欖綠、敵方野戰灰
const TEAM_COL = [new THREE.Color(0x3b7fd6), new THREE.Color(0xc9452f)];      // 腳下圈：藍＝我方、紅＝敵方
const WRECK = new THREE.Color(0x24211e);

type Fx = { x: number; y: number; z: number; t0: number; life: number; s0: number; s1: number; vy: number; c0: THREE.Color; c1: THREE.Color };

function toonRamp(): THREE.DataTexture {
  const t = new THREE.DataTexture(new Uint8Array([110, 110, 110, 255, 185, 185, 185, 255, 255, 255, 255, 255]), 3, 1);
  t.magFilter = t.minFilter = THREE.NearestFilter; t.needsUpdate = true;
  return t;
}

export class BattleView {
  scene = new THREE.Scene();
  cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
  pipe = new Pipeline();
  target = new THREE.Vector3(N * 0.62, 0, N * 0.62);
  zoom = 1;
  fxOn: boolean;

  private w: World;
  private fogOn: boolean;
  private ramp = toonRamp();
  private groundTex: THREE.DataTexture;
  private groundPx: Uint8Array;
  private town: THREE.Mesh;
  private hull: THREE.InstancedMesh;
  private turret: THREE.InstancedMesh;
  private gun: THREE.InstancedMesh;
  private observerMesh: THREE.InstancedMesh;
  private discs: THREE.InstancedMesh;
  private rings: THREE.InstancedMesh;
  private shells: THREE.InstancedMesh;
  private fxMesh: THREE.InstancedMesh;
  private prevX = new Float64Array(MAX_UNITS + 1);
  private prevZ = new Float64Array(MAX_UNITS + 1);
  private yaw = new Float64Array(MAX_UNITS + 1);
  private fx: Fx[] = [];
  private fxSeq = 0;
  private wrecks: { id: number; until: number }[] = [];
  private nextSmoke = 0;
  private marker: { x: number; z: number; until: number; col: THREE.Color } | null = null;
  private tmp = new THREE.Object3D();

  constructor(w: World, fxOn: boolean, fogOn = true, observerDetails = true) {
    this.w = w; this.fxOn = fxOn; this.fogOn = fogOn;
    this.scene.background = new THREE.Color(0x3c4a3a);
    // 光：天光＋太陽。鏡頭固定不轉，太陽放在畫面左上方，光永遠從左上來（2D 線 T745 的規矩在這裡自然成立）
    this.scene.add(new THREE.HemisphereLight(0xe4ecff, 0x5b5444, 1.35));
    const sun = new THREE.DirectionalLight(0xfff1d6, 2.1);
    sun.position.set(N / 2 - 0.35 * N, 1.25 * N, N / 2 + 1.0 * N);
    sun.target.position.set(N / 2, 0, N / 2);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera as THREE.OrthographicCamera;
    sc.left = sc.bottom = -N * 0.8; sc.right = sc.top = N * 0.8; sc.near = 1; sc.far = N * 4;
    sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.03;
    this.scene.add(sun, sun.target);

    // 地面：一張四邊形＋每格 8×8 的資料貼圖（彈坑、瓦礫地直接畫進貼圖，不加繪製呼叫）
    this.groundPx = new Uint8Array(N * PX * N * PX * 4);
    this.groundTex = new THREE.DataTexture(this.groundPx, N * PX, N * PX);
    this.groundTex.magFilter = this.groundTex.minFilter = THREE.NearestFilter;
    this.groundTex.colorSpace = THREE.SRGBColorSpace;
    for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) this.paintCell(x, z);
    this.groundTex.needsUpdate = true;
    const gg = new THREE.BufferGeometry();
    gg.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, N, 0, 0, N, 0, N, 0, 0, N], 3));
    gg.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
    gg.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
    gg.setIndex([0, 3, 2, 0, 2, 1]);
    const ground = new THREE.Mesh(gg, new THREE.MeshLambertMaterial({ map: this.groundTex }));
    ground.receiveShadow = true;
    this.scene.add(ground);

    const toon = (o: THREE.MeshToonMaterialParameters = {}) => new THREE.MeshToonMaterial({ gradientMap: this.ramp, ...o });
    this.town = new THREE.Mesh(buildTown(w).geometry(), toon({ vertexColors: true }));
    this.town.castShadow = this.town.receiveShadow = true;
    this.scene.add(this.town);

    const inst = (g: THREE.BufferGeometry, mat: THREE.Material, n: number, shadow: boolean) => {
      const m = new THREE.InstancedMesh(g, mat, n);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.castShadow = shadow; m.receiveShadow = shadow; m.frustumCulled = false; m.count = 0;
      m.setColorAt(0, new THREE.Color());
      this.scene.add(m);
      return m;
    };
    this.hull = inst(tankHull(), toon({ vertexColors: true }), MAX_UNITS, true);
    this.turret = inst(tankTurret(), toon({ vertexColors: true }), MAX_UNITS, true);
    this.gun = inst(howitzer(), toon({ vertexColors: true }), MAX_UNITS, true);
    this.observerMesh = inst(observer(observerDetails), toon({ vertexColors: true }), MAX_UNITS, true);
    this.discs = inst(new THREE.CircleGeometry(0.27, 10).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial(), MAX_UNITS, false);
    this.rings = inst(new THREE.RingGeometry(0.3, 0.37, 16).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial(), MAX_RINGS, false);
    this.shells = inst(new THREE.BoxGeometry(0.07, 0.07, 0.07), new THREE.MeshBasicMaterial(), MAX_SHELLS, false);
    this.fxMesh = inst(new THREE.IcosahedronGeometry(1, 1), toon(), MAX_FX, false);
    for (const u of w.units) { this.prevX[u.id] = u.x; this.prevZ[u.id] = u.z; this.yaw[u.id] = Math.atan2(-u.aimZ, u.aimX); }
  }

  unitHeight(u: Unit): number {
    if (u.kind !== UK_OBSERVER) return 0;
    const id = this.w.occ[idx(Math.floor(u.x / SUB), Math.floor(u.z / SUB))];
    const b = id ? this.w.blds[id - 1] : null;
    return b && b.hp > 0 ? b.floors * 0.55 + 0.8 : 0;
  }

  visibleAt(x: number, z: number): boolean {
    return !this.fogOn || spotted(this.w, SIDE_PLAYER, x, z);
  }

  visibleUnit(u: Unit): boolean {
    return u.side === SIDE_PLAYER || this.visibleAt(u.x, u.z);
  }

  // ---- 地面貼圖 ----
  private paintCell(x: number, z: number) {
    const w = this.w, i = idx(x, z), ter = w.ter[i], dep = w.crater[i];
    const b = w.occ[i] ? w.blds[w.occ[i] - 1] : null, rubble = !!b && stageOf(b) === STAGE_RUBBLE;
    const W = N * PX;
    for (let py = 0; py < PX; py++) for (let px = 0; px < PX; px++) {
      const gx = x * PX + px, gz = z * PX + py, n = hash2(gx, gz, 3);
      let r: number, g: number, bl: number;
      if (ter === TER_ROAD) {
        const rut = (px === 2 || px === 5 || py === 2 || py === 5) ? -10 : 0;
        r = 132 + n * 14 + rut; g = 118 + n * 12 + rut; bl = 90 + n * 10 + rut;
      } else if (ter === TER_FIELD) {
        const row = (gx + gz) % 3 === 0 ? -16 : 0;
        r = 150 + n * 18 + row; g = 146 + n * 14 + row; bl = 74 + n * 10;
      } else {
        const tuft = n > 0.86 ? 14 : n < 0.1 ? -12 : 0;
        r = 92 + n * 16 + tuft; g = 122 + n * 18 + tuft; bl = 64 + n * 10;
      }
      if (b) { r = 112 + n * 16; g = 102 + n * 14; bl = 86 + n * 12; if (rubble) { r += 18; g += 16; bl += 14; } }
      if (dep) {
        const cx = px - 3.5, cz = py - 3.5, d = Math.hypot(cx, cz), rad = 1.6 + dep * 0.9;
        if (d < rad - 0.8) { r = 58 + n * 10; g = 48 + n * 8; bl = 38 + n * 6; }
        else if (d < rad + 0.4) { r = 150 + n * 12; g = 136 + n * 10; bl = 112 + n * 8; }
        else if (d < rad + 1.6 && n < 0.55) { r *= 0.72; g *= 0.7; bl *= 0.68; }   // 焦痕
      }
      const o = (gz * W + gx) * 4;
      this.groundPx[o] = Math.max(0, Math.min(255, r)); this.groundPx[o + 1] = Math.max(0, Math.min(255, g));
      this.groundPx[o + 2] = Math.max(0, Math.min(255, bl)); this.groundPx[o + 3] = 255;
    }
  }

  // ---- 每一步之前記下位置（插值用）；之後吃事件 ----
  snapshot() { for (const u of this.w.units) { this.prevX[u.id] = u.x; this.prevZ[u.id] = u.z; } }

  onEvents(events: SimEvent[], simT: number) {
    let townDirty = false, groundDirty = false;
    for (const e of events) {
      if (e.e === 'stage') {
        townDirty = true;
        const b = this.w.blds[e.bld - 1];
        for (let z = b.z; z < b.z + b.d; z++) for (let x = b.x; x < b.x + b.w; x++) this.paintCell(x, z);
        groundDirty = true;
        if (this.fxOn) this.burst(b.x + b.w / 2, 0.3, b.z + b.d / 2, 1.2, simT, 6, true);
      } else if (e.e === 'impact') {
        const x = e.x / SUB, z = e.z / SUB;
        if (e.kind === SHELL_HE) {
          const cx = Math.floor(x), cz = Math.floor(z);
          if (cx >= 0 && cz >= 0 && cx < N && cz < N) { this.paintCell(cx, cz); groundDirty = true; }
          if (this.fxOn) this.burst(x, 0.1, z, 0.55, simT, 5, false);
        } else if (this.fxOn) this.burst(x, e.bld ? 0.35 : 0.12, z, 0.22, simT, 2, !!e.bld);
      } else if (e.e === 'fire' && this.fxOn && this.visibleUnit(this.w.units[e.unit - 1])) {
        const u = this.w.units[e.unit - 1], a = Math.atan2(u.aimZ, u.aimX), L = u.kind === UK_TANK ? 0.44 : 0.4;
        this.spawn({ x: e.x / SUB + Math.cos(a) * L, y: u.kind === UK_TANK ? 0.2 : 0.3, z: e.z / SUB + Math.sin(a) * L, t0: simT, life: 0.12, s0: 0.07, s1: 0.12, vy: 0, c0: new THREE.Color(0xfff3b0), c1: new THREE.Color(0xffb040) });
      } else if (e.e === 'kill' && this.visibleUnit(this.w.units[e.unit - 1])) {
        this.wrecks.push({ id: e.unit, until: simT + 10 });
        const u = this.w.units[e.unit - 1];
        if (this.fxOn) this.burst(u.x / SUB, 0.2, u.z / SUB, 0.45, simT, 4, false);
      }
    }
    if (townDirty) { this.town.geometry.dispose(); this.town.geometry = buildTown(this.w).geometry(); }
    if (groundDirty) this.groundTex.needsUpdate = true;
  }

  private spawn(f: Fx) {
    if (this.fx.length >= MAX_FX) this.fx.shift();
    this.fx.push(f);
  }
  // 爆炸：一團火光＋幾朵煙；dust＝塵土色（打在建築上）
  private burst(x: number, y: number, z: number, size: number, t: number, puffs: number, dust: boolean) {
    const s = this.fxSeq++;
    this.spawn({ x, y, z, t0: t, life: 0.35, s0: size * 0.3, s1: size, vy: 0.2, c0: new THREE.Color(0xffe08a), c1: new THREE.Color(0xd0602a) });
    for (let k = 0; k < puffs; k++) {
      const a = hash2(s, k, 1) * Math.PI * 2, r = hash2(s, k, 2) * size * 0.6;
      const grey = dust ? new THREE.Color(0x9a8b74) : new THREE.Color(0x5e5a55);
      this.spawn({ x: x + Math.cos(a) * r, y: y + 0.1, z: z + Math.sin(a) * r, t0: t + 0.08 * k, life: 1.6 + hash2(s, k, 3) * 1.4, s0: size * 0.25, s1: size * (0.55 + hash2(s, k, 4) * 0.4), vy: 0.35, c0: grey, c1: new THREE.Color(0x8d8a86) });
    }
  }

  setMarker(x: number, z: number, simT: number, attack: boolean) {
    this.marker = { x, z, until: simT + 0.8, col: new THREE.Color(attack ? 0xff5a3a : 0x8cff7a) };
  }

  // ---- 每一幀 ----
  update(alpha: number, simT: number, selected: Set<number>) {
    const w = this.w, m = this.tmp;
    if (w.units.length > MAX_UNITS) console.error(`單位數 ${w.units.length} 超過渲染上限 ${MAX_UNITS}（src/render/battle.ts MAX_UNITS）`);
    let nh = 0, ng = 0, no = 0, nd = 0, nr = 0;
    for (const u of w.units) {
      if (!this.visibleUnit(u)) continue;
      const x = (this.prevX[u.id] + (u.x - this.prevX[u.id]) * alpha) / SUB;
      const z = (this.prevZ[u.id] + (u.z - this.prevZ[u.id]) * alpha) / SUB;
      const mdx = u.x - this.prevX[u.id], mdz = u.z - this.prevZ[u.id];
      if (u.alive && (mdx || mdz)) this.yaw[u.id] = Math.atan2(-mdz, mdx);
      const aim = Math.atan2(-u.aimZ, u.aimX);
      const col = u.alive ? SIDE_COL[u.side] : WRECK;
      if (u.kind === UK_TANK) {
        m.position.set(x, 0, z); m.rotation.set(0, this.yaw[u.id], u.alive ? 0 : 0.06); m.scale.setScalar(1); m.updateMatrix();
        this.hull.setMatrixAt(nh, m.matrix); this.hull.setColorAt(nh, col);
        m.rotation.set(0, u.alive ? aim : aim + 0.5, u.alive ? 0 : 0.12); m.position.set(x, u.alive ? 0 : -0.02, z); m.updateMatrix();
        this.turret.setMatrixAt(nh, m.matrix); this.turret.setColorAt(nh, col);
        nh++;
      } else if (u.kind === UK_HOWITZER) {
        m.position.set(x, 0, z); m.rotation.set(0, u.pathIdx < u.path.length ? this.yaw[u.id] + Math.PI : aim, u.alive ? 0 : 0.2); m.scale.setScalar(1); m.updateMatrix();
        this.gun.setMatrixAt(ng, m.matrix); this.gun.setColorAt(ng, col);
        ng++;
      }
      if (u.kind === UK_OBSERVER) {
        const y = this.unitHeight(u);
        m.position.set(x, y, z); m.rotation.set(0, this.yaw[u.id], u.alive ? 0 : Math.PI / 2); m.scale.setScalar(1); m.updateMatrix();
        this.observerMesh.setMatrixAt(no, m.matrix); this.observerMesh.setColorAt(no, col); no++;
      }
      if (u.alive) {
        m.position.set(x, this.unitHeight(u) + 0.012, z); m.rotation.set(0, 0, 0); m.scale.setScalar(1); m.updateMatrix();
        this.discs.setMatrixAt(nd, m.matrix); this.discs.setColorAt(nd, TEAM_COL[u.side]); nd++;
        if (selected.has(u.id) && nr < MAX_RINGS) {
          m.position.y = this.unitHeight(u) + 0.02; m.updateMatrix();
          this.rings.setMatrixAt(nr, m.matrix); this.rings.setColorAt(nr, new THREE.Color(0xffe066)); nr++;
        }
      }
    }
    if (this.marker && simT < this.marker.until && nr < MAX_RINGS) {
      const k = 1 - (this.marker.until - simT) / 0.8;
      m.position.set(this.marker.x, 0.02, this.marker.z); m.rotation.set(0, 0, 0); m.scale.setScalar(1.2 - 0.6 * k); m.updateMatrix();
      this.rings.setMatrixAt(nr, m.matrix); this.rings.setColorAt(nr, this.marker.col); nr++;
    }
    // 砲彈：穿甲彈直線、高爆彈拋物線
    let ns = 0;
    for (const s of w.shells) {
      if (ns >= MAX_SHELLS) break;
      const p = Math.min(1, (s.t + alpha) / s.T);
      const x = (s.sx + (s.ex - s.sx) * p) / SUB, z = (s.sz + (s.ez - s.sz) * p) / SUB;
      if (s.side !== SIDE_PLAYER && !this.visibleAt(x * SUB, z * SUB)) continue;
      const d = Math.hypot(s.ex - s.sx, s.ez - s.sz) / SUB;
      const y = s.kind === SHELL_HE ? 0.3 + 4 * (d * 0.22) * p * (1 - p) : 0.2;
      m.position.set(x, y, z); m.rotation.set(0, 0, 0); m.scale.setScalar(s.kind === SHELL_HE ? 1.2 : 0.8); m.updateMatrix();
      this.shells.setMatrixAt(ns, m.matrix); this.shells.setColorAt(ns, s.kind === SHELL_HE ? new THREE.Color(0x2d2d2d) : new THREE.Color(0xffd27a)); ns++;
    }
    // 冒煙：沒屋頂的房子、剛被擊毀的車
    if (this.fxOn && simT >= this.nextSmoke) {
      this.nextSmoke = simT + 0.7;
      const k = this.fxSeq++;
      smokeSources(w).forEach(([x, y, z], j) => this.spawn({ x: x + (hash2(k, j, 5) - 0.5) * 0.4, y, z: z + (hash2(k, j, 6) - 0.5) * 0.4, t0: simT, life: 3.2, s0: 0.12, s1: 0.5, vy: 0.45, c0: new THREE.Color(0x3d3a37), c1: new THREE.Color(0x8a8784) }));
      this.wrecks = this.wrecks.filter(r => r.until > simT);
      for (const r of this.wrecks) { const u = w.units[r.id - 1]; this.spawn({ x: u.x / SUB, y: 0.2, z: u.z / SUB, t0: simT, life: 2.4, s0: 0.08, s1: 0.32, vy: 0.4, c0: new THREE.Color(0x2c2a28), c1: new THREE.Color(0x77736e) }); }
    }
    this.fx = this.fx.filter(f => simT < f.t0 + f.life);
    let nf = 0;
    const c = new THREE.Color();
    for (const f of this.fx) {
      if (simT < f.t0 || !this.visibleAt(Math.floor(f.x * SUB), Math.floor(f.z * SUB))) continue;
      const k = (simT - f.t0) / f.life, s = f.s0 + (f.s1 - f.s0) * Math.sqrt(k), shrink = k > 0.75 ? 1 - (k - 0.75) * 4 : 1;
      m.position.set(f.x, f.y + f.vy * (simT - f.t0), f.z); m.rotation.set(0, 0, 0); m.scale.setScalar(Math.max(0.001, s * shrink)); m.updateMatrix();
      this.fxMesh.setMatrixAt(nf, m.matrix); this.fxMesh.setColorAt(nf, c.copy(f.c0).lerp(f.c1, k)); nf++;
    }
    const fin = (mesh: THREE.InstancedMesh, n: number) => {
      mesh.count = n; mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    };
    fin(this.observerMesh, no); fin(this.hull, nh); fin(this.turret, nh); fin(this.gun, ng); fin(this.discs, nd); fin(this.rings, nr); fin(this.shells, ns); fin(this.fxMesh, nf);
  }

  // ---- 鏡頭 ----
  layout(cssW: number, cssH: number) {
    const aspect = cssW / Math.max(1, cssH), hh = BASE_HALF_H / this.zoom;
    this.cam.left = -hh * aspect; this.cam.right = hh * aspect; this.cam.top = hh; this.cam.bottom = -hh;
    const D = 60, dir = new THREE.Vector3(Math.cos(ELEV) * Math.SQRT1_2, Math.sin(ELEV), Math.cos(ELEV) * Math.SQRT1_2);
    this.cam.position.copy(this.target).addScaledVector(dir, D);
    this.cam.lookAt(this.target);
    this.cam.updateProjectionMatrix();
    this.cam.updateMatrixWorld();
  }
  // 拖曳平移：螢幕上的位移（CSS 像素）換成地面上的位移
  pan(dxCss: number, dyCss: number, cssH: number) {
    const wpp = (2 * BASE_HALF_H / this.zoom) / cssH;   // 每個 CSS 像素幾格（垂直方向）
    const right = new THREE.Vector3(1, 0, -1).normalize(), fwd = new THREE.Vector3(-1, 0, -1).normalize();
    this.target.addScaledVector(right, -dxCss * wpp).addScaledVector(fwd, dyCss * wpp / Math.sin(ELEV));
    this.target.x = Math.max(0, Math.min(N, this.target.x)); this.target.z = Math.max(0, Math.min(N, this.target.z));
  }
  zoomBy(f: number) { this.zoom = Math.max(0.55, Math.min(3, this.zoom * f)); }

  // 螢幕點 → 點到的建築格（先打建築的網格：點屋頂、牆面都算那棟；瓦礫不算）
  buildingAt(cssX: number, cssY: number, cssW: number, cssH: number): [number, number] | null {
    this.layout(cssW, cssH);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2((cssX / cssW) * 2 - 1, -(cssY / cssH) * 2 + 1), this.cam);
    for (const hit of ray.intersectObject(this.town, false)) {
      // 沿著視線往內推一點再取格，避免剛好落在牆面外緣的格線上
      const p = hit.point.clone().addScaledVector(ray.ray.direction, 0.02);
      const x = Math.floor(p.x), z = Math.floor(p.z);
      if (x < 0 || z < 0 || x >= N || z >= N) continue;
      const id = this.w.occ[idx(x, z)];
      if (id && this.w.blds[id - 1].hp > 0) return [x, z];
    }
    return null;
  }

  // 螢幕點 → 地面座標（格）
  groundAt(cssX: number, cssY: number, cssW: number, cssH: number): THREE.Vector3 | null {
    this.layout(cssW, cssH);   // 鏡頭只在 render() 裡排，焦點或世界剛換過時先排一次
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2((cssX / cssW) * 2 - 1, -(cssY / cssH) * 2 + 1), this.cam);
    const p = new THREE.Vector3();
    return ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), p) ? p : null;
  }
  // 世界座標（格）→ 螢幕 CSS 像素
  screenOf(x: number, y: number, z: number, cssW: number, cssH: number): [number, number] {
    this.layout(cssW, cssH);
    const v = new THREE.Vector3(x, y, z).project(this.cam);
    return [(v.x + 1) / 2 * cssW, (1 - v.y) / 2 * cssH];
  }

  render(renderer: THREE.WebGLRenderer, style: Style, cssW: number, cssH: number, dpr: number) {
    this.layout(cssW, cssH);
    this.pipe.render(renderer, this.scene, this.cam, style, cssW, cssH, dpr);
  }

  // 換世界（重開、跑腳本）時釋放 GPU 資源
  dispose() {
    this.scene.traverse(o => {
      // 燈要 dispose 才會放掉 2048² 的陰影貼圖；實例化網格要 dispose 才會放掉實例緩衝
      if ((o as THREE.Light).isLight || (o as THREE.InstancedMesh).isInstancedMesh) (o as THREE.Light | THREE.InstancedMesh).dispose();
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach(x => x.dispose()); else mat?.dispose();
    });
    this.groundTex.dispose(); this.ramp.dispose(); this.pipe.dispose();
    this.scene.clear();
  }

  // 守衛用：場景裡的建築三角形數
  get townTriangles() { return this.town.geometry.attributes.position.count / 3; }
}

