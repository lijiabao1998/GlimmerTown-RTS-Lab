// R046：桌機那一半（滑鼠、鍵盤、種子輸入、網址直接開局）另跑一個行程；手機、預算、逃生閥與故意弄壞在 skirmish-browser.mjs。
process.argv.push('--desktop');
await import('./skirmish-browser.mjs');
