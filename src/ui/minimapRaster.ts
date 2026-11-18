// R090 小地圖的點陣畫法（只在 n ≥ 128：地圖 5 海斯）：一格一個像素寫進 n×n 的點陣，再用一個仿射變換一次 drawImage 成菱形。
// 舊的畫法每格一個菱形路徑（128 圖 16,384 個），重畫一次要十幾毫秒；地圖 0–4（n < 128）照舊一格一格畫，像素不變。
// 菱形：px = w/2 + (x − z)·s、py = (x + z)·s/2（minimap.ts 的 toMini）＝ setTransform(s, s/2, −s, s/2, w/2, 0)，再乘 dpr。
export const RASTER_N = 128;
export const useRaster = (n: number): boolean => n >= RASTER_N;

const rgb = (hex: string): [number, number, number] => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];

export class MiniRaster {
  private cvs: HTMLCanvasElement | null = null;
  private img: ImageData | null = null;
  private cache = new Map<string, [number, number, number]>();
  // 每一格的顏色（跟舊畫法同一份 fillStyle），寫進點陣
  begin(n: number): void {
    if (!this.cvs) this.cvs = document.createElement('canvas');
    if (this.cvs.width !== n) { this.cvs.width = n; this.cvs.height = n; this.img = null; }
    if (!this.img) this.img = this.cvs.getContext('2d')!.createImageData(n, n);
  }
  put(i: number, color: string): void {
    let c = this.cache.get(color);
    if (!c) this.cache.set(color, c = rgb(color));
    const d = this.img!.data, o = i * 4;
    d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; d[o + 3] = 255;
  }
  // 一次畫成菱形。要平滑：手機上小地圖一格常常不到 1.5 個像素，不平滑（取最近的那一格）會有一成到一半的格一個像素都沒有——
  // 圓形砲塔、碉堡、一半的路會不見；舊畫法每格一個反鋸齒的菱形，至少混進一個像素。'high' 在縮小時多看幾格（審查 2026-11-18）
  draw(ctx: CanvasRenderingContext2D, g: { w: number; s: number }, dpr: number): void {
    const cvs = this.cvs!;
    cvs.getContext('2d')!.putImageData(this.img!, 0, 0);
    ctx.save();
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.setTransform(g.s * dpr, (g.s / 2) * dpr, -g.s * dpr, (g.s / 2) * dpr, (g.w / 2) * dpr, 0);
    ctx.drawImage(cvs, 0, 0);
    ctx.restore();
  }
}
