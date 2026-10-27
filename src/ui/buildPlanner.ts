// R062 布陣計畫：玩家這一局要蓋的房子、圍牆、鐵絲網、戰壕；點地面放下或拿掉、建材、提示文字、布陣列的狀態與按鈕。
// 原本整段寫在 main.ts 裡；搬出來後 main.ts 只接線，守衛直接建這個類別測，不再切 main.ts 的原文。
// 預覽＝真的世界的複本套上計畫（同一支 applyBuild／applyTrench，規則只有一份）；計畫本身不碰真的世界。
import { SIDE_PLAYER, BK_COTTAGE, BK_WIRE, BK_WALL_BRICK, BK_WALL_STONE, BK_WALL_CONCRETE, isWallKind, bldMaxHp, type World } from '../sim/world.ts';
import { BUILD_KINDS, BUILD_KINDS_24, WIRE_KIND, WALL_KINDS, BUILD_POINTS, applyBuild, buildError, buildKind, type BuildCmd } from '../sim/build.ts';
import { TRENCH_KINDS, trenchKind, trenchCells, trenchError, applyTrench, type TrenchCmd } from '../sim/trenches.ts';
import { materialBuildDetail } from './materials.ts';

export type PlanCmd = BuildCmd | TrenchCmd;
export const TRENCH_LABEL = ['直段', '折線', '交通壕', '加固段'];
export const TRENCH_SHAPE = ['2格直線', '3格L形', '4格直線', '2格加固'];
export const BUILD_LABEL: Record<number, string> = { [BUILD_KINDS[0].kind]: '農舍', [BUILD_KINDS[1].kind]: '磚房', [BUILD_KINDS[2].kind]: '穀倉', [BUILD_KINDS_24[3].kind]: '碉堡', [BK_WALL_BRICK]: '矮磚牆', [BK_WALL_STONE]: '石牆', [BK_WALL_CONCRETE]: '混凝土牆', [BK_WIRE]: '鐵絲網' };
export const BUILD_TIP = '布陣：點藍色地面蓋房子當掩體、擋視線；點蓋好的房子拿掉；蓋好按「開戰」';
// 不能蓋的原因（buildError／trenchError 回的代碼）→ 給玩家看的話；有戰壕選項時「已佔用」也提戰壕
export function buildWhy(trenches: boolean): Record<string, string> {
  return {
    tick: '已經開戰，不能再蓋', map: '超出地圖', foreign: '那是敵方半場（紅色）；只能蓋在我方半場（藍色）',
    neutral: '那是中間的無人帶；只能蓋在我方半場（藍色）', mud: '不能蓋在泥灘上', road: '不能蓋在路上', occupied: trenches ? '那裡已有房子或戰壕' : '那裡已經有房子',
    trench: '那裡已經有戰壕', unit: '有單位站在那裡', blocked: '會堵死通路', gap: '太靠近別的房子（要隔一格）',
  };
}

// 計畫要用到的外部東西：真的世界、畫面（換預覽、點選、標記）、現在是不是布陣、重畫
export interface PlannerEnv {
  world(): World;
  view(): {
    setWorld(w: World, side: number): void;
    buildingAt(cx: number, cy: number, width: number, height: number): [number, number] | null;
    groundAt(cx: number, cy: number, width: number, height: number): { x: number; z: number } | null;
    setMarker(x: number, z: number, t: number, bad: boolean): void;
  };
  building(): boolean;       // phase === 'build'
  simT(): number;
  ui(): void;                // 全部介面更新（布陣列、HUD……）
  hud(): void;               // 只更新 HUD
  size(): [number, number];  // 畫面寬高（點選換算用）
}
type BuildKindDef = { kind: number; w: number; d: number; floors: number; cost: number };
// 布陣列的開關：哪些選項出現、說明要不要材質
export interface PlannerOptions { trenches: boolean; walls: boolean; wire: boolean; materials: boolean; kinds: BuildKindDef[] }

