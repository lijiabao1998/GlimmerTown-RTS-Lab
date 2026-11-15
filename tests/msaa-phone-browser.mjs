// R065／R079 真 Chrome，手機寬（412×860）那一半：跟 tests/msaa-browser.mjs 是同一份程式，只換畫面的寬度（用 withBrowser 開頁、tools/cdp.mjs）。
// 拆成兩支的原因寫在那一支的檔頭（一支跑完會超過 CI 每支守衛 120 秒的上限）。
globalThis.__r065Views = [[412, 860, true]];
globalThis.__r065Port = 9966;
await import('./msaa-browser.mjs');
