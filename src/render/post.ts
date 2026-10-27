// 後製：場景先畫進（低解析度的）render target，再用全螢幕四邊形放大到畫面；描邊＝深度跳變，量化＝sRGB 每色版壓成有限階數。
// 改寫自 GlimmerTown3D-lab@bece722 src/render/post.ts（拿掉天空色帶與天氣，其餘算法相同）。
import * as THREE from 'three';

export interface Style {
  pixelCss: number;   // 每個渲染像素佔幾個 CSS 像素（>1＝低解析度＋最近鄰放大）
  outline: boolean;
  quant: number;      // 調色盤量化階數（0＝不量化）
  msaa?: number;      // R065 渲染目標的多重取樣數（0＝不取樣＝?noR065=1）；實際不超過顯示卡上限
}

// 3D-lab 的畫風 A 是 pixelCss 3。RTS 的單位比建築小很多，預設先用 2（業主未定，見 docs/DECISIONS.md），網址 ?px=3 可以對照。
export const STYLE_A: Style = { pixelCss: 2, outline: true, quant: 12, msaa: 4 };

// R065：渲染目標要幾倍取樣——設定值，但不超過顯示卡上限（WebGL2 的 MAX_SAMPLES）；軟體繪圖不取樣
export function msaaSamples(style: Style, maxSamples: number, software = false): number {
  return software ? 0 : Math.max(0, Math.min(style.msaa ?? 0, maxSamples | 0));
}
// 軟體繪圖＝沒有能用的顯示卡時瀏覽器的備援（SwiftShader、llvmpipe…）：多邊形全靠 CPU 畫，4 倍取樣每幀貴兩成；真的顯示卡上幾乎不花時間
export function softwareRenderer(name: string): boolean {
  return /swiftshader|llvmpipe|softpipe|software/i.test(name);
}
function rendererName(renderer: THREE.WebGLRenderer): string {
  const gl = renderer.getContext?.();
  if (!gl) return '';
  let name = String(gl.getParameter(gl.RENDERER));
  if (/webkit webgl/i.test(name)) { const ext = gl.getExtension('WEBGL_debug_renderer_info'); if (ext) name = String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)); }   // Chrome 把真名藏在這個擴充裡
  return name;
}

const FRAG = /* glsl */ `
uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform vec2 texel;
uniform float outline;
uniform float quant;
uniform float depthRange;
varying vec2 vUv;
void main() {
  vec4 c = texture2D(tColor, vUv);
  if (outline > 0.5) {
    float d = texture2D(tDepth, vUv).r;
    float e = 0.0;
    e = max(e, abs(d - texture2D(tDepth, vUv + vec2(texel.x, 0.0)).r));
    e = max(e, abs(d - texture2D(tDepth, vUv - vec2(texel.x, 0.0)).r));
    e = max(e, abs(d - texture2D(tDepth, vUv + vec2(0.0, texel.y)).r));
    e = max(e, abs(d - texture2D(tDepth, vUv - vec2(0.0, texel.y)).r));
    if (e * depthRange > 0.35) c.rgb *= 0.34;
  }
  gl_FragColor = c;
  #include <colorspace_fragment>
  if (quant > 0.5) gl_FragColor.rgb = floor(gl_FragColor.rgb * quant + 0.5) / quant;
}`;

export class Pipeline {
  private rt: THREE.WebGLRenderTarget;
  private quadScene = new THREE.Scene();
  private quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private mat: THREE.ShaderMaterial;
  sceneInfo = { calls: 0, triangles: 0 };
  private software: boolean | null = null;   // R065：第一次畫時看一次是不是軟體繪圖

  constructor() {
    this.rt = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: true });
    this.rt.depthTexture = new THREE.DepthTexture(1, 1);
    this.rt.texture.magFilter = this.rt.texture.minFilter = THREE.NearestFilter;
    this.rt.texture.generateMipmaps = false;
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        tColor: { value: this.rt.texture }, tDepth: { value: this.rt.depthTexture },
        texel: { value: new THREE.Vector2() }, outline: { value: 0 }, quant: { value: 0 }, depthRange: { value: 1 },
      },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: FRAG,
      depthTest: false, depthWrite: false,
    });
    this.quadScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat));
  }

  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, cam: THREE.OrthographicCamera, style: Style, cssW: number, cssH: number, dpr: number) {
    const w = style.pixelCss > 1 ? Math.max(1, Math.floor(cssW / style.pixelCss)) : Math.max(1, Math.floor(cssW * dpr));
    const h = style.pixelCss > 1 ? Math.max(1, Math.floor(cssH / style.pixelCss)) : Math.max(1, Math.floor(cssH * dpr));
    if (this.rt.width !== w || this.rt.height !== h) this.rt.setSize(w, h);
    // R065：畫之前確認取樣數；變了才重建渲染目標（釋放後這一次畫就照新取樣數重配；深度一樣解析出來給描邊用）
    this.software ??= softwareRenderer(rendererName(renderer));
    const samples = msaaSamples(style, renderer.capabilities.maxSamples, this.software);
    if (this.rt.samples !== samples) { this.rt.samples = samples; this.rt.dispose(); }
    renderer.setRenderTarget(this.rt);
    renderer.render(scene, cam);
    // three.js 每次 render 都會把統計歸零；這裡記下場景這一趟的數字，否則讀到的是後製四邊形（1 次呼叫、2 個三角形）
    this.sceneInfo = { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles };
    renderer.setRenderTarget(null);
    const u = this.mat.uniforms;
    u.texel.value.set(1 / w, 1 / h);
    u.outline.value = style.outline ? 1 : 0;
    u.quant.value = style.quant;
    u.depthRange.value = cam.far - cam.near;
    renderer.render(this.quadScene, this.quadCam);
  }

  get size() { return [this.rt.width, this.rt.height]; }
  get samples() { return this.rt.samples; }
  dispose() {
    this.rt.dispose(); this.rt.depthTexture?.dispose(); this.mat.dispose();
    this.quadScene.traverse(o => (o as THREE.Mesh).geometry?.dispose());
  }
}