export class BuildPlanner {
  plan: PlanCmd[] = [];
  pickKind = BK_COTTAGE;
  pickRot = 0;
  pickTrench = -1;
  trenchRot = 0;
  buildHint = '';
  readonly why: Record<string, string>;
  private readonly env: PlannerEnv;
  readonly opts: PlannerOptions;
  constructor(env: PlannerEnv, opts: PlannerOptions) { this.env = env; this.opts = opts; this.why = buildWhy(opts.trenches); }

  // 新的一局：前一局的計畫與提示都丟掉（選中的種類、方向留著）
  clear() { this.plan = []; this.buildHint = ''; }

  previewWorld(): World {
    const pv = structuredClone(this.env.world());
    for (const c of this.plan) { if (c.t === 'trench') applyTrench(pv, c); else applyBuild(pv, c); }
    pv.events = [];
    return pv;
  }
  refreshPreview() { if (this.env.building()) this.env.view().setWorld(this.previewWorld(), SIDE_PLAYER); }
  pointsLeft(): number { return BUILD_POINTS - this.plan.reduce((p, c) => p + ((c.t === 'trench' ? trenchKind(c.kind) : buildKind(c.kind))?.cost ?? 0), 0); }

  placeAt(cx: number, cy: number) {
    const { env } = this, view = env.view(), [width, height] = env.size(), w = env.world();
    // 點到已經放好的房子＝拿掉它（只認這次布陣的，地圖上原本的房子不算）
    const hitB = view.buildingAt(cx, cy, width, height);
    if (hitB) {
      const k = this.plan.findIndex(c => { if (c.t !== 'build') return false; const kd = buildKind(c.kind)!, fw = c.rot ? kd.d : kd.w, fd = c.rot ? kd.w : kd.d; return hitB[0] >= c.x && hitB[1] >= c.z && hitB[0] < c.x + fw && hitB[1] < c.z + fd; });
      if (k >= 0) { this.plan.splice(k, 1); this.buildHint = '拿掉了一棟'; this.refreshPreview(); env.ui(); return; }
    }
    const p = view.groundAt(cx, cy, width, height);
    if (!p) return;
    const gx = Math.floor(p.x), gz = Math.floor(p.z);
    if (gx < 0 || gz < 0 || gx >= w.n || gz >= w.n) return;
    // 圍牆模型窄於佔地：點任一佔地格仍能拿掉整段，不必精準命中薄牆表面。
    const wallIndex = this.plan.findIndex(c => { if (c.t !== 'build' || !(isWallKind(c.kind) || c.kind === BK_WIRE)) return false; const kd = buildKind(c.kind)!, fw = c.rot ? kd.d : kd.w, fd = c.rot ? kd.w : kd.d; return gx >= c.x && gz >= c.z && gx < c.x + fw && gz < c.z + fd; });
    if (wallIndex >= 0) { this.plan.splice(wallIndex, 1); this.buildHint = '拿掉了一段障礙'; this.refreshPreview(); env.ui(); return; }
    // 一段壕溝的任一實際格都能拿掉整段；L形空角不是戰壕。
    const trenchIndex = this.plan.findIndex(c => c.t === 'trench' && trenchCells(c).some(([x, z]) => x === gx && z === gz));
    if (trenchIndex >= 0) { this.plan.splice(trenchIndex, 1); this.buildHint = '拿掉了一段戰壕'; this.refreshPreview(); env.ui(); return; }
    const kd = buildKind(this.pickKind)!, rot = kd.w !== kd.d ? this.pickRot : 0;
    const cmd: PlanCmd = this.pickTrench >= 0
      ? { t: 'trench', side: SIDE_PLAYER, kind: this.pickTrench, x: gx, z: gz, rot: this.trenchRot }
      : { t: 'build', side: SIDE_PLAYER, kind: this.pickKind, x: gx, z: gz, ...(rot ? { rot } : {}) };
    const label = cmd.t === 'trench' ? TRENCH_LABEL[cmd.kind] : BUILD_LABEL[cmd.kind];
    const cost = cmd.t === 'trench' ? trenchKind(cmd.kind)!.cost : kd.cost;
    const pv = this.previewWorld(), err = cmd.t === 'trench' ? trenchError(pv, cmd) : buildError(pv, cmd);
    if (err) {
      this.buildHint = err === 'points' ? `建材不夠（剩 ${this.pointsLeft()}，${label}要 ${cost}）` : this.why[err] ?? '這裡不能蓋';
      view.setMarker(gx + 0.5, gz + 0.5, env.simT(), true);
    } else {
      this.plan.push(cmd); this.buildHint = `${label}蓋好了，剩建材 ${this.pointsLeft()}`;
      view.setMarker(gx + 0.5, gz + 0.5, env.simT(), false);
      this.refreshPreview();
    }
    env.ui();
  }

