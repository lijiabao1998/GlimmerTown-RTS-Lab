// R012 鏡頭手感的數學（不碰 DOM、不碰世界；Node 守衛直接測）。
// 慣性：放手時的速度指數衰減 v(t)=v0·e^(−kt)，每幀用精確積分，跟幀率無關；總滑行距離＝v0/k。
export const FLING_DECAY = 6;          // k（1/秒）：總滑行＝放手速度 × 1/6 秒
export const FLING_STOP_RATIO = 0.04;  // 速度掉到放手時的 4% 以下就停（ln 25 / 6 ≈ 0.54 秒）

export class Fling {
  vx = 0; vz = 0;
  private v0 = 0;
  get active(): boolean { return this.vx !== 0 || this.vz !== 0; }
  start(vx: number, vz: number) { this.vx = vx; this.vz = vz; this.v0 = Math.hypot(vx, vz); }
  stop() { this.vx = 0; this.vz = 0; }
  // 這一幀要移多少（同單位：每秒 → 這一幀）
  step(dt: number, out: { x: number; z: number }): { x: number; z: number } {
    if (!this.active || dt <= 0) { out.x = 0; out.z = 0; return out; }
    const e = Math.exp(-FLING_DECAY * dt), k = (1 - e) / FLING_DECAY;
    out.x = this.vx * k; out.z = this.vz * k;
    this.vx *= e; this.vz *= e;
    if (Math.hypot(this.vx, this.vz) < this.v0 * FLING_STOP_RATIO) this.stop();
    return out;
  }
}

// 平滑移動：dur 秒內用 smoothstep 從 from 移到 to
export const GLIDE_S = 0.4;
export class Glide {
  private fx = 0; private fz = 0; private tx = 0; private tz = 0; private t0 = -1;
  get active(): boolean { return this.t0 >= 0; }
  start(fx: number, fz: number, tx: number, tz: number, t: number) { this.fx = fx; this.fz = fz; this.tx = tx; this.tz = tz; this.t0 = t; }
  stop() { this.t0 = -1; }
  at(t: number, out: { x: number; z: number }): { x: number; z: number } {
    const k = Math.min(1, Math.max(0, (t - this.t0) / GLIDE_S)), e = k * k * (3 - 2 * k);
    out.x = this.fx + (this.tx - this.fx) * e; out.z = this.fz + (this.tz - this.fz) * e;
    if (k >= 1) this.stop();
    return out;
  }
}
