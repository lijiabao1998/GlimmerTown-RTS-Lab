// R109：只管理新增手勢的暫態；既有平移／捏合仍由 main 處理。時鐘可替換以精確驗邊界。
export interface GesturePoint {
  pointerId: number; pointerType: string; button: number; shiftKey: boolean;
  clientX: number; clientY: number;
}
export interface SelectionRect { left: number; top: number; right: number; bottom: number }
export interface GestureClock { set: (fn: () => void, ms: number) => unknown; clear: (id: unknown) => void }
export interface GestureActions {
  enabled: () => boolean;
  box: (rect: SelectionRect | null) => void;
  select: (rect: SelectionRect) => void;
  hold: (x: number, y: number) => void;
  dismiss: () => void;
  touchBox?: () => boolean; // R901：框選開著時，停住仍長按；拖過 8px 才改走框選
}
interface Candidate { id: number; kind: 'box' | 'hold'; x: number; y: number; cx: number; cy: number; started: boolean }
const rectangle = (c: Candidate): SelectionRect => ({ left: Math.min(c.x, c.cx), top: Math.min(c.y, c.cy), right: Math.max(c.x, c.cx), bottom: Math.max(c.y, c.cy) });
export const inSelectionRect = (r: SelectionRect, x: number, y: number) => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;

export class Gestures {
  private actions: GestureActions;
  private clock: GestureClock;
  private points = new Set<number>();
  private consumed = new Set<number>();
  private dismissOnly = new Set<number>();
  private candidate: Candidate | null = null;
  private timer: unknown = null;
  constructor(actions: GestureActions, clock: GestureClock = { set: (fn, ms) => setTimeout(fn, ms), clear: id => clearTimeout(id as ReturnType<typeof setTimeout>) }) {
    this.actions = actions; this.clock = clock;
  }
  private clearCandidate() {
    if (this.timer !== null) this.clock.clear(this.timer);
    this.timer = null; this.candidate = null; this.actions.box(null);
  }
  down(e: GesturePoint, dismissOnly = false) {
    this.points.add(e.pointerId);
    if (this.points.size > 1) {
      this.clearCandidate(); this.actions.dismiss();
      for (const id of this.points) this.consumed.add(id);
      this.dismissOnly.clear();
      return;
    }
    if (dismissOnly) { this.dismissOnly.add(e.pointerId); this.consumed.add(e.pointerId); return; }
    if (!this.actions.enabled()) return;
    const kind = e.pointerType === 'mouse' && e.button === 0 && e.shiftKey ? 'box' : e.pointerType === 'touch' ? 'hold' : null;
    if (!kind) return;
    const c: Candidate = { id: e.pointerId, kind, x: e.clientX, y: e.clientY, cx: e.clientX, cy: e.clientY, started: false };
    this.candidate = c;
    if (kind === 'hold') this.timer = this.clock.set(() => {
      this.timer = null;
      if (this.candidate !== c || this.points.size !== 1 || !this.actions.enabled()) return;
      c.started = true; this.consumed.add(c.id); this.actions.hold(c.cx, c.cy);
    }, 500);
  }
  move(e: GesturePoint): boolean {
    if (this.dismissOnly.has(e.pointerId)) return true;
    const c = this.candidate;
    if (!c || c.id !== e.pointerId) {
      // 捏合後剩下一指繼續拖曳：回到原本平移／慣性；沒再移動則仍吞掉放手的 tap。
      if (this.points.size === 1) this.consumed.delete(e.pointerId);
      return false;
    }
    c.cx = e.clientX; c.cy = e.clientY;
    const moved = Math.hypot(c.cx - c.x, c.cy - c.y) > 8;
    if (c.kind === 'box') {
      if (moved) c.started = true;
      if (c.started) { this.consumed.add(c.id); this.actions.box(rectangle(c)); }
      return true;
    }
    // 框選開著：先當長按，手指真正拖過 8px 才改成框，不再平移。
    if (c.kind === 'hold' && moved && !c.started && this.actions.touchBox?.()) {
      if (this.timer !== null) { this.clock.clear(this.timer); this.timer = null; }
      c.kind = 'box'; c.started = true; this.consumed.add(c.id); this.actions.box(rectangle(c));
      return true;
    }
    if (moved) { this.consumed.delete(c.id); this.clearCandidate(); this.actions.dismiss(); return false; }
    return c.started;
  }
  up(e: GesturePoint): boolean {
    // pointerup is allowed to carry the last movement without an intervening pointermove.
    const before = this.candidate;
    const releaseDrag = before?.id === e.pointerId && before.kind === 'hold' && Math.hypot(e.clientX - before.x, e.clientY - before.y) > 8;
    if (this.candidate?.id === e.pointerId) this.move(e);
    const c = this.candidate;
    let used = this.consumed.has(e.pointerId) || releaseDrag;
    if (c?.id === e.pointerId) {
      if (c.kind === 'box' && c.started) { this.actions.select(rectangle(c)); used = true; }
      this.clearCandidate();
    }
    this.points.delete(e.pointerId); this.consumed.delete(e.pointerId); this.dismissOnly.delete(e.pointerId);
    return used;
  }
  cancel() {
    this.clearCandidate(); this.points.clear(); this.consumed.clear(); this.dismissOnly.clear(); this.actions.dismiss();
  }
}