  // ---- 布陣列（src/ui/build.ts 的 initBuildBar）要的四樣：房子選項、按鈕動作、戰壕選項、圍牆選項 ----
  barItems() {
    const { opts } = this;
    return [...(opts.wire ? [WIRE_KIND] : []), ...opts.kinds].map(k => ({ kind: k.kind, label: BUILD_LABEL[k.kind], cost: k.cost, ...(k.kind === BK_WIRE ? { detail: `建材 ${k.cost} · 耐久 ${bldMaxHp(k.kind, k.w, k.d, k.floors)} · 徒步繞行／車輛通過 · 不擋射線、不提供掩護 · 榴彈砲可清除` } : opts.materials ? { detail: materialBuildDetail(k.kind, k.w, k.d, k.floors) } : {}) }));
  }
  barActions(start: () => void) {
    const { env } = this;
    return {
      state: () => {
        const kd = buildKind(this.pickKind)!;
        return { visible: env.building(), kind: this.pickKind, trench: this.pickTrench >= 0 ? this.pickTrench : undefined, rot: this.pickTrench >= 0 ? this.trenchRot : this.pickRot, rotatable: this.pickTrench >= 0 || kd.w !== kd.d, left: this.pointsLeft(), total: BUILD_POINTS, planned: this.plan.length };
      },
      pick: (kind: number) => { this.pickTrench = -1; this.pickKind = kind; this.buildHint = `${BUILD_LABEL[kind]}（建材 ${buildKind(kind)!.cost}）：點藍色地面放下`; env.hud(); },
      pickTrench: (kind: number) => { this.pickTrench = kind; this.trenchRot = 0; this.buildHint = `${TRENCH_LABEL[kind]}（建材 ${trenchKind(kind)!.cost}）：點藍色地面放下；再點任一壕格整段移除`; env.hud(); },
      rotate: () => { if (this.pickTrench >= 0) this.trenchRot = (this.trenchRot + 1) % 4; else this.pickRot = 1 - this.pickRot; env.hud(); },
      undo: () => { if (this.plan.pop()) { this.buildHint = '拿掉了最後一項'; this.refreshPreview(); env.hud(); } },
      start,
    };
  }
  barTrenches() { return this.opts.trenches ? TRENCH_KINDS.map(k => ({ kind: k.kind, label: TRENCH_LABEL[k.kind], cost: k.cost, detail: `${TRENCH_SHAPE[k.kind]} · 建材 ${k.cost} · 承傷 ${k.cover}%` })) : []; }
  barWalls() { return this.opts.walls ? WALL_KINDS.map(k => ({ kind: k.kind, label: BUILD_LABEL[k.kind], cost: k.cost, detail: `建材 ${k.cost} · 耐久 ${bldMaxHp(k.kind, k.w, k.d, k.floors)} · 可破壞建築 · 不可射越 · 可駐守` })) : []; }
}
