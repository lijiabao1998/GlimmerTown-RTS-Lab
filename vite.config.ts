import { defineConfig, type Plugin } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// R040：singlefile 把整段程式（約 700 KB）內嵌在 <head>，瀏覽器讀完它才開始畫 <body>。
// 建置後把那一段 module 腳本搬到 </body> 前面：載入畫面排在程式碼前面先畫出來。
// module 腳本本來就等 HTML 解析完才執行，搬位置不改執行時機。只認剛好一段，找不到或不只一段就讓建置失敗。
function moduleScriptLast(): Plugin {
  return {
    name: 'gtrts-module-script-last',
    enforce: 'post',
    generateBundle(_, bundle) {
      for (const file of Object.values(bundle)) {
        if (file.type !== 'asset' || !file.fileName.endsWith('.html')) continue;
        const html = String(file.source), open = '<script type="module"';
        const a = html.indexOf(open), z = a < 0 ? -1 : html.indexOf('</script>', a);
        if (a < 0 || z < 0 || html.indexOf(open, a + 1) >= 0) throw new Error(`R040：${file.fileName} 的 module 腳本不是剛好一段`);
        const script = html.slice(a, z + '</script>'.length), rest = html.slice(0, a) + html.slice(z + '</script>'.length);
        const end = rest.lastIndexOf('</body>');
        if (end < 0) throw new Error(`R040：${file.fileName} 找不到 </body>`);
        file.source = rest.slice(0, end) + script + '\n' + rest.slice(end);
      }
    },
  };
}

// 輸出單一 dist/index.html：離線可用、可直接放上 Pages。
// 設定沿用 GlimmerTown3D-lab@bece722 vite.config.ts。
export default defineConfig({
  base: './',
  plugins: [viteSingleFile(), moduleScriptLast()],
  build: { target: 'es2022', assetsInlineLimit: 100_000_000, cssCodeSplit: false, chunkSizeWarningLimit: 4000 },
  server: { port: 8401 },
});
