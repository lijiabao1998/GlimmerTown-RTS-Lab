// R098 地面貼圖只傳改過的格列（只改效能：顯示卡上的貼圖跟整張上傳的逐位一樣）。
// paintCell 每畫一格就記下它那一格列的 [最小 x, 最大 x]；render() 之前每一個改過的格列用 copyTextureToTexture 傳一個 PX 像素高的矩形。
// 為什麼不用 Texture.addUpdateRange：three r186 一段只傳一列像素（WebGLTextures.js 寫死 height＝1），一段跨列會 GL 錯誤、整段沒傳；
// 一格要 8 次呼叫，量到跟整張一樣貴。copyTextureToTexture 從一張「沒畫過、沒上傳過」的 DataTexture（跟 groundTex 共用 groundPx）
// 走 CPU 那一支：一次 texSubImage2D(寬×高)、UNPACK_ROW_LENGTH＝整張的寬。暫存一旦被 renderer 認得（畫過或 initTexture），
// three 就改走 GPU 複製、從一張空貼圖複製過來，所以暫存只在這裡用、永遠不交給別人。
// 什麼時候整張：建構、換世界（full）；改過的格列超過 n/4；閥關著（?noR098=1）。整張還沒真的傳之前加進來的格列不送（three 畫的時候整張傳的是同一份 groundPx）。
import * as THREE from 'three';
import { view98 } from './view98.ts';

export class GroundUpload98 {
  private n = 0;
  private px = 8;
  private lo = new Int32Array(0);
  private hi = new Int32Array(0);
  private rows: number[] = [];
  private stage: THREE.DataTexture | null = null;
  private fullPending = true;
  private box = new THREE.Box2();
  private at = new THREE.Vector2();
  uploads = 0;   // 守衛與量測用：上傳了幾個矩形

  // sizeTo 換了 groundPx（新的地圖大小）：暫存跟著換
  resize(n: number, px: number, groundPx: Uint8Array): void {
    this.n = n; this.px = px;
    this.lo = new Int32Array(n); this.hi = new Int32Array(n).fill(-1); this.rows = [];
    this.stage = new THREE.DataTexture(groundPx, n * px, n * px);
    this.fullPending = true;
  }
  // paintCell 每畫一格叫一次
  mark(x: number, z: number): void {
    if (this.hi[z] < 0) { this.rows.push(z); this.lo[z] = x; this.hi[z] = x; return; }
    if (x < this.lo[z]) this.lo[z] = x;
    if (x > this.hi[z]) this.hi[z] = x;
  }
  // 整張（建構、換世界）：三在畫的時候整張傳
  full(tex: THREE.Texture): void {
    tex.needsUpdate = true; this.fullPending = true; this.clear();
  }
  // 畫完一批格（事件、履帶）：閥關著或改太多就整張，不然留到 render 前一列一列傳
  dirty(tex: THREE.Texture): void {
    if (!view98() || this.rows.length * 4 > this.n) this.full(tex);
  }
  // render() 一開始叫：把留著的格列傳上去
  flush(renderer: THREE.WebGLRenderer, tex: THREE.Texture): void {
    if (this.fullPending) { this.fullPending = false; this.clear(); return; }
    if (!this.rows.length || !this.stage) return;
    const p = this.px;
    for (const z of this.rows) {
      this.box.min.set(this.lo[z] * p, z * p); this.box.max.set((this.hi[z] + 1) * p, z * p + p); this.at.set(this.lo[z] * p, z * p);
      renderer.copyTextureToTexture(this.stage, tex, this.box, this.at); this.uploads++;
    }
    this.clear();
  }
  // 守衛用：留著還沒傳的矩形（像素座標：[x0, y0, x1, y1)）
  pending(): [number, number, number, number][] {
    const p = this.px;
    return this.fullPending ? [] : this.rows.map(z => [this.lo[z] * p, z * p, (this.hi[z] + 1) * p, z * p + p]);
  }
  get full98(): boolean { return this.fullPending; }
  private clear(): void { for (const z of this.rows) this.hi[z] = -1; this.rows.length = 0; }
}
