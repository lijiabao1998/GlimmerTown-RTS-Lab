// 戰場畫面：只讀世界、不改世界（AGENTS.md 規則 2）。兩個 tick 之間用 alpha 插值，畫面 60fps、模擬 20 步／秒。
import * as THREE from 'three';
import { hash2 } from '../sim/rng.ts';
import {
  SUB, cellIdx, inGrid, TER_ROAD, TER_FIELD, TER_MUD, UK_TANK, UK_HOWITZER, UK_OBSERVER, UK_INFANTRY, UK_ATGUN, UK_MORTAR, UK_LIGHT, UK_HEAVY, SHELL_HE, SHELL_AP, SHELL_SMALL, SHELL_SMOKE, stageOf, STAGE_RUBBLE, STAGE_ROOFLESS, STAGE_INTACT,
  SIDE_PLAYER, UNIT_KINDS, ORD_FIRE_AT, ORD_ATTACK, type Unit, type World, type SimEvent, type Building,
} from '../sim/world.ts';
import { spotted } from '../sim/step.ts';
import { territory } from '../sim/build.ts';
import { buildTown, smokeSources, buildingGeo, bldColors, wallHeight, wallShown, wallBounds, RUBBLE_COLORS, roofRise } from './buildings.ts';
import { Geo } from './geo.ts';
import { Pool, Ghosts, M_PUFF, M_GLOW, M_DEBRIS, M_RING, RISE_S } from './fx.ts';
import { tankHull, tankTurret, howitzer, observer, soldier } from './unitArt.ts';
import { Pipeline, type Style } from './post.ts';
import { SmokeView } from './smoke.ts';
import { MultiRangePreview } from './multiRange.ts';
import { RangePreview } from './rangePreview.ts';
import { VegetationView } from './vegetation.ts';
import { TrenchRaster } from './trenches.ts';

// R027 人行道與黑白路緣（只有手排地圖；畫面開關）
let streets27 = true;
export function setStreets(on: boolean): void { streets27 = on; }
const PX = 8;                       // 地面貼圖：每格 8×8 像素
const MAX_UNITS = 512, MAX_SHELLS = 96, MAX_FX = 240, MAX_RINGS = 24;
export const TURRET_RATE = 3;        // R008 砲塔最大轉速（弧度／秒）
const HOLE_CAP = 160;                 // R014 牆上痕跡最多幾個（滿了丟最舊的）
const C_HOLE = 0x1b1713, C_SOOT = 0x2a2521;
const DASH_CAP = 900;                 // R011 地上短線最多幾段
const DK_PATH = 0, DK_ATTACK = 1, DK_FIRE = 2, DK_END = 3, DK_CROSS = 4;
const MEN_CAP = 1600, BODY_CAP = 300;   // R021 小兵實例上限、倒下的人上限
// R023 坦克的網格縮放（輕坦克小一號、重坦克大一號；中坦克原樣）
const TANK_SCALE23: Record<number, number> = { [UK_LIGHT]: 0.8, [UK_HEAVY]: 1.18 };
// R022 砲的網格縮放（長、高、寬）：榴彈砲原樣；反戰車砲壓低放平；迫擊砲短而翹
const GUN_SCALE22: Record<number, [number, number, number]> = { [UK_HOWITZER]: [1, 1, 1], [UK_ATGUN]: [1.1, 0.58, 0.82], [UK_MORTAR]: [0.42, 0.95, 0.4] };
// 一班六個人的位置（班長前進方向的本地座標：兩排三列）
const SLOTS: [number, number][] = [[0.07, -0.15], [0.07, 0], [0.07, 0.15], [-0.11, -0.15], [-0.11, 0], [-0.11, 0.15]];
const C_BODY = [new THREE.Color(0x3c4526), new THREE.Color(0x4a4944)];
const ELEV = Math.PI / 6;           // 鏡頭仰角 30°，水平 45°（與 2D 線、3D-lab 相同的 2:1 斜視）
const BASE_HALF_H = 9;              // zoom=1 時畫面上下各看幾格

const SIDE_COL = [new THREE.Color(0x5d6b3a), new THREE.Color(0x77756c)];      // 我方橄欖綠、敵方野戰灰
const TEAM_COL = [new THREE.Color(0x3b7fd6), new THREE.Color(0xc9452f)];      // 腳下圈：藍＝我方、紅＝敵方
const WRECK = new THREE.Color(0x24211e);

// R004 效果的發射器：建築起火、冒煙、殘骸燃燒、倒塌後的揚塵。發射時間對齊在 t0＋n×every（跟畫面幀率無關）
const E_FIRE = 0, E_SMOKE = 1, E_WRECKFIRE = 2, E_WRECKSMOKE = 3, E_DUST = 4;
const E_LIFE = [1.5, 3.6, 1.5, 3.4, 2.2];            // 這種發射器的粒子最多活幾秒（跳過太舊的發射時間用）
type Emitter = { kind: number; id: number; x: number; z: number; w: number; d: number; h: number; t0: number; until: number; every: number; next: number; fog: boolean };
type Toss = { t0: number; vx: number; vz: number; spin: number; yaw: number; tilt: number };
const C_BAR_BG = new THREE.Color(0x15130f), C_BAR_HI = new THREE.Color(0x63d65a), C_BAR_MID = new THREE.Color(0xf2c23a), C_BAR_LO = new THREE.Color(0xe8402a);
const C_BLD_HI = new THREE.Color(0xdcc08a), C_BLD_LO = new THREE.Color(0xe08a3a);
const C_ARMOR_FRONT = new THREE.Color(0x63d65a), C_ARMOR_REAR = new THREE.Color(0xe8402a);
const C_WHITE = new THREE.Color(1, 1, 1), C_HE_SHELL = new THREE.Color(0x2d2d2d), C_AP_SHELL = new THREE.Color(0xffd27a), C_SEL = new THREE.Color(0xffe066);
const DIRT = [0x5a4636, 0x6b5440, 0x3e3226], STEEL = [0x3a3c3e, 0x55575a, 0x2c2a26];

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
  target = new THREE.Vector3();   // 建構時照世界大小放到 0.62 處
  zoom = 1;
  fxOn: boolean;

  private w: World;
  private readonly fresh: (world: World) => BattleView;
  private mapId: number | undefined;
  private fogOn: boolean;
  private ramp = toonRamp();
  // R042：跟地圖邊長有關的東西都照世界的 w.n 配置（sizeTo）；n 是目前配好的邊長
  private n = 0;
  private sun: THREE.DirectionalLight;
  private ground: THREE.Mesh<THREE.BufferGeometry, THREE.MeshLambertMaterial>;
  private groundTex!: THREE.DataTexture;
  private groundPx!: Uint8Array;
  private town: THREE.Mesh;
  private hull: THREE.InstancedMesh;
  private turret: THREE.InstancedMesh;
  private gun: THREE.InstancedMesh;
  private observerMesh: THREE.InstancedMesh;
  private men: THREE.InstancedMesh;
  // R021 倒下的人：位置、朝向、陣營（環狀覆寫最舊的）；每台步兵上一次看到的人數
  readonly bodies = { n: 0, next: 0, x: new Float32Array(BODY_CAP), z: new Float32Array(BODY_CAP), y: new Float32Array(BODY_CAP), yaw: new Float32Array(BODY_CAP), side: new Uint8Array(BODY_CAP) };
  private lastMen = new Int8Array(MAX_UNITS + 1).fill(-1);
  readonly menDbg = { alive: 0 };
  private discs: THREE.InstancedMesh;
  private rings: THREE.InstancedMesh;
  private armorArcs: THREE.InstancedMesh | null = null;
  private shells: THREE.InstancedMesh;
  private fxMesh: THREE.InstancedMesh;
  private prevX = new Float64Array(MAX_UNITS + 1);
  private prevZ = new Float64Array(MAX_UNITS + 1);
  private yaw = new Float64Array(MAX_UNITS + 1);
  private fx: Fx[] = [];
  private smoke107 = new SmokeView();
  private r107: boolean;
  private fxSeq = 0;
  private wrecks: { id: number; until: number }[] = [];
  private nextSmoke = 0;
  private marker: { x: number; z: number; until: number; col: THREE.Color } | null = null;
  private tmp = new THREE.Object3D();
  private observerHeights = new Map<number, { x: number; z: number; height: number }>();
  private territory = -1;           // R006 布陣：≥0 時地面貼圖把那一方可蓋的半場染色（不加繪製呼叫）

  // ---- R004 破壞的重量（?noR004=1 時全部不建，舊效果照舊）----
  private r4 = false;
  private puff: Pool | null = null;
  private glow: Pool | null = null;
  private debris: Pool | null = null;
  private ring: Pool | null = null;
  private ghosts: Ghosts | null = null;
  private lastStage = new Int8Array(0);
  private emitters: Emitter[] = [];
  private toss = new Map<number, Toss>();
  private shakeT0 = -99;
  private shakeAmp = 0;
  private lastT = 0;
  private frameNo = 0;
  private visStamp = new Int32Array(0);
  private visVal = new Uint8Array(0);
  private mA = new THREE.Matrix4();
  private mB = new THREE.Matrix4();

  // ---- R008 車輛有重量（?noR008=1 時全部不做）----
  private r8 = false;
  private tracks = new Uint8Array(0);       // 每個地面像素被車輪壓過幾次（0–6）
  private trackLast = new Int32Array((MAX_UNITS + 1) * 2).fill(-1);   // 每台車左右兩條車轍上一次壓到的像素
  private dirtyStamp = new Int32Array(0);
  private dirtyList = new Int32Array(0);
  private dirtyN = 0;
  private stepNo = 0;
  private recoilT0 = new Float64Array(MAX_UNITS + 1).fill(-99);
  private flashT0 = new Float64Array(MAX_UNITS + 1).fill(-99);
  private lastHp = new Int32Array(MAX_UNITS + 1);
  private turretYaw = new Float64Array(MAX_UNITS + 1);
  private turretT = -1;
  private cFlash = new THREE.Color();

  // ---- R009 血條（?noR009=1 時不畫）----
  private r9 = false;
  private barBg: THREE.InstancedMesh | null = null;
  private barFill: THREE.InstancedMesh | null = null;
  private barRight = new THREE.Vector3();
  private barQ = new THREE.Quaternion();
  private nb9 = 0;
  private nf9 = 0;
  private barHp = new Int32Array(MAX_UNITS + 1);
  private barFrom = new Float64Array(MAX_UNITS + 1);
  private barHitT = new Float64Array(MAX_UNITS + 1).fill(-99);
  private barColor = new THREE.Color();
  // 守衛用：上一幀畫了哪些血條（預配，不每幀配置）
  readonly barDbg = { n: 0, id: new Int32Array(MAX_UNITS + 64), frac: new Float32Array(MAX_UNITS + 64), ghost: new Float32Array(MAX_UNITS + 64), r: new Float32Array(MAX_UNITS + 64), g: new Float32Array(MAX_UNITS + 64) };

  // ---- R011 指令回饋（?noR011=1 時不畫）----
  private dash: THREE.InstancedMesh | null = null;
  private nd11 = 0;
  // 守衛用：上一幀畫了哪些短線（預配）
  readonly dashDbg = { n: 0, x: new Float32Array(DASH_CAP), z: new Float32Array(DASH_CAP), kind: new Uint8Array(DASH_CAP), unit: new Int32Array(DASH_CAP) };

  // ---- R014 牆上的彈孔（?noR014=1 時不畫）----
  // ---- R016 開戰時布陣的房子從地面升起（?noR016=1 時直接出現）----
  private r16 = false;
  private rising = new Map<number, number>();   // 建築 id → 升完的模擬時間
  private skipRising = (b: Building) => this.rising.has(b.id);
  private holeMesh: THREE.InstancedMesh | null = null;
  // 痕跡：環狀覆寫最舊的；kind 0＝彈孔（深色孔＋淺色碎灰泥兩片）、1＝燻黑
  readonly holes = { next: 0, live: new Uint8Array(HOLE_CAP), bld: new Int32Array(HOLE_CAP), kind: new Uint8Array(HOLE_CAP), x: new Float32Array(HOLE_CAP), y: new Float32Array(HOLE_CAP), z: new Float32Array(HOLE_CAP), nx: new Int8Array(HOLE_CAP), nz: new Int8Array(HOLE_CAP), w: new Float32Array(HOLE_CAP), h: new Float32Array(HOLE_CAP), r: new Float32Array(HOLE_CAP), g: new Float32Array(HOLE_CAP), b: new Float32Array(HOLE_CAP) };
  private holesDirty = false;
  private holeSeq = 0;
  // 每一步之前記下在飛、會打中建築的穿甲彈（彈著事件沒有射手位置）
  private apSnap = { n: 0, sx: new Float64Array(MAX_SHELLS), sz: new Float64Array(MAX_SHELLS), ex: new Float64Array(MAX_SHELLS), ez: new Float64Array(MAX_SHELLS), bld: new Int32Array(MAX_SHELLS) };

  readonly trench118: TrenchRaster;
  readonly vegetation116: VegetationView;
  get vegetationInfo(): string { return this.vegetation116.hint; }
  readonly multi122 = new MultiRangePreview();
  multiRangeEnabled = true;
  readonly range113: RangePreview | null;
  get rangeInfo(): string { return this.multi122.solution.legend || this.range113?.solution.legend || ''; }

  constructor(w: World, fxOn: boolean, fogOn = true, observerDetails = true, r004 = true, r008 = true, r009 = true, r011 = true, r014 = true, r016 = true, r107 = true, r113 = true, r118 = true, r104 = true, r123 = true) {
    this.fresh = world => new BattleView(world, fxOn, fogOn, observerDetails, r004, r008, r009, r011, r014, r016, r107, r113, r118, r104, r123);
    this.w = w; this.mapId = w.map; this.fxOn = fxOn; this.fogOn = fogOn; this.r8 = r008; this.r9 = r009; this.r16 = r016; this.r107 = r107;
    this.trench118 = new TrenchRaster(r118); this.trench118.sync(w);
    this.range113 = r113 ? new RangePreview() : null;
    if (this.range113) this.scene.add(this.range113.mesh);
    this.scene.add(this.multi122.mesh);
    this.scene.background = new THREE.Color(0x3c4a3a);
    // 光：天光＋太陽。鏡頭固定不轉，太陽放在畫面左上方，光永遠從左上來（2D 線 T745 的規矩在這裡自然成立）
    this.scene.add(new THREE.HemisphereLight(0xe4ecff, 0x5b5444, 1.35));
    // 位置與陰影範圍跟著地圖大小，在 sizeTo 裡放（R042）
    const sun = this.sun = new THREE.DirectionalLight(0xfff1d6, 2.1);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.03;
    this.scene.add(sun, sun.target);

    // 地面：一張四邊形＋每格 8×8 的資料貼圖（彈坑、瓦礫地直接畫進貼圖，不加繪製呼叫）
    const ground = this.ground = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshLambertMaterial());
    ground.receiveShadow = true;
    this.target.set(w.n * 0.62, 0, w.n * 0.62);
    this.sizeTo(w.n);
    for (let z = 0; z < w.n; z++) for (let x = 0; x < w.n; x++) this.paintCell(x, z);
    this.groundTex.needsUpdate = true;
    this.scene.add(ground);

    const toon = (o: THREE.MeshToonMaterialParameters = {}) => new THREE.MeshToonMaterial({ gradientMap: this.ramp, ...o });
    this.town = new THREE.Mesh(buildTown(w).geometry(), toon({ vertexColors: true }));
    this.town.castShadow = this.town.receiveShadow = true;
    this.scene.add(this.town);
    this.vegetation116 = new VegetationView(this.scene, this.ramp);
    this.vegetation116.sync(w);

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
    this.men = inst(soldier(), toon({ vertexColors: true }), MEN_CAP, true);   // R021 步兵：活著的小兵＋倒下的人
    this.discs = inst(new THREE.CircleGeometry(0.27, 10).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial(), MAX_UNITS, false);
    this.rings = inst(new THREE.RingGeometry(0.3, 0.37, 16).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial(), MAX_RINGS, false);
    if (r104 && fxOn) this.armorArcs = inst(new THREE.RingGeometry(0.45, 0.53, 8, 1, -Math.PI / 4, Math.PI / 2).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ depthWrite: false }), MAX_RINGS * 2, false);
    if (r014) {
      const mat = toon({ polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
      this.holeMesh = inst(new THREE.PlaneGeometry(1, 1), mat, HOLE_CAP * 2, false);
      this.holeMesh.receiveShadow = true;
    }
    if (r011) {
      // 地上的短線片（加色＝在地上發亮，越淡＝顏色越暗），會被房子擋住（測深度、不寫深度）
      this.dash = inst(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, toneMapped: false }), DASH_CAP, false);
    }
    if (r009) {
      // 血條：一片從 x=0 往右長的四邊形；畫在所有東西上面（不測深度、不寫深度＝沒有描邊），朝著鏡頭
      const quad = new THREE.PlaneGeometry(1, 1).translate(0.5, 0, 0);
      const mat = (c: number) => new THREE.MeshBasicMaterial({ color: c, depthTest: false, depthWrite: false, toneMapped: false });
      // R123: preserve all backgrounds before every fill, but submit one mesh.
      // The upper fixed-capacity segment stages fills until the background count is known.
      this.barBg = inst(quad, mat(0xffffff), (r123 ? 3 : 1) * (MAX_UNITS + 64), false); this.barBg.renderOrder = 10;
      if (!r123) { this.barFill = inst(quad.clone(), mat(0xffffff), 2 * (MAX_UNITS + 64), false); this.barFill.renderOrder = 11; }
      // 鏡頭角度固定（45°／30°），血條的朝向算一次就好
      const probe = new THREE.Object3D(), dir = new THREE.Vector3(Math.cos(ELEV) * Math.SQRT1_2, Math.sin(ELEV), Math.cos(ELEV) * Math.SQRT1_2);
      probe.position.copy(dir); probe.lookAt(0, 0, 0); probe.rotateY(Math.PI);
      this.barQ.copy(probe.quaternion);
      this.barRight.set(1, 0, 0).applyQuaternion(this.barQ);
      this.r9 = true;
    }
    this.shells = inst(new THREE.BoxGeometry(0.07, 0.07, 0.07), new THREE.MeshBasicMaterial(), MAX_SHELLS, false);
    this.fxMesh = inst(new THREE.IcosahedronGeometry(1, 1), toon(), MAX_FX, false);
    for (const u of w.units) { this.prevX[u.id] = u.x; this.prevZ[u.id] = u.z; this.yaw[u.id] = Math.atan2(-u.aimZ, u.aimX); this.turretYaw[u.id] = this.yaw[u.id]; this.lastHp[u.id] = u.hp; this.barHp[u.id] = u.hp; this.barFrom[u.id] = u.hp; }
    if (fxOn && r004) {
      this.r4 = true;
      const add = () => new THREE.MeshBasicMaterial({ blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, toneMapped: false });
      this.puff = new Pool(M_PUFF, new THREE.IcosahedronGeometry(1, 1), toon(), 360, this.scene);
      this.debris = new Pool(M_DEBRIS, new THREE.BoxGeometry(1, 1, 1), toon(), 300, this.scene);
      this.ring = new Pool(M_RING, new THREE.RingGeometry(0.8, 1, 28).rotateX(-Math.PI / 2), add(), 32, this.scene);
      this.glow = new Pool(M_GLOW, new THREE.IcosahedronGeometry(1, 1), add(), 300, this.scene);
      this.ghosts = new Ghosts(toon({ vertexColors: true }), 12000, this.scene);
      this.lastStage = new Int8Array(w.blds.length + 64);
      const t = w.tick / 20;
      for (const b of w.blds) {
        this.lastStage[b.id] = stageOf(b);
        if (stageOf(b) === STAGE_ROOFLESS) {
          const bounds = wallShown(b) ? wallBounds(b) : null;
          this.addEmitter(E_SMOKE, b.id, bounds?.x0 ?? b.x, bounds?.z0 ?? b.z, bounds ? bounds.x1 - bounds.x0 : b.w, bounds ? bounds.z1 - bounds.z0 : b.d, wallHeight(b) * (bounds ? 0.72 : 1), t, Infinity, false);
        }
      }
    }
  }

  // R042：照地圖邊長 n 配置地面貼圖與四邊形、車轍、可見度快取、髒格表、光與陰影範圍。
  // 只在建構與換到不同大小的世界時配置；同大小直接返回，每幀不配置。
  private sizeTo(n: number): void {
    if (n === this.n) return;
    this.n = n;
    const W = n * PX;
    this.visStamp = new Int32Array(n * n); this.visVal = new Uint8Array(n * n);
    this.tracks = new Uint8Array(W * W); this.trackLast.fill(-1);
    this.dirtyStamp = new Int32Array(n * n); this.dirtyList = new Int32Array(n * n); this.dirtyN = 0;
    this.target.x = Math.min(n, this.target.x); this.target.z = Math.min(n, this.target.z);
    // 太陽（左上方）與陰影相機蓋住整張地圖
    const sun = this.sun, sc = sun.shadow.camera as THREE.OrthographicCamera;
    sun.position.set(n / 2 - 0.35 * n, 1.25 * n, n / 2 + 1.0 * n);
    sun.target.position.set(n / 2, 0, n / 2);
    sc.left = sc.bottom = -n * 0.8; sc.right = sc.top = n * 0.8; sc.near = 1; sc.far = n * 4;
    sc.updateProjectionMatrix();
    this.groundTex?.dispose();
    this.groundPx = new Uint8Array(W * W * 4);
    this.groundTex = new THREE.DataTexture(this.groundPx, W, W);
    this.groundTex.magFilter = this.groundTex.minFilter = THREE.NearestFilter;
    this.groundTex.colorSpace = THREE.SRGBColorSpace;
    this.ground.material.map = this.groundTex;
    const gg = new THREE.BufferGeometry();
    gg.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, n, 0, 0, n, 0, n, 0, 0, n], 3));
    gg.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
    gg.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
    gg.setIndex([0, 3, 2, 0, 2, 1]);
    this.ground.geometry.dispose(); this.ground.geometry = gg;
  }

  unitHeight(u: Unit): number {
    if (!UNIT_KINDS[u.kind].garrison) return 0;   // 觀測員、步兵可以站在屋頂上
    const id = this.w.occ[cellIdx(this.w, Math.floor(u.x / SUB), Math.floor(u.z / SUB))];
    const b = id ? this.w.blds[id - 1] : null;
    if (!b || b.hp <= 0) return 0;
    const cached = this.observerHeights.get(u.id);
    if (cached && cached.x === u.x && cached.z === u.z) return cached.height;
    // Anchor the garrison indicator to the real roof/floor surface, including damage.
    const ray = new THREE.Raycaster(new THREE.Vector3(u.x / SUB, 20, u.z / SUB), new THREE.Vector3(0, -1, 0));
    const height = ray.intersectObject(this.town, false)[0]?.point.y ?? 0;
    this.observerHeights.set(u.id, { x: u.x, z: u.z, height });
    return height;
  }

  get world(): World { return this.w; }
  // R128：重置視覺狀態時沿用同一組已解析的閥值，不另讀 URL 或複製設定規則。
  recreate(w: World): BattleView {
    const next = this.fresh(w);
    next.target.copy(this.target); next.zoom = this.zoom; next.multiRangeEnabled = this.multiRangeEnabled;
    return next;
  }
  // R006：換一個世界來畫（布陣預覽世界 ↔ 真的世界）；重畫地面貼圖與房子，單位網格不動
  // R042：大小不同的世界先照新的 w.n 重配所有跟大小有關的緩衝，不沿用舊大小
  setWorld(w: World, territorySide = -1) {
    this.w = w; this.mapId = w.map; this.territory = territorySide; this.observerHeights.clear();
    this.sizeTo(w.n);
    this.trench118.sync(w, true);
    for (let z = 0; z < w.n; z++) for (let x = 0; x < w.n; x++) this.paintCell(x, z);
    this.groundTex.needsUpdate = true;
    this.town.geometry.dispose(); this.town.geometry = buildTown(w).geometry();
    this.vegetation116.sync(w);
  }

  visibleAt(x: number, z: number): boolean {
    return !this.fogOn || spotted(this.w, SIDE_PLAYER, x, z);
  }

  visibleUnit(u: Unit): boolean {
    return u.side === SIDE_PLAYER || this.visibleAt(u.x, u.z);
  }

  // ---- 地面貼圖 ----
  private paintCell(x: number, z: number) {
    const w = this.w, i = cellIdx(w, x, z), ter = w.ter[i], dep = w.crater[i];
    const b = w.occ[i] ? w.blds[w.occ[i] - 1] : null, rubble = !!b && stageOf(b) === STAGE_RUBBLE;
    const W = this.n * PX;
    for (let py = 0; py < PX; py++) for (let px = 0; px < PX; px++) {
      const gx = x * PX + px, gz = z * PX + py, n = hash2(gx, gz, 3);
      let r: number, g: number, bl: number;
      if (ter === TER_ROAD && w.map) {   // R026 手排地圖的街道：錯縫的石板，灰縫比石頭暗
        const sx = Math.floor((gx + (Math.floor(gz / 3) % 2) * 2) / 4), sn = hash2(sx, Math.floor(gz / 3), 11);
        const joint = gz % 3 === 0 || (gx + (Math.floor(gz / 3) % 2) * 2) % 4 === 0;
        r = 126 + sn * 22 + n * 6; g = 120 + sn * 18 + n * 6; bl = 108 + sn * 14 + n * 6;
        if (joint) { r -= 30; g -= 30; bl -= 26; }
        if (streets27) {   // R027 貼著房子那一側：2 像素人行道石板＋1 像素路緣（1939–40 燈火管制：路緣漆黑白相間）
          const sides = [[-1, 0, px, py], [1, 0, PX - 1 - px, py], [0, -1, py, px], [0, 1, PX - 1 - py, px]];
          for (const [dx, dz, d, along] of sides) {
            const nx = x + dx, nz = z + dz;
            if (!inGrid(w, nx, nz) || !w.occ[cellIdx(w, nx, nz)] || d > 2) continue;
            if (d <= 1) { const j = (along + (dx ? gz : gx)) % 3 === 0; r = 170 + n * 10 - (j ? 22 : 0); g = 166 + n * 10 - (j ? 22 : 0); bl = 154 + n * 8 - (j ? 20 : 0); }
            else { const white = ((dx ? gz : gx) >> 1) % 2 === 0; r = g = bl = white ? 226 + n * 12 : 38 + n * 8; }
            break;
          }
        }
      } else if (ter === TER_ROAD) {
        const rut = (px === 2 || px === 5 || py === 2 || py === 5) ? -10 : 0;
        r = 132 + n * 14 + rut; g = 118 + n * 12 + rut; bl = 90 + n * 10 + rut;
      } else if (ter === TER_MUD) {   // R026 泥灘：濕泥上一道道水光（潮溝）
        const wet = hash2(Math.floor(gx / 3), gz, 5) > 0.55, glint = wet && n > 0.82;
        r = 74 + n * 12; g = 78 + n * 10; bl = 70 + n * 8;
        if (wet) { r = 66 + n * 10; g = 88 + n * 12; bl = 98 + n * 14; }
        if (glint) { r += 40; g += 42; bl += 40; }
      } else if (ter === TER_FIELD) {
        const row = (gx + gz) % 3 === 0 ? -16 : 0;
        r = 150 + n * 18 + row; g = 146 + n * 14 + row; bl = 74 + n * 10;
      } else {
        const tuft = n > 0.86 ? 14 : n < 0.1 ? -12 : 0;
        r = 92 + n * 16 + tuft; g = 122 + n * 18 + tuft; bl = 64 + n * 10;
      }
      const tr = this.tracks[gz * W + gx];
      if (tr) { const k = ter === TER_ROAD ? 0.95 - 0.03 * tr : 0.8 - 0.05 * tr; r = r * k + 4; g = g * k - 2; bl = bl * k - 2; }   // R008 車轍：第一次壓就看得出來，越壓越深（最多 6 次）；路上淡、草地農田深；彈坑與建築畫在上面
      if (b) { r = 112 + n * 16; g = 102 + n * 14; bl = 86 + n * 12; if (rubble) { r += 18; g += 16; bl += 14; } }
      else if (this.territory >= 0 && ter !== TER_ROAD) {
        // 布陣：我方可蓋的半場偏藍、對方半場偏紅，交界畫一條亮線；無人帶與路保持原色
        const mine = territory(this.territory, x, z, w.n), theirs = territory(1 - this.territory, x, z, w.n);
        if (mine) { r = r * 0.62 + 26; g = g * 0.72 + 44; bl = bl * 0.55 + 104; }
        else if (theirs) { r = r * 0.8 + 38; g = g * 0.8 + 6; bl = bl * 0.8 + 4; }
        const edge = mine && (!territory(this.territory, x - 1, z, w.n) && px === 0 || !territory(this.territory, x, z - 1, w.n) && py === 0
          || !territory(this.territory, x + 1, z, w.n) && px === PX - 1 || !territory(this.territory, x, z + 1, w.n) && py === PX - 1);
        if (edge) { r = 196; g = 226; bl = 255; }
      }
      if (dep) {
        const cx = px - 3.5, cz = py - 3.5, d = Math.hypot(cx, cz), rad = 1.6 + dep * 0.9;
        if (d < rad - 0.8) { r = 58 + n * 10; g = 48 + n * 8; bl = 38 + n * 6; }
        else if (d < rad + 0.4) { r = 150 + n * 12; g = 136 + n * 10; bl = 112 + n * 8; }
        else if (d < rad + 1.6 && n < 0.55) { r *= 0.72; g *= 0.7; bl *= 0.68; }   // 焦痕
      }
      const trench = !b ? this.trench118.pixel(i, px, py) : -1;
      if (trench >= 0) { r = trench >>> 16; g = (trench >>> 8) & 255; bl = trench & 255; }
      const o = (gz * W + gx) * 4;
      this.groundPx[o] = Math.max(0, Math.min(255, r)); this.groundPx[o + 1] = Math.max(0, Math.min(255, g));
      this.groundPx[o + 2] = Math.max(0, Math.min(255, bl)); this.groundPx[o + 3] = 255;
    }
  }

  // ---- 每一步之前記下位置（插值用）；之後吃事件 ----
  snapshot() {
    for (const u of this.w.units) { this.prevX[u.id] = u.x; this.prevZ[u.id] = u.z; }
    if (this.holeMesh) {   // R014：記下會打中建築的穿甲彈從哪裡打來
      const a = this.apSnap; a.n = 0;
      for (const sh of this.w.shells) if (sh.kind === SHELL_AP && sh.hitBld && a.n < MAX_SHELLS) { a.sx[a.n] = sh.sx; a.sz[a.n] = sh.sz; a.ex[a.n] = sh.ex; a.ez[a.n] = sh.ez; a.bld[a.n] = sh.hitBld; a.n++; }
    }
  }

  onEvents(events: SimEvent[], simT: number) {
    if (this.mapId !== this.w.map) this.setWorld(this.w, this.territory); // tick0 的 map 重播要同步城鎮與地面。
    if (this.n !== this.w.n) this.setWorld(this.w, this.territory);   // R042：同一個世界在 tick0 換了大小，緩衝照新的 w.n 重配
    if (this.holeMesh) this.holes14(events);
    if (this.r8) this.vehicles8(events, simT);
    if (this.r4) { this.frameNo++; for (const e of events) this.fx4(e, simT); }   // 世界剛走一步：可見度快取作廢
    let townDirty = false, groundDirty = false, vegetationDirty = false;
    const trenchEvent = events.some(e => e.e === 'trench');
    if (trenchEvent) vegetationDirty = true;   // noR118 只隱藏壕溝，仍同步模擬已清除的植被。
    if (this.trench118.sync(this.w, trenchEvent)) {
      // 只在布陣狀態改變時整圖重刻，包含新接線的舊鄰格與取消後的空格。
      for (let z = 0; z < this.n; z++) for (let x = 0; x < this.n; x++) this.paintCell(x, z);
      groundDirty = true; vegetationDirty = true;
    }
    for (const e of events) {
      if (e.e === 'wire') { townDirty = true; vegetationDirty = true; }
      else if (e.e === 'stage') {
        townDirty = true;
        const b = this.w.blds[e.bld - 1];
        for (let z = b.z; z < b.z + b.d; z++) for (let x = b.x; x < b.x + b.w; x++) this.paintCell(x, z);
        groundDirty = true;
        if (this.fxOn && !this.r4) this.burst(b.x + b.w / 2, 0.3, b.z + b.d / 2, 1.2, simT, 6, true);
      } else if (e.e === 'build') {
        townDirty = true; vegetationDirty = true;
        const b = this.w.blds[e.bld - 1];
        if (b) {
          // R027 路緣讀鄰格 occ；新房屋落地也重畫一格邊緣，與整圖重播一致。
          for (let z = Math.max(0, b.z - 1); z < Math.min(this.n, b.z + b.d + 1); z++) for (let x = Math.max(0, b.x - 1); x < Math.min(this.n, b.x + b.w + 1); x++) this.paintCell(x, z);
          groundDirty = true;
        }
      } else if (e.e === 'impact') {
        if (e.kind === SHELL_SMOKE) continue;   // R107：持續煙幕從世界重建，不冒充高爆／穿甲彈著
        const x = e.x / SUB, z = e.z / SUB;
        if (e.kind === SHELL_HE) {
          const cx = Math.floor(x), cz = Math.floor(z);
          if (inGrid(this.w, cx, cz)) { this.paintCell(cx, cz); groundDirty = true; }
          if (this.fxOn && !this.r4) this.burst(x, 0.1, z, 0.55, simT, 5, false);
        } else if (this.fxOn && !this.r4) this.burst(x, e.bld ? 0.35 : 0.12, z, 0.22, simT, 2, !!e.bld);
      } else if (e.e === 'fire' && this.fxOn && !this.r4 && this.visibleUnit(this.w.units[e.unit - 1])) {
        const u = this.w.units[e.unit - 1], a = Math.atan2(u.aimZ, u.aimX), L = UNIT_KINDS[u.kind].armored ? 0.44 * (TANK_SCALE23[u.kind] ?? 1) : 0.4;
        this.spawn({ x: e.x / SUB + Math.cos(a) * L, y: u.kind === UK_TANK ? 0.2 : 0.3, z: e.z / SUB + Math.sin(a) * L, t0: simT, life: 0.12, s0: 0.07, s1: 0.12, vy: 0, c0: new THREE.Color(0xfff3b0), c1: new THREE.Color(0xffb040) });
      } else if (e.e === 'kill' && this.visibleUnit(this.w.units[e.unit - 1])) {
        this.wrecks.push({ id: e.unit, until: simT + 10 });
        const u = this.w.units[e.unit - 1];
        if (this.fxOn && !this.r4) this.burst(u.x / SUB, 0.2, u.z / SUB, 0.45, simT, 4, false);
      }
    }
    if (townDirty) { this.observerHeights.clear(); this.town.geometry.dispose(); this.town.geometry = buildTown(this.w, this.skipRising).geometry(); }
    if (groundDirty) this.groundTex.needsUpdate = true;
    this.vegetation116.sync(this.w, vegetationDirty);
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
  update(alpha: number, simT: number, selected: Set<number>, showRanges = true) {
    const w = this.w, m = this.tmp;
    this.alpha9 = alpha; this.menDbg.alive = 0;
    if (this.r8) this.turn8(simT);
    this.lastT = simT; this.frameNo++;
    if (this.r4) { this.puff!.begin(); this.glow!.begin(); this.debris!.begin(); this.ring!.begin(); }
    if (w.units.length > MAX_UNITS) console.error(`單位數 ${w.units.length} 超過渲染上限 ${MAX_UNITS}（src/render/battle.ts MAX_UNITS）`);
    let nh = 0, ng = 0, no = 0, nd = 0, nr = 0, nm = 0, na = 0;
    for (const u of w.units) {
      if (!this.visibleUnit(u)) continue;
      const x = (this.prevX[u.id] + (u.x - this.prevX[u.id]) * alpha) / SUB;
      const z = (this.prevZ[u.id] + (u.z - this.prevZ[u.id]) * alpha) / SUB;
      const mdx = u.x - this.prevX[u.id], mdz = u.z - this.prevZ[u.id];
      if (u.hullX !== undefined && u.hullZ !== undefined) this.yaw[u.id] = Math.atan2(-u.hullZ, u.hullX);
      else if (u.alive && (mdx || mdz)) this.yaw[u.id] = Math.atan2(-mdz, mdx);
      const aim = this.r8 && u.alive ? this.turretYaw[u.id] : Math.atan2(-u.aimZ, u.aimX);
      const col = !u.alive ? WRECK : this.r8 && simT - this.flashT0[u.id] < 0.15 ? this.cFlash.copy(SIDE_COL[u.side]).lerp(C_WHITE, 0.85 * (1 - (simT - this.flashT0[u.id]) / 0.15)) : SIDE_COL[u.side];
      // R008 後座：開火後 0.3 秒內沿瞄準反方向退一下再回位（前 0.04 秒猛退，之後慢慢回）
      const rk = (simT - this.recoilT0[u.id]) / 0.3, back = this.r8 && u.alive && rk >= 0 && rk < 1 ? (rk < 0.13 ? rk / 0.13 : (1 - rk) / 0.87) ** 2 : 0;
      const bx = -Math.cos(aim) * back, bz = Math.sin(aim) * back;
      if (UNIT_KINDS[u.kind].armored) {   // R023 輕、中、重坦克共用車體與砲塔網格，只差縮放
        const ts = TANK_SCALE23[u.kind] ?? 1;
        m.position.set(x + bx * 0.03, 0, z + bz * 0.03); m.rotation.set(0, this.yaw[u.id], u.alive ? back * 0.05 : 0.06); m.scale.set(ts * (u.kind === UK_HEAVY ? 1.06 : 1), ts * (u.kind === UK_LIGHT ? 0.85 : 1), ts); m.updateMatrix();
        this.hull.setMatrixAt(nh, m.matrix); this.hull.setColorAt(nh, col);
        m.rotation.set(0, u.alive ? aim : aim + 0.5, u.alive ? 0 : 0.12); m.position.set(x + bx * 0.09, u.alive ? 0 : -0.02, z + bz * 0.09); m.scale.setScalar(ts); m.updateMatrix();
        const tossed = !u.alive && this.r4 ? this.toss.get(u.id) : undefined;
        this.turret.setMatrixAt(nh, tossed ? this.tossMatrix(tossed, x, z, simT) : m.matrix); this.turret.setColorAt(nh, col);
        nh++;
      } else if (u.kind === UK_HOWITZER || u.kind === UK_ATGUN || u.kind === UK_MORTAR) {
        // R022 反戰車砲、迫擊砲畫進同一個砲的網格：用縮放改比例（反戰車砲壓低、砲管放平；迫擊砲短、砲管翹）；不多一次繪製呼叫
        const [gx, gy, gz] = GUN_SCALE22[u.kind] ?? GUN_SCALE22[UK_HOWITZER];
        m.position.set(x + bx * 0.1, back * 0.035, z + bz * 0.1); m.rotation.set(0, u.pathIdx < u.path.length ? this.yaw[u.id] + Math.PI : aim, u.alive ? -back * 0.12 : 0.2); m.scale.set(gx, gy, gz); m.updateMatrix();
        this.gun.setMatrixAt(ng, m.matrix); this.gun.setColorAt(ng, col);
        ng++;
        if (u.kind === UK_MORTAR && u.alive) nm = this.crew22(u, x, z, col, nm);
      }
      if (u.kind === UK_INFANTRY) nm = this.squad21(u, x, z, simT, col, nm);
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
          this.rings.setMatrixAt(nr, m.matrix); this.rings.setColorAt(nr, C_SEL); nr++;
          if (this.armorArcs && u.side === SIDE_PLAYER && UNIT_KINDS[u.kind].armored && u.hullX !== undefined && u.hullZ !== undefined) {
            const size = TANK_SCALE23[u.kind] ?? 1;
            m.position.set(x, 0.025, z); m.scale.setScalar(size); m.rotation.set(0, this.yaw[u.id], 0); m.updateMatrix();
            this.armorArcs.setMatrixAt(na, m.matrix); this.armorArcs.setColorAt(na++, C_ARMOR_FRONT);
            m.rotation.y += Math.PI; m.updateMatrix();
            this.armorArcs.setMatrixAt(na, m.matrix); this.armorArcs.setColorAt(na++, C_ARMOR_REAR);
          }
        }
      }
    }
    if (this.marker && simT < this.marker.until && nr < MAX_RINGS) {
      const k = 1 - (this.marker.until - simT) / 0.8;
      m.position.set(this.marker.x, 0.02, this.marker.z); m.rotation.set(0, 0, 0); m.scale.setScalar(1.2 - 0.6 * k); m.updateMatrix();
      this.rings.setMatrixAt(nr, m.matrix); this.rings.setColorAt(nr, this.marker.col); nr++;
    }
    // 砲彈：穿甲彈直線；榴彈砲的高爆與煙幕共用拋物線
    let ns = 0;
    for (const s of w.shells) {
      if (ns >= MAX_SHELLS) break;
      const p = Math.min(1, (s.t + alpha) / s.T);
      const x = (s.sx + (s.ex - s.sx) * p) / SUB, z = (s.sz + (s.ez - s.sz) * p) / SUB;
      if (s.side !== SIDE_PLAYER && !this.visibleAt(x * SUB, z * SUB)) continue;
      const d = Math.hypot(s.ex - s.sx, s.ez - s.sz) / SUB;
      if (this.r4 && s.kind === SHELL_SMALL) {   // R021 步槍子彈：細短的曳光
        this.glow!.put(x, 0.14, z, 0.16, 0.014, 0.014, Math.atan2(-(s.ez - s.sz), s.ex - s.sx), 0xfff3c0, 0.9);
        continue;
      }
      if (this.r4 && s.kind === SHELL_AP) {   // 曳光：沿彈道拉長的亮條（加色），比一顆小方塊看得出誰打誰
        const yaw = Math.atan2(-(s.ez - s.sz), s.ex - s.sx);
        this.glow!.put(x, 0.2, z, 0.34, 0.03, 0.03, yaw, 0xfff0b8);
        this.glow!.put(x - Math.cos(yaw) * 0.22, 0.2, z + Math.sin(yaw) * 0.22, 0.2, 0.022, 0.022, yaw, 0xff8a30, 0.7);
        continue;
      }
      const indirect = s.kind === SHELL_HE || s.kind === SHELL_SMOKE;
      const y = indirect ? 0.3 + 4 * (d * 0.22) * p * (1 - p) : 0.2;
      m.position.set(x, y, z); m.rotation.set(0, 0, 0); m.scale.setScalar(indirect ? 1.2 : 0.8); m.updateMatrix();
      this.shells.setMatrixAt(ns, m.matrix); this.shells.setColorAt(ns, indirect ? C_HE_SHELL : C_AP_SHELL); ns++;
    }
    // 冒煙：沒屋頂的房子、剛被擊毀的車
    if (this.fxOn && !this.r4 && simT >= this.nextSmoke) {
      this.nextSmoke = simT + 0.7;
      const k = this.fxSeq++;
      smokeSources(w).forEach(([x, y, z], j) => this.spawn({ x: x + (hash2(k, j, 5) - 0.5) * 0.4, y, z: z + (hash2(k, j, 6) - 0.5) * 0.4, t0: simT, life: 3.2, s0: 0.12, s1: 0.5, vy: 0.45, c0: new THREE.Color(0x3d3a37), c1: new THREE.Color(0x8a8784) }));
      this.wrecks = this.wrecks.filter(r => r.until > simT);
      for (const r of this.wrecks) { const u = w.units[r.id - 1]; this.spawn({ x: u.x / SUB, y: 0.2, z: u.z / SUB, t0: simT, life: 2.4, s0: 0.08, s1: 0.32, vy: 0.4, c0: new THREE.Color(0x2c2a28), c1: new THREE.Color(0x77736e) }); }
    }
    this.fx = this.fx.filter(f => simT < f.t0 + f.life);
    // R107：先保留最多 8×5 個必要煙幕實例，再讓短命爆炸粒子使用餘額。
    // 世界是唯一來源，剛載入的畫面與一直更新的畫面都能看到仍存活的煙團。
    this.smoke107.update(w, this.fxOn && this.r107, this.fogOn, this.puff, this.fxMesh);
    let nf = this.r4 ? 0 : this.smoke107.puffs;
    const c = new THREE.Color();
    for (const f of this.fx) {
      if (nf >= MAX_FX) break;
      if (simT < f.t0 || !this.visibleAt(Math.floor(f.x * SUB), Math.floor(f.z * SUB))) continue;
      const k = (simT - f.t0) / f.life, s = f.s0 + (f.s1 - f.s0) * Math.sqrt(k), shrink = k > 0.75 ? 1 - (k - 0.75) * 4 : 1;
      m.position.set(f.x, f.y + f.vy * (simT - f.t0), f.z); m.rotation.set(0, 0, 0); m.scale.setScalar(Math.max(0.001, s * shrink)); m.updateMatrix();
      this.fxMesh.setMatrixAt(nf, m.matrix); this.fxMesh.setColorAt(nf, c.copy(f.c0).lerp(f.c1, k)); nf++;
    }
    const fin = (mesh: THREE.InstancedMesh, n: number) => {
      mesh.count = n; mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    };
    if (this.rising.size) {   // R016：升完的房子併回城鎮網格
      let done = false;
      for (const [id, until] of this.rising) if (simT >= until) { this.rising.delete(id); done = true; }
      if (done) { this.town.geometry.dispose(); this.town.geometry = buildTown(this.w, this.skipRising).geometry(); this.observerHeights.clear(); }
    }
    if (this.r4) this.updateFx(simT);
    if (this.r9) this.bars9(simT, selected);
    if (this.dash) this.orders11(selected);
    this.range113?.update(w, selected, showRanges);
    this.multi122.update(w, selected, showRanges && this.multiRangeEnabled);
    nm = this.bodies21(nm);
    fin(this.men, nm);
    if (this.armorArcs) fin(this.armorArcs, na);
    fin(this.observerMesh, no); fin(this.hull, nh); fin(this.turret, nh); fin(this.gun, ng); fin(this.discs, nd); fin(this.rings, nr); fin(this.shells, ns); fin(this.fxMesh, nf);
  }

  // ======== R004 破壞的重量 ========
  // 射擊線索（開火、彈著、擊毀）照 R100：看不到的地方不畫；建築的損壞本來就看得到，它的煙火照畫。
  private vis = (x: number, z: number): boolean => {
    if (!this.fogOn) return true;
    const cx = Math.floor(x), cz = Math.floor(z), n = this.n;
    if (cx < 0 || cz < 0 || cx >= n || cz >= n) return false;
    const i = cz * n + cx;
    if (this.visStamp[i] !== this.frameNo) { this.visStamp[i] = this.frameNo; this.visVal[i] = spotted(this.w, SIDE_PLAYER, (cx + 0.5) * SUB, (cz + 0.5) * SUB) ? 1 : 0; }
    return this.visVal[i] === 1;
  };

  private addEmitter(kind: number, id: number, x: number, z: number, w: number, d: number, h: number, t0: number, until: number, fog: boolean) {
    const every = kind === E_FIRE ? 0.06 : kind === E_SMOKE ? 0.55 : kind === E_WRECKFIRE ? 0.07 : kind === E_WRECKSMOKE ? 0.45 : 0.25;
    this.emitters.push({ kind, id, x, z, w, d, h, t0, until, every, next: t0, fog });
  }

  private shake(amount: number, x: number, z: number, t: number) {
    const d = Math.hypot(x - this.target.x, z - this.target.z);
    if (d > 12) return;
    const a = Math.min(0.08, amount * (1 - d / 12)), left = (this.lastT - this.shakeT0) / 0.4;
    const now = left >= 0 && left < 1 ? this.shakeAmp * (1 - left) * (1 - left) : 0;
    if (a > now) { this.shakeT0 = t; this.shakeAmp = a; }
  }

  // 一次爆炸：閃光 → 火球 → 貼地光暈 → 震波環 → 碎片 → 火星 → 地面揚塵 → 煙柱（S＝大小，fog＝射擊線索）
  private blast(x: number, z: number, t: number, S: number, fog: boolean, clods: number[], nClods: number) {
    const s = this.fxSeq++, H = (k: number, salt: number) => hash2(s, k, salt), g = this.glow!, p = this.puff!;
    g.spawn({ x, y: 0.25 * S, z, t0: t, life: 0.07, s0: 0.2 * S, s1: 0.6 * S, c0: 0xfffbe0, c1: 0xffd27a, fog });
    for (let k = 0; k < 6; k++) {
      const a = H(k, 1) * Math.PI * 2, r = 0.18 * S * H(k, 2), hot = k < 2;
      g.spawn({ x: x + Math.cos(a) * r, y: (0.12 + 0.1 * H(k, 3)) * S, z: z + Math.sin(a) * r, vx: Math.cos(a) * 0.5 * S, vz: Math.sin(a) * 0.5 * S, vy: (0.7 + 0.8 * H(k, 4)) * S, drag: 2.5,
        t0: t + 0.015 * k, life: 0.3 + 0.25 * H(k, 5), s0: 0.1 * S, s1: (0.24 + 0.16 * H(k, 6)) * S, c0: hot ? 0xfff0a0 : 0xffa830, c1: hot ? 0xff6a18 : 0x9a2808, fog });
    }
    g.spawn({ x, y: 0.03, z, t0: t, life: 0.35, s0: 0.6 * S, s1: 1.1 * S, c0: 0xb86a2c, c1: 0x301000, fog, flat: true });
    this.ring!.spawn({ x, y: 0.04, z, t0: t, life: 0.34, s0: 0.15 * S, s1: 1.75 * S, c0: 0xfff0c8, c1: 0x6a4a20, fog });
    for (let k = 0; k < nClods; k++) {
      const a = H(k, 5) * Math.PI * 2, v = (0.8 + 1.4 * H(k, 6)) * S;
      this.debris!.spawn({ x, y: 0.1, z, vx: Math.cos(a) * v, vz: Math.sin(a) * v, vy: (3 + 2.5 * H(k, 7)) * S, g: 11, t0: t, life: 2.6 + 1.2 * H(k, 8), s0: (0.05 + 0.04 * H(k, 9)) * S, s1: (0.035 + 0.03 * H(k, 10)) * S, c0: clods[k % clods.length], spin: 8 + 10 * H(k, 11), seed: H(k, 12), fog });
    }
    for (let k = 0; k < 6; k++) {
      const a = H(k, 13) * Math.PI * 2, v = 1.5 + 1.6 * H(k, 14);
      g.spawn({ x, y: 0.15, z, vx: Math.cos(a) * v, vz: Math.sin(a) * v, vy: 2 + 2 * H(k, 15), g: 9, t0: t, life: 0.35 + 0.3 * H(k, 16), s0: 0.04, s1: 0.022, c0: 0xffe9a0, c1: 0xff5a10, fog });
    }
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2 + H(k, 17) * 0.5, v = (1.1 + 0.7 * H(k, 18)) * S;
      p.spawn({ x: x + Math.cos(a) * 0.25 * S, y: 0.06, z: z + Math.sin(a) * 0.25 * S, vx: Math.cos(a) * v, vz: Math.sin(a) * v, drag: 2.4, vy: 0.12, t0: t, life: 1.6 + 0.8 * H(k, 19), s0: 0.14 * S, s1: 0.45 * S, c0: 0x8a7a62, c1: 0x9c9384, fog });
    }
    for (let k = 0; k < 4; k++) p.spawn({ x: x + (H(k, 20) - 0.5) * 0.2, y: 0.2 + 0.12 * k, z: z + (H(k, 21) - 0.5) * 0.2, vy: 0.55 + 0.25 * H(k, 22), t0: t + 0.06 * k, life: 3 + 1.2 * H(k, 23), s0: 0.16 * S, s1: (0.62 + 0.2 * H(k, 24)) * S, c0: 0x3c3834, c1: 0x7a7672, fog });
  }

  private fx4(e: SimEvent, t: number) {
    if (e.e === 'impact' && e.kind === SHELL_SMOKE) return;   // 沒有火球、火星、碎片或震動
    const s = this.fxSeq++, H = (k: number, salt: number) => hash2(s, k, salt);
    if (e.e === 'fire') {
      const u = this.w.units[e.unit - 1];
      if (!u || !this.visibleUnit(u)) return;
      if (u.kind === UK_INFANTRY) {   // R021 步槍：小小的槍口火光
        const a = Math.atan2(u.aimZ, u.aimX), x0 = e.x / SUB + Math.cos(a) * 0.18, z0 = e.z / SUB + Math.sin(a) * 0.18, y0 = this.unitHeight(u) + 0.16;
        this.glow!.spawn({ x: x0, y: y0, z: z0, t0: t, life: 0.06, s0: 0.03, s1: 0.07, c0: 0xfff6c8, c1: 0xffa040, fog: u.side !== SIDE_PLAYER });
        return;
      }
      const a = Math.atan2(u.aimZ, u.aimX), gun = u.kind === UK_HOWITZER, L = gun ? 0.42 : u.kind === UK_MORTAR ? 0.16 : 0.44, y = gun ? 0.32 : u.kind === UK_MORTAR ? 0.26 : u.kind === UK_ATGUN ? 0.15 : 0.2;
      const mx = e.x / SUB + Math.cos(a) * L, mz = e.z / SUB + Math.sin(a) * L, fog = u.side !== SIDE_PLAYER;
      this.glow!.spawn({ x: mx, y, z: mz, t0: t, life: 0.08, s0: 0.1, s1: gun ? 0.34 : 0.22, c0: 0xfff6c8, c1: 0xffa040, fog });
      this.glow!.spawn({ x: mx, y, z: mz, vx: Math.cos(a) * 2.2, vz: Math.sin(a) * 2.2, drag: 9, t0: t, life: 0.11, s0: 0.07, s1: gun ? 0.2 : 0.13, c0: 0xffe090, c1: 0xff6020, fog });
      for (let k = 0; k < (gun ? 5 : 3); k++) {
        const v = 0.7 + 0.7 * H(k, 1), side = (H(k, 2) - 0.5) * 0.8;
        this.puff!.spawn({ x: mx, y, z: mz, vx: Math.cos(a + side) * v, vz: Math.sin(a + side) * v, drag: 3, vy: 0.22, t0: t + 0.02 * k, life: 1 + 0.6 * H(k, 3), s0: 0.05, s1: gun ? 0.3 : 0.22, c0: 0xc8c2b6, c1: 0x8f8b85, fog });
      }
      if (gun) {
        for (let k = 0; k < 4; k++) { const b = (k / 4) * Math.PI * 2; this.puff!.spawn({ x: e.x / SUB, y: 0.04, z: e.z / SUB, vx: Math.cos(b) * 1.1, vz: Math.sin(b) * 1.1, drag: 3, vy: 0.05, t0: t, life: 1.1, s0: 0.08, s1: 0.26, c0: 0x9a8b74, c1: 0xa59c8c, fog }); }
        this.shake(0.02, e.x / SUB, e.z / SUB, t);
      }
    } else if (e.e === 'impact') {
      const x = e.x / SUB, z = e.z / SUB;
      if (e.kind === SHELL_SMALL) {   // R021 子彈：一點塵、一點火星，不爆炸、不震
        this.puff!.spawn({ x, y: 0.05, z, vy: 0.15, t0: t, life: 0.7, s0: 0.03, s1: 0.1, c0: 0x9a8b74, c1: 0xa59c8c, fog: true });
        return;
      }
      if (e.kind === SHELL_HE) { this.blast(x, z, t, e.r ? 0.6 : 1, true, DIRT, e.r ? 4 : 7); if (this.vis(x, z)) this.shake(0.06, x, z, t); return; }   // 看不到的彈著不震（不洩漏）
      // 穿甲彈：打中建築噴牆色碎片；打空或打中車輛噴火星
      const b = e.bld ? this.w.blds[e.bld - 1] : null, fog = true;
      this.glow!.spawn({ x, y: b ? 0.3 : 0.15, z, t0: t, life: 0.07, s0: 0.08, s1: 0.26, c0: 0xfff2c0, c1: 0xffa040, fog });
      if (b) {
        const wall = bldColors(b.kind).wall.getHex();
        for (let k = 0; k < 6; k++) {
          const a = H(k, 1) * Math.PI * 2, v = 0.6 + 1.2 * H(k, 2);
          this.debris!.spawn({ x, y: 0.25 + 0.15 * H(k, 3), z, vx: Math.cos(a) * v, vz: Math.sin(a) * v, vy: 1.5 + 1.8 * H(k, 4), g: 10, t0: t, life: 2.2 + H(k, 5), s0: 0.035 + 0.035 * H(k, 6), s1: 0.03, c0: k % 3 ? wall : RUBBLE_COLORS[k % RUBBLE_COLORS.length].getHex(), spin: 10, seed: H(k, 7), fog });
        }
        for (let k = 0; k < 3; k++) this.puff!.spawn({ x: x + (H(k, 8) - 0.5) * 0.3, y: 0.2 + 0.1 * k, z: z + (H(k, 9) - 0.5) * 0.3, vy: 0.3, t0: t, life: 1.6 + 0.6 * H(k, 10), s0: 0.08, s1: 0.32, c0: 0x9a8b74, c1: 0xa8a090, fog });
      } else {
        for (let k = 0; k < 6; k++) {
          const a = H(k, 11) * Math.PI * 2, v = 1.4 + 1.8 * H(k, 12);
          this.glow!.spawn({ x, y: 0.15, z, vx: Math.cos(a) * v, vz: Math.sin(a) * v, vy: 1.4 + 1.6 * H(k, 13), g: 9, t0: t, life: 0.3 + 0.25 * H(k, 14), s0: 0.035, s1: 0.02, c0: 0xfff0b0, c1: 0xff6a20, fog });
        }
        for (let k = 0; k < 2; k++) this.puff!.spawn({ x, y: 0.06, z, vy: 0.2, t0: t + 0.05 * k, life: 1.2, s0: 0.07, s1: 0.24, c0: 0x8a7a62, c1: 0x9c9384, fog });
      }
    } else if (e.e === 'stage') {
      const b = this.w.blds[e.bld - 1], from = this.lastStage[b.id] ?? STAGE_INTACT;
      this.lastStage[b.id] = e.stage;
      this.stage4(b, from, e.stage, t);
    } else if (e.e === 'kill') {
      const u = this.w.units[e.unit - 1];
      if (!u || !this.visibleUnit(u)) return;
      const x = u.x / SUB, z = u.z / SUB, fog = u.side !== SIDE_PLAYER;
      if (u.kind === UK_OBSERVER || u.kind === UK_INFANTRY) {
        for (let k = 0; k < 3; k++) this.puff!.spawn({ x, y: 0.08, z, vy: 0.2, t0: t + 0.05 * k, life: 1.4, s0: 0.06, s1: 0.22, c0: 0x9a8b74, c1: 0xa59c8c, fog });
        return;
      }
      const tank = UNIT_KINDS[u.kind].armored;
      this.blast(x, z, t, tank ? 1.25 : 0.9, fog, STEEL, tank ? 7 : 5);
      this.shake(tank ? 0.07 : 0.045, x, z, t);
      if (tank) this.toss.set(u.id, { t0: t, vx: (H(1, 30) - 0.5) * 1.4, vz: (H(2, 30) - 0.5) * 1.4, spin: 5 + 6 * H(3, 30), yaw: Math.atan2(-u.aimZ, u.aimX), tilt: H(4, 30) - 0.5 });
      if (tank) this.addEmitter(E_WRECKFIRE, u.id, x - 0.15, z - 0.15, 0.3, 0.3, 0.2, t, t + 15, fog);
      this.addEmitter(E_WRECKSMOKE, u.id, x, z, 0, 0, 0.25, t + 0.3, tank ? Infinity : t + 10, fog);
    } else if (e.e === 'build') {
      // R006 布陣落地：腳下揚一圈塵；R016：房子從地面升起（城鎮網格先不含它，升完再併回去）
      const b = this.w.blds[e.bld - 1];
      if (!b) return;
      if (this.r16 && this.ghosts) {
        this.ghosts.add(buildingGeo(new Geo(), b, STAGE_INTACT), t, wallHeight(b) + roofRise(b.kind), b.x + b.w / 2, b.z + b.d / 2, hash2(b.id, 5, 91), true);
        this.rising.set(b.id, t + RISE_S);
      }
      if (this.lastStage.length > b.id) this.lastStage[b.id] = STAGE_INTACT;
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2, cx = b.x + b.w / 2, cz = b.z + b.d / 2, r = Math.max(b.w, b.d) * 0.55;
        this.puff!.spawn({ x: cx + Math.cos(a) * r, y: 0.05, z: cz + Math.sin(a) * r, vx: Math.cos(a) * 0.8, vz: Math.sin(a) * 0.8, drag: 2.5, vy: 0.1, t0: t + 0.03 * k, life: 1.6, s0: 0.12, s1: 0.4, c0: 0x9a8b74, c1: 0xb0a898 });
      }
    }
  }

  // 建築換階段：完好 → 沒屋頂＝屋頂炸飛、起火；任何 → 瓦礫＝倒塌殘影沉進地面、大團揚塵、碎塊四散
  private stage4(b: Building, from: number, to: number, t: number) {
    const s = this.fxSeq++, H = (k: number, salt: number) => hash2(s, k, salt);
    const cx = b.x + b.w / 2, cz = b.z + b.d / 2, wallH = wallHeight(b), rise = roofRise(b.kind), col = bldColors(b.kind);
    const bounds = wallShown(b) ? wallBounds(b) : null;
    const fx = bounds?.x0 ?? b.x, fz = bounds?.z0 ?? b.z, fw = bounds ? bounds.x1 - bounds.x0 : b.w, fd = bounds ? bounds.z1 - bounds.z0 : b.d;
    const wall = col.wall.getHex(), roof = col.roof.getHex();
    if (from === STAGE_INTACT && to !== STAGE_INTACT) {
      const n = Math.min(20, 10 + 2 * b.w * b.d);
      for (let k = 0; k < n; k++) {
        const inset = bounds ? 0.02 : 0.15;
        const x = fx + inset + H(k, 1) * (fw - 2 * inset), z = fz + inset + H(k, 2) * (fd - 2 * inset);
        this.debris!.spawn({ x, y: wallH + rise * 0.5, z, vx: (x - cx) * 1.6 + (H(k, 3) - 0.5), vz: (z - cz) * 1.6 + (H(k, 4) - 0.5), vy: 2.2 + 2.4 * H(k, 5), g: 9, t0: t, life: 3.5 + 1.5 * H(k, 6), s0: 0.07 + 0.06 * H(k, 7), s1: 0.025, c0: roof, spin: 6 + 8 * H(k, 8), seed: H(k, 9) });
      }
      this.glow!.spawn({ x: cx, y: wallH * 0.7, z: cz, t0: t, life: 0.2, s0: 0.3, s1: 0.85, c0: 0xffe8a0, c1: 0xff7020 });
      for (let k = 0; k < 6; k++) this.puff!.spawn({ x: cx + (H(k, 10) - 0.5) * fw, y: wallH, z: cz + (H(k, 11) - 0.5) * fd, vy: 0.45, t0: t + 0.04 * k, life: 2.2 + H(k, 12), s0: 0.14, s1: 0.5, c0: 0x9a8b74, c1: 0x9c9384 });
      this.shake(0.035, cx, cz, t);
    }
    if (to === STAGE_ROOFLESS) {
      const inset = bounds ? 0.02 : 0.15;
      this.addEmitter(E_FIRE, b.id, fx + inset, fz + inset, fw - 2 * inset, fd - 2 * inset, wallH * 0.72, t, t + 20, false);
      this.addEmitter(E_SMOKE, b.id, fx, fz, fw, fd, wallH * 0.72, t + 0.4, Infinity, false);
      return;
    }
    if (to !== STAGE_RUBBLE) return;
    for (const em of this.emitters) if (em.id === b.id && (em.kind === E_FIRE || em.kind === E_SMOKE)) em.until = Math.min(em.until, t);
    const h = (from === STAGE_INTACT ? wallH + rise : wallH * 0.72) + 0.05;
    const g = buildingGeo(new Geo(), b, from);
    this.ghosts!.add(g, t, h, cx, cz, hash2(b.id, 3, 77));
    const R = Math.max(b.w, b.d) * 0.5;
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2 + H(k, 13) * 0.4, v = 1.2 + 0.9 * H(k, 14);
      this.puff!.spawn({ x: cx + Math.cos(a) * R, y: 0.08, z: cz + Math.sin(a) * R, vx: Math.cos(a) * v, vz: Math.sin(a) * v, drag: 1.6, vy: 0.14, t0: t + 0.05 + 0.02 * (k % 4), life: 2.6 + 1.2 * H(k, 15), s0: 0.25, s1: 0.8 + 0.3 * H(k, 16), c0: 0x9a8b74, c1: 0xb0a898 });
    }
    for (let k = 0; k < 6; k++) this.puff!.spawn({ x: cx + (H(k, 17) - 0.5) * b.w * 0.6, y: 0.2, z: cz + (H(k, 18) - 0.5) * b.d * 0.6, vy: 0.6 + 0.3 * H(k, 19), t0: t + 0.15 * k, life: 3 + H(k, 20), s0: 0.3, s1: 1 + 0.3 * H(k, 21), c0: 0x8d8170, c1: 0xa69e90 });
    const pal = [wall, wall, roof, RUBBLE_COLORS[0].getHex(), RUBBLE_COLORS[1].getHex(), RUBBLE_COLORS[2].getHex()];
    for (let k = 0; k < 22; k++) {
      const a = H(k, 22) * Math.PI * 2, v = 0.5 + 1.3 * H(k, 23);
      this.debris!.spawn({ x: cx + Math.cos(a) * R * 0.5, y: h * (0.25 + 0.7 * H(k, 24)), z: cz + Math.sin(a) * R * 0.5, vx: Math.cos(a) * v, vz: Math.sin(a) * v, vy: 1 + 2.2 * H(k, 25), g: 10, t0: t + 0.1 * H(k, 26), life: 4 + 2 * H(k, 27), s0: 0.06 + 0.08 * H(k, 28), s1: 0.05 + 0.05 * H(k, 29), c0: pal[k % pal.length], spin: 4 + 6 * H(k, 30), seed: H(k, 31) });
    }
    this.glow!.spawn({ x: cx, y: 0.03, z: cz, t0: t, life: 0.5, s0: R * 1.2, s1: R * 2, c0: 0xc08040, c1: 0x201000, flat: true });
    this.addEmitter(E_DUST, b.id, b.x, b.z, b.w, b.d, 0.1, t + 0.6, t + 6, false);
    this.shake(0.08, cx, cz, t);
  }

  private emit(em: Emitter, t: number, n: number) {
    const H = (k: number) => hash2(em.id * 131 + em.kind, n, k), fog = em.fog;
    const x = em.x + H(1) * em.w, z = em.z + H(2) * em.d;
    if (em.kind === E_FIRE || em.kind === E_WRECKFIRE) {
      const wreck = em.kind === E_WRECKFIRE;
      this.glow!.spawn({ x, y: wreck ? 0.15 : 0.05 + 0.4 * em.h * H(3), z, vy: 0.7 + 0.4 * H(4), drag: 1, t0: t, life: 0.45 + 0.3 * H(5), s0: 0.06, s1: (wreck ? 0.12 : 0.15) + 0.06 * H(6), c0: 0xffe27a, c1: 0xff3c10, fog });
      if (n % 3 === 0) this.glow!.spawn({ x, y: em.h * 0.8, z, vx: (H(7) - 0.5) * 0.6, vz: (H(8) - 0.5) * 0.6, vy: 1.3 + 0.5 * H(9), drag: 0.5, t0: t, life: 1.2 + 0.4 * H(10), s0: 0.024, s1: 0.016, c0: 0xffc050, c1: 0xff3000, fog });
      if (n % 5 === 0) this.puff!.spawn({ x, y: em.h + 0.1, z, vy: 0.55, t0: t, life: 3, s0: 0.1, s1: 0.5, c0: 0x2e2b28, c1: 0x76726e, fog });
    } else if (em.kind === E_SMOKE) {
      this.puff!.spawn({ x: em.x + em.w * (0.3 + 0.4 * H(1)), y: em.h * 0.8, z: em.z + em.d * (0.3 + 0.4 * H(2)), vy: 0.45, t0: t, life: 3.4, s0: 0.13, s1: 0.6, c0: 0x3d3a37, c1: 0x8a8784, fog });
    } else if (em.kind === E_WRECKSMOKE) {
      this.puff!.spawn({ x: em.x + (H(1) - 0.5) * 0.15, y: em.h, z: em.z + (H(2) - 0.5) * 0.15, vy: 0.55, t0: t, life: 3.2, s0: 0.1, s1: 0.5, c0: 0x221f1d, c1: 0x5d5a57, fog });
    } else {
      this.puff!.spawn({ x, y: 0.05, z, vy: 0.12, t0: t, life: 2, s0: 0.16, s1: 0.48, c0: 0x9a8b74, c1: 0xa59c8c, fog });
    }
  }

  private updateFx(t: number) {
    this.ghosts!.update(t);
    let j = 0;
    for (const em of this.emitters) {
      const oldest = t - E_LIFE[em.kind];
      if (em.next < oldest) em.next = em.t0 + Math.ceil((oldest - em.t0) / em.every) * em.every;
      while (em.next <= t && em.next < em.until) { this.emit(em, em.next, Math.round((em.next - em.t0) / em.every)); em.next += em.every; }
      // 火光：貼地、閃爍的加色光暈（不加燈）
      if ((em.kind === E_FIRE || em.kind === E_WRECKFIRE) && t >= em.t0 && t < em.until && (!em.fog || this.vis(em.x, em.z))) {
        const fl = 0.75 + 0.25 * Math.sin(t * 23 + em.id) * Math.sin(t * 7.3 + em.id * 2), r = Math.max(em.w, em.d, 0.4) * 0.9 + 0.35;
        this.glow!.put(em.x + em.w / 2, 0.03, em.z + em.d / 2, r * fl, 0.02, r * fl, 0, 0xff7a2a, 0.55 * fl);
      }
      if (em.next < em.until) this.emitters[j++] = em;
    }
    this.emitters.length = j;
    this.puff!.update(t, this.vis); this.glow!.update(t, this.vis); this.debris!.update(t, this.vis); this.ring!.update(t, this.vis);
    this.puff!.finish(); this.glow!.finish(); this.debris!.finish(); this.ring!.finish();
  }

  // 砲塔飛起：彈道、翻滾，落在車旁（繞砲塔中心轉）
  private tossMatrix(T: Toss, x: number, z: number, t: number): THREE.Matrix4 {
    const dt = Math.max(0, t - T.t0), g = 9, vy = 3.4, tl = (2 * vy) / g, k = Math.min(dt, tl);
    const px = x + T.vx * k, pz = z + T.vz * k;
    let py: number, rx: number, ry: number, rz: number;
    if (dt < tl) { py = 0.2 + vy * dt - 0.5 * g * dt * dt; rx = T.spin * dt; ry = T.yaw + T.spin * 0.5 * dt; rz = T.spin * 0.7 * dt; }
    else { py = 0.07; rx = T.tilt * 0.8; ry = T.yaw + T.spin * 0.5 * tl; rz = 0.45 + T.tilt * 0.3; }
    const e = this.tmp;
    e.position.set(px, py, pz); e.rotation.set(rx, ry, rz); e.scale.setScalar(1); e.updateMatrix();
    return this.mA.multiplyMatrices(e.matrix, this.mB.makeTranslation(0, -0.2, 0));
  }

  // 守衛與煙霧測試用
  get pools() {
    return this.r4 ? { puff: this.puff!.count, glow: this.glow!.count, debris: this.debris!.count, ring: this.ring!.count, ghost: this.ghosts!.count }
      : { puff: 0, glow: 0, debris: 0, ring: 0, ghost: 0 };
  }
  get poolCaps() { return this.r4 ? { puff: this.puff!.cap, glow: this.glow!.cap, debris: this.debris!.cap, ring: this.ring!.cap } : null; }
  get smokeCounts() { return { clouds: this.smoke107.clouds, puffs: this.smoke107.puffs }; }
  fxDigest(): string {
    if (!this.r4) return 'off';
    let h = 0x811c9dc5;
    h = this.puff!.digest(h); h = this.glow!.digest(h); h = this.debris!.digest(h); h = this.ring!.digest(h); h = this.ghosts!.digest(h);
    return h.toString(16).padStart(8, '0');
  }


  // ======== R008 車輛有重量 ========
  // 每一步之後：車轍蓋進地面貼圖、行進揚塵、開火記後座、扣血記閃光（全部從世界的變化看出來，不加模擬事件）
  private vehicles8(events: SimEvent[], t: number) {
    this.stepNo++;
    for (const e of events) if (e.e === 'fire') this.recoilT0[e.unit] = t;
    const n = this.n, W = n * PX;
    for (const u of this.w.units) {
      if (u.hp < this.lastHp[u.id]) this.flashT0[u.id] = t;
      this.lastHp[u.id] = u.hp;
      if (!u.alive || UNIT_KINDS[u.kind].radius === 0) continue;   // 步兵（觀測員、步兵班）不壓車轍
      const dx = u.x - this.prevX[u.id], dz = u.z - this.prevZ[u.id];
      if (!dx && !dz) continue;
      const len = Math.hypot(dx, dz), px = -dz / len, pz = dx / len, off = UNIT_KINDS[u.kind].armored ? 0.13 * (TANK_SCALE23[u.kind] ?? 1) : 0.11;
      // 兩條車轍：沿這一步走過的線段，每 1/8 格蓋一個像素；同一條車轍連續壓到同一個像素只算一次
      const steps = Math.max(1, Math.ceil((len / SUB) * PX));
      for (let side = 0; side < 2; side++) {
        const sg = side ? 1 : -1;
        for (let k = 1; k <= steps; k++) {
          const fx = (this.prevX[u.id] + (dx * k) / steps) / SUB + sg * px * off, fz = (this.prevZ[u.id] + (dz * k) / steps) / SUB + sg * pz * off;
          const gx = Math.floor(fx * PX), gz = Math.floor(fz * PX);
          if (gx < 0 || gz < 0 || gx >= W || gz >= W) continue;
          const pi = gz * W + gx, slot = u.id * 2 + side;
          if (this.trackLast[slot] === pi) continue;
          this.trackLast[slot] = pi;
          if (this.tracks[pi] < 6) this.tracks[pi]++;
          const ci = Math.floor(gz / PX) * n + Math.floor(gx / PX);
          if (this.dirtyStamp[ci] !== this.stepNo) { this.dirtyStamp[ci] = this.stepNo; this.dirtyList[this.dirtyN++] = ci; }
        }
      }
      // 行進揚塵：車尾，草地農田每步、路上每三步一朵（R004 的煙塵池；?fx=off 時沒有池＝不揚塵）
      if (this.puff) {
        const cx = Math.floor(u.x / SUB), cz = Math.floor(u.z / SUB), road = this.w.ter[cellIdx(this.w, cx, cz)] === TER_ROAD;
        if (!road || (this.stepNo + u.id) % 3 === 0) {
          const h = hash2(u.id, this.stepNo, 41), bx = u.x / SUB - (dx / len) * 0.3, bz = u.z / SUB - (dz / len) * 0.3;
          this.puff.spawn({ x: bx + (h - 0.5) * 0.2, y: 0.05, z: bz + (hash2(u.id, this.stepNo, 42) - 0.5) * 0.2, vx: -(dx / len) * 0.3, vz: -(dz / len) * 0.3, drag: 2, vy: 0.18,
            t0: t, life: 1.1 + 0.6 * h, s0: 0.05, s1: road ? 0.18 : 0.26, c0: road ? 0x9a8d78 : 0x8a7a5e, c1: 0xa69e8e, fog: u.side !== SIDE_PLAYER });
        }
      }
    }
    if (this.dirtyN) {
      for (let i = 0; i < this.dirtyN; i++) { const c = this.dirtyList[i]; this.paintCell(c % n, (c - (c % n)) / n); }
      this.dirtyN = 0;
      this.groundTex.needsUpdate = true;   // 一步最多上傳一次
    }
  }

  // 砲塔平滑轉向：每秒最多轉 TURRET_RATE 弧度；時間倒退或跳太多（換世界、重跑腳本）就直接對準
  private turn8(t: number) {
    const dt = t - this.turretT;
    this.turretT = t;
    for (const u of this.w.units) {
      const want = Math.atan2(-u.aimZ, u.aimX);
      if (dt < 0 || dt > 1) { this.turretYaw[u.id] = want; continue; }
      let d = want - this.turretYaw[u.id];
      d -= Math.round(d / (2 * Math.PI)) * 2 * Math.PI;
      const max = TURRET_RATE * dt;
      this.turretYaw[u.id] += Math.max(-max, Math.min(max, d));
    }
  }


  // ======== R009 血條與耐久條 ========
  // 單位：受過傷或被選取才畫；扣血時白色殘影從舊血量縮到新血量（0.5 秒）。敵方只在看得到時畫（R100）。
  // 建築：我方單位正在砲擊的那棟畫耐久條，標出「空殼」門檻（70%）。
  private bars9(t: number, selected: Set<number>) {
    const w = this.w, dbg = this.barDbg;
    this.nb9 = 0; this.nf9 = 0; dbg.n = 0;
    for (const u of w.units) {
      const max = UNIT_KINDS[u.kind].hp;
      if (u.hp < this.barHp[u.id]) { this.barFrom[u.id] = this.ghost9(u.id, t); this.barHitT[u.id] = t; }
      this.barHp[u.id] = u.hp;
      if (!u.alive || (u.hp >= max && !selected.has(u.id)) || !this.visibleUnit(u)) continue;
      const frac = Math.max(0, u.hp / max), ghost = this.ghost9(u.id, t) / max;
      // 綠（滿）→ 黃（一半）→ 紅（快死）
      if (frac > 0.5) this.barColor.copy(C_BAR_MID).lerp(C_BAR_HI, (frac - 0.5) * 2); else this.barColor.copy(C_BAR_LO).lerp(C_BAR_MID, frac * 2);
      const x = (this.prevX[u.id] + (u.x - this.prevX[u.id]) * this.alpha9) / SUB, z = (this.prevZ[u.id] + (u.z - this.prevZ[u.id]) * this.alpha9) / SUB;
      this.bar9(u.id, x, this.unitHeight(u) + (u.kind === UK_OBSERVER ? 0.85 : 0.55), z, u.kind === UK_OBSERVER ? 0.34 : 0.5, frac, Math.max(frac, Math.min(1, ghost)), this.barColor, 0);
    }
    // 我方正在砲擊的建築（同一棟只畫一次）
    for (const u of w.units) {
      if (!u.alive || u.side !== SIDE_PLAYER || u.order !== ORD_FIRE_AT || u.target > 0) continue;
      const id = w.occ[cellIdx(w, u.tx, u.tz)], b = id ? w.blds[id - 1] : null;
      if (!b || b.hp <= 0) continue;
      let dup = false;
      for (let i = 0; i < dbg.n; i++) if (dbg.id[i] === -b.id) dup = true;
      if (dup) continue;
      const frac = b.hp / b.maxHp;
      this.barColor.copy(frac > 0.7 ? C_BLD_HI : C_BLD_LO);
      const h = wallHeight(b) * (wallShown(b) && stageOf(b) === STAGE_ROOFLESS ? 0.72 : 1);
      this.bar9(-b.id, b.x + b.w / 2, h + roofRise(b.kind) + 0.35, b.z + b.d / 2, Math.min(1.2, 0.5 + 0.25 * Math.max(b.w, b.d)), frac, frac, this.barColor, 0.7);
    }
    const bg = this.barBg!, fill = this.barFill;
    if (fill) {
      bg.count = this.nb9; fill.count = this.nf9;
      fill.instanceMatrix.needsUpdate = true;
      if (fill.instanceColor) fill.instanceColor.needsUpdate = true;
    } else {
      const offset = MAX_UNITS + 64;
      // copyWithin handles overlap and allocates nothing; retain original fill ordering.
      bg.instanceMatrix.array.copyWithin(this.nb9 * 16, offset * 16, (offset + this.nf9) * 16);
      if (bg.instanceColor) bg.instanceColor.array.copyWithin(this.nb9 * 3, offset * 3, (offset + this.nf9) * 3);
      bg.count = this.nb9 + this.nf9;
    }
    bg.instanceMatrix.needsUpdate = true;
    if (bg.instanceColor) bg.instanceColor.needsUpdate = true;
  }
  // 一條血條：底（黑框）、白色殘影、填色、門檻刻度；左端對齊、往鏡頭的右邊長
  private bar9(id: number, cx: number, y: number, cz: number, L: number, frac: number, ghost: number, col: THREE.Color, notch: number) {
    const R = this.barRight, x0 = cx - R.x * L / 2, y0 = y - R.y * L / 2, z0 = cz - R.z * L / 2, capB = MAX_UNITS + 64, capF = 2 * capB, dbg = this.barDbg, fill = this.barFill ?? this.barBg!, offset = this.barFill ? 0 : capB;
    if (this.nb9 < capB) this.put9(this.barBg!, this.nb9++, x0 - R.x * 0.02, y0 - R.y * 0.02, z0 - R.z * 0.02, L + 0.04, 0.085, C_BAR_BG);
    if (ghost > frac && this.nf9 < capF) this.put9(fill, offset + this.nf9++, x0, y0, z0, L * ghost, 0.05, C_WHITE);
    if (frac > 0 && this.nf9 < capF) this.put9(fill, offset + this.nf9++, x0, y0, z0, L * frac, 0.05, col);
    if (notch > 0 && this.nf9 < capF) this.put9(fill, offset + this.nf9++, x0 + R.x * L * notch, y0 + R.y * L * notch, z0 + R.z * L * notch, 0.025, 0.07, C_BAR_BG);
    if (dbg.n < dbg.id.length) { dbg.id[dbg.n] = id; dbg.frac[dbg.n] = frac; dbg.ghost[dbg.n] = ghost; dbg.r[dbg.n] = col.r; dbg.g[dbg.n] = col.g; dbg.n++; }
  }
  private put9(mesh: THREE.InstancedMesh, i: number, x: number, y: number, z: number, len: number, h: number, col: THREE.Color) {
    const m = this.tmp;
    m.position.set(x, y, z); m.quaternion.copy(this.barQ); m.scale.set(Math.max(0.0001, len), h, 1); m.updateMatrix();
    mesh.setMatrixAt(i, m.matrix); mesh.setColorAt(i, col);
  }
  private alpha9 = 0;
  // 白色殘影目前停在多少血（0.5 秒內從扣血前縮到現在的血量）
  private ghost9(id: number, t: number): number {
    const k = (t - this.barHitT[id]) / 0.5, now = this.barHp[id];
    return k >= 1 || k < 0 ? now : now + (this.barFrom[id] - now) * (1 - k);
  }
  get bars() { return this.r9 ? { bg: this.nb9, fill: this.nf9 } : { bg: 0, fill: 0 }; }


  // ======== R011 指令回饋 ========
  // 只畫被選取的我方單位：剩下的路（綠／紅／橘，越遠越淡）、終點方塊、攻擊線（看得到畫到目標身上，看不到畫到最後已知位置）、砲擊準星
  private orders11(selected: Set<number>) {
    const w = this.w, dbg = this.dashDbg;
    this.nd11 = 0; dbg.n = 0;
    for (const id of selected) {
      const u = id >= 1 && id <= w.units.length ? w.units[id - 1] : null;
      if (!u || !u.alive || u.side !== SIDE_PLAYER) continue;
      const x = (this.prevX[u.id] + (u.x - this.prevX[u.id]) * this.alpha9) / SUB, z = (this.prevZ[u.id] + (u.z - this.prevZ[u.id]) * this.alpha9) / SUB;
      const col = u.order === ORD_ATTACK ? 0xff5040 : u.order === ORD_FIRE_AT ? 0xffa030 : 0x6cff70;
      // 剩下的路：沿折線每 0.3 格一段
      let px = x, pz = z, walked = 0, ex = x, ez = z;
      for (let i = u.pathIdx; i < u.path.length && this.nd11 < DASH_CAP; i++) {
        const c = u.path[i], cx = (c % w.n) + 0.5, cz = (c - (c % w.n)) / w.n + 0.5;
        walked = this.dashes11(u.id, DK_PATH, px, pz, cx, cz, col, walked);
        px = cx; pz = cz; ex = cx; ez = cz;
      }
      if (u.pathIdx < u.path.length) this.dash11(u.id, DK_END, ex, ez, 0.16, 0.16, 0, col, 1);
      if (u.order === ORD_ATTACK) {
        const t = w.units[u.target - 1];
        const seen = !!t && t.alive && this.visibleUnit(t);
        const tx = seen ? (this.prevX[t.id] + (t.x - this.prevX[t.id]) * this.alpha9) / SUB : u.tx / SUB, tz = seen ? (this.prevZ[t.id] + (t.z - this.prevZ[t.id]) * this.alpha9) / SUB : u.tz / SUB;
        this.dashes11(u.id, DK_ATTACK, x, z, tx, tz, 0xff4030, 0);
      } else if (u.order === ORD_FIRE_AT) {
        const tx = u.tx + 0.5, tz = u.tz + 0.5;
        this.dashes11(u.id, DK_FIRE, x, z, tx, tz, 0xff9a20, 0);
        this.dash11(u.id, DK_CROSS, tx, tz, 0.6, 0.06, Math.PI / 4, 0xffb040, 1);
        this.dash11(u.id, DK_CROSS, tx, tz, 0.6, 0.06, -Math.PI / 4, 0xffb040, 1);
      }
    }
    const d = this.dash!;
    d.count = this.nd11; d.instanceMatrix.needsUpdate = true;
    if (d.instanceColor) d.instanceColor.needsUpdate = true;
  }
  // 一條線段上的虛線；walked＝之前已經走了多遠（讓整條路的虛線間距連續、越遠越淡）；回傳走到哪
  private dashes11(id: number, kind: number, ax: number, az: number, bx: number, bz: number, col: number, walked: number): number {
    const dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz), yaw = Math.atan2(-dz, dx), STEP = 0.3;
    if (len < 1e-6) return walked;
    let s = (STEP - (walked % STEP)) % STEP;
    for (; s < len && this.nd11 < DASH_CAP; s += STEP) {
      const fade = Math.max(0.3, 1 - (walked + s) / 14);
      this.dash11(id, kind, ax + (dx * s) / len, az + (dz * s) / len, 0.13, 0.045, yaw, col, fade);
    }
    return walked + len;
  }
  private dash11(id: number, kind: number, x: number, z: number, sx: number, sz: number, yaw: number, col: number, fade: number) {
    if (this.nd11 >= DASH_CAP) return;
    const m = this.tmp, dbg = this.dashDbg;
    m.position.set(x, 0.03, z); m.rotation.set(0, yaw, 0); m.scale.set(sx, 1, sz); m.updateMatrix();
    this.dash!.setMatrixAt(this.nd11, m.matrix);
    this.dash!.setColorAt(this.nd11, this.barColor.setHex(col).multiplyScalar(fade));
    dbg.x[dbg.n] = x; dbg.z[dbg.n] = z; dbg.kind[dbg.n] = kind; dbg.unit[dbg.n] = id; dbg.n++;
    this.nd11++;
  }
  get dashes() { return this.dash ? this.dash.count : 0; }


  // ======== R014 牆上的彈孔 ========
  private holes14(events: SimEvent[]) {
    const w = this.w, H = this.holes;
    for (const e of events) {
      if (e.e === 'impact' && e.kind === SHELL_AP && e.bld) {
        const b = w.blds[e.bld - 1], a = this.apSnap;
        if (!b || !this.visibleAt(e.x, e.z)) continue;          // 看不到的命中不留痕跡（方向會洩漏射手位置）
        for (let i = 0; i < a.n; i++) {
          if (a.bld[i] !== e.bld || a.ex[i] !== e.x || a.ez[i] !== e.z) continue;
          this.mark14(b, 0, a.sx[i] / SUB, a.sz[i] / SUB, e.x / SUB, e.z / SUB);
          break;
        }
      } else if (e.e === 'impact' && e.kind === SHELL_HE) {
        if (!this.visibleAt(e.x, e.z)) continue;
        const R = (e.r ?? UNIT_KINDS[UK_HOWITZER].splash) / SUB, ix = e.x / SUB, iz = e.z / SUB;
        for (const b of w.blds) {
          if (b.hp <= 0) continue;
          const cx = Math.max(b.x, Math.min(b.x + b.w, ix)), cz = Math.max(b.z, Math.min(b.z + b.d, iz));
          if (Math.hypot(cx - ix, cz - iz) > R + 0.5) continue;
          this.mark14(b, 1, ix, iz, b.x + b.w / 2, b.z + b.d / 2);
        }
      } else if (e.e === 'stage') {
        const b = w.blds[e.bld - 1];
        const keepBelow = e.stage === STAGE_RUBBLE ? -1 : wallHeight(b) * 0.72 * 0.7;   // 空殼的牆頂是鋸齒（七成到十成）
        for (let i = 0; i < HOLE_CAP; i++) if (H.live[i] && H.bld[i] === b.id && H.y[i] + H.h[i] / 2 * (wallShown(b) && H.kind[i] === 0 ? 1.55 : 1) > keepBelow) { H.live[i] = 0; this.holesDirty = true; }
      }
    }
    if (this.holesDirty) this.rebuild14();
  }

  // 從 (sx,sz) 往 (ex,ez) 的直線打進建築的牆（模型的牆內縮 0.1 格；教堂只算中殿），落在進入的那一面
  private mark14(b: Building, kind: number, sx: number, sz: number, ex: number, ez: number) {
    const { x0, x1, z0, z1 } = wallBounds(b);
    if (wallShown(b) && b.hp <= 0) return;
    const dx = ex - sx, dz = ez - sz;
    let tIn = -Infinity, tOut = Infinity, axis = -1;
    for (const [s0, d, lo, hi, ax] of [[sx, dx, x0, x1, 0], [sz, dz, z0, z1, 1]] as const) {
      if (Math.abs(d) < 1e-9) { if (s0 < lo || s0 > hi) return; continue; }
      let t1 = (lo - s0) / d, t2 = (hi - s0) / d;
      if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
      if (t1 > tIn) { tIn = t1; axis = ax; }
      tOut = Math.min(tOut, t2);
    }
    if (axis < 0 || tIn > tOut || tIn < 0) return;                 // 射手在牆裡面、或打不到這棟
    const seq = this.holeSeq++, hh = (k: number) => hash2(b.id * 977 + seq, k, 141);
    let px = sx + dx * tIn, pz = sz + dz * tIn;
    const nx = axis === 0 ? (dx > 0 ? -1 : 1) : 0, nz = axis === 1 ? (dz > 0 ? -1 : 1) : 0;
    // 沿牆面錯開一點（同一個方向連打不會疊成一個點），夾在牆面內
    if (axis === 0) pz = Math.max(z0 + 0.08, Math.min(z1 - 0.08, pz + (hh(1) - 0.5) * 0.3)); else px = Math.max(x0 + 0.08, Math.min(x1 - 0.08, px + (hh(1) - 0.5) * 0.3));
    const top = stageOf(b) === STAGE_INTACT ? wallHeight(b) : wallHeight(b) * 0.72 * 0.7;
    const H = this.holes, i = H.next;
    H.next = (H.next + 1) % HOLE_CAP;
    H.live[i] = 1; H.bld[i] = b.id; H.kind[i] = kind; H.x[i] = px; H.z[i] = pz; H.nx[i] = nx; H.nz[i] = nz;
    if (kind === 0) { H.w[i] = 0.13 + 0.05 * hh(2); H.h[i] = 0.1 + 0.04 * hh(3); H.y[i] = 0.1 + hh(4) * Math.max(0.02, top - 0.2); }
    else { H.w[i] = 0.28 + 0.12 * hh(2); H.h[i] = Math.min(0.24, top * 0.6); H.y[i] = H.h[i] / 2 + 0.01; }
    if (wallShown(b)) {
      // AP 外圈也必須留在窄牆端面／低矮缺口內，不能只夾住中心點。
      const scale = kind === 0 ? 1.55 : 1, lo = axis === 0 ? z0 : x0, hi = axis === 0 ? z1 : x1;
      H.w[i] = Math.min(H.w[i], (hi - lo - 0.012) / scale); H.h[i] = Math.min(H.h[i], (top - 0.012) / scale);
      const half = H.w[i] * scale / 2 + 0.006;
      if (axis === 0) H.z[i] = Math.max(lo + half, Math.min(hi - half, H.z[i])); else H.x[i] = Math.max(lo + half, Math.min(hi - half, H.x[i]));
      H.y[i] = Math.max(H.h[i] * scale / 2 + 0.006, Math.min(top - H.h[i] * scale / 2 - 0.006, H.y[i]));
    }
    const wall = bldColors(b.kind).wall;
    H.r[i] = wall.r + (1 - wall.r) * 0.35; H.g[i] = wall.g + (1 - wall.g) * 0.35; H.b[i] = wall.b + (1 - wall.b) * 0.35;   // 碎掉的灰泥：牆色偏亮
    this.holesDirty = true;
  }

  // 痕跡有變才重寫實例（不是每幀）：彈孔兩片（外圈淺色碎灰泥、裡面深色孔），燻黑一片
  private rebuild14() {
    const H = this.holes, m = this.tmp, mesh = this.holeMesh!;
    let n = 0;
    for (let k = 0; k < HOLE_CAP; k++) {
      const i = (H.next + k) % HOLE_CAP;                              // 從最舊的開始畫，新的疊在上面
      if (!H.live[i]) continue;
      const yaw = H.nx[i] ? (H.nx[i] > 0 ? Math.PI / 2 : -Math.PI / 2) : (H.nz[i] > 0 ? 0 : Math.PI);
      const layers = H.kind[i] === 0 ? 2 : 1;
      for (let l = 0; l < layers; l++) {
        const off = 0.006 + 0.003 * l, sc = H.kind[i] === 0 && l === 0 ? 1.55 : 1;
        m.position.set(H.x[i] + H.nx[i] * off, H.y[i], H.z[i] + H.nz[i] * off); m.rotation.set(0, yaw, 0); m.scale.set(H.w[i] * sc, H.h[i] * sc, 1); m.updateMatrix();
        mesh.setMatrixAt(n, m.matrix);
        if (H.kind[i] === 1) this.barColor.setHex(C_SOOT); else if (l === 0) this.barColor.setRGB(H.r[i], H.g[i], H.b[i]); else this.barColor.setHex(C_HOLE);
        mesh.setColorAt(n, this.barColor);
        n++;
      }
    }
    mesh.count = n; mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    this.holesDirty = false;
  }
  get risingCount() { return this.rising.size; }
  get ghostCount() { return this.ghosts ? this.ghosts.count : 0; }
  get holeCount() { let c = 0; for (let i = 0; i < HOLE_CAP; i++) c += this.holes.live[i]; return c; }
  get holeInstances() { return this.holeMesh ? this.holeMesh.count : 0; }


  // ======== R021 步兵班 ========
  // 一班畫成 6 個小兵（兩排三列，跟著前進方向）；人數＝血量 ÷ 10 無條件進位；少了的人留在原地倒下
  private squad21(u: Unit, x: number, z: number, t: number, col: THREE.Color, n: number): number {
    const k = UNIT_KINDS[u.kind], men = u.alive ? Math.min(k.men, Math.ceil((u.hp * k.men) / k.hp)) : 0;
    const yaw = this.yaw[u.id], cy = Math.cos(yaw), sy = Math.sin(yaw), y = this.unitHeight(u), moving = u.pathIdx < u.path.length;
    const last = this.lastMen[u.id] < 0 ? men : this.lastMen[u.id];
    for (let i = men; i < last; i++) {   // 剛倒下的人：留一個躺著的在他的位置
      const [ax, az] = SLOTS[i], bx = x + ax * cy + az * sy, bz = z - ax * sy + az * cy, B = this.bodies, j = B.next;
      B.x[j] = bx; B.z[j] = bz; B.y[j] = y; B.yaw[j] = yaw + (i - 2.5) * 0.7; B.side[j] = u.side;
      B.next = (B.next + 1) % BODY_CAP; B.n = Math.min(BODY_CAP, B.n + 1);
    }
    this.lastMen[u.id] = men;
    const m = this.tmp, aim = Math.atan2(-u.aimZ, u.aimX), scale = y > 0 ? 0.75 : 1;   // 屋頂上站得擠一點
    for (let i = 0; i < men && n < MEN_CAP; i++) {
      const [ax, az] = SLOTS[i], bob = moving ? 0.012 * Math.abs(Math.sin(t * 11 + i * 1.7)) : 0;
      m.position.set(x + (ax * cy + az * sy) * scale, y + bob, z + (-ax * sy + az * cy) * scale);
      m.rotation.set(0, moving ? yaw : aim, 0); m.scale.setScalar(1); m.updateMatrix();
      this.men.setMatrixAt(n, m.matrix); this.men.setColorAt(n, col); n++;
    }
    this.menDbg.alive += men;
    return n;
  }
  // R022 迫擊砲的兩個砲手：蹲在砲後面（共用小兵網格；血少於一半剩一個）
  private crew22(u: Unit, x: number, z: number, col: THREE.Color, n: number): number {
    const k = UNIT_KINDS[u.kind], men = u.hp * 2 > k.hp ? 2 : 1, aim = Math.atan2(-u.aimZ, u.aimX), ca = Math.cos(aim), sa = Math.sin(aim), m = this.tmp;
    for (let i = 0; i < men && n < MEN_CAP; i++) {
      const ax = -0.2, az = i ? 0.13 : -0.13;
      m.position.set(x + ax * ca + az * sa, 0, z - ax * sa + az * ca); m.rotation.set(0, aim, 0); m.scale.set(1, i ? 0.8 : 1, 1); m.updateMatrix();
      this.men.setMatrixAt(n, m.matrix); this.men.setColorAt(n, col); n++;
    }
    return n;
  }
  private bodies21(n: number): number {
    const B = this.bodies, m = this.tmp;
    for (let k = 0; k < B.n && n < MEN_CAP; k++) {
      const j = (B.next - B.n + k + BODY_CAP) % BODY_CAP;
      if (B.side[j] !== SIDE_PLAYER && !this.visibleAt(B.x[j] * SUB, B.z[j] * SUB)) continue;   // 敵方的屍體在霧裡不畫
      m.position.set(B.x[j], B.y[j] + 0.03, B.z[j]); m.rotation.set(0, B.yaw[j], Math.PI / 2); m.scale.setScalar(1); m.updateMatrix();
      this.men.setMatrixAt(n, m.matrix); this.men.setColorAt(n, C_BODY[B.side[j]]); n++;
    }
    return n;
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
    this.target.x = Math.max(0, Math.min(this.n, this.target.x)); this.target.z = Math.max(0, Math.min(this.n, this.target.z));
  }
  zoomBy(f: number) { this.zoom = Math.max(0.55, Math.min(3, this.zoom * f)); }
  // R012：縮放時 (cssX,cssY) 底下的地面點不動（正交鏡頭、方向固定：縮放後把焦點平移回來）
  zoomAt(f: number, cssX: number, cssY: number, cssW: number, cssH: number) {
    const a = this.groundAt(cssX, cssY, cssW, cssH);
    this.zoomBy(f);
    const b = this.groundAt(cssX, cssY, cssW, cssH);
    if (!a || !b) return;
    this.target.x = Math.max(0, Math.min(this.n, this.target.x + a.x - b.x));
    this.target.z = Math.max(0, Math.min(this.n, this.target.z + a.z - b.z));
  }

  // 螢幕點 → 點到的建築格（先打建築的網格：點屋頂、牆面都算那棟；瓦礫不算）
  buildingAt(cssX: number, cssY: number, cssW: number, cssH: number): [number, number] | null {
    this.layout(cssW, cssH);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2((cssX / cssW) * 2 - 1, -(cssY / cssH) * 2 + 1), this.cam);
    for (const hit of ray.intersectObject(this.town, false)) {
      // 沿著視線往內推一點再取格，避免剛好落在牆面外緣的格線上
      const p = hit.point.clone().addScaledVector(ray.ray.direction, 0.02);
      const x = Math.floor(p.x), z = Math.floor(p.z);
      if (!inGrid(this.w, x, z)) continue;
      const id = this.w.occ[cellIdx(this.w, x, z)];
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
    // R004 鏡頭震動：只加在畫面這一趟（點選用的 layout() 會重排鏡頭，不受影響）；幅度 ≤ 0.08 格、0.4 秒內衰減
    const k = (this.lastT - this.shakeT0) / 0.4;
    if (this.r4 && k >= 0 && k < 1) {
      const a = this.shakeAmp * (1 - k) * (1 - k), ph = this.shakeT0 * 13.7;
      this.cam.position.x += a * Math.sin(this.lastT * 71 + ph);
      this.cam.position.y += a * 0.6 * Math.sin(this.lastT * 53 + ph * 2);
      this.cam.position.z += a * Math.cos(this.lastT * 67 + ph);
      this.cam.updateMatrixWorld();
    }
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
    this.multi122.texture.dispose();
    this.groundTex.dispose(); this.ramp.dispose(); this.pipe.dispose();
    this.scene.clear();
  }

  // 守衛用：場景裡的建築三角形數
  get armorArcCount() { return this.armorArcs?.count ?? 0; }

  get townTriangles() { return this.town.geometry.attributes.position.count / 3; }
}

