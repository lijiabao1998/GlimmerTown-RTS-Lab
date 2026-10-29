// R069：桌機那一半（滑鼠、鍵盤、說明、音效、難度、跟閥關時按舊鍵逐位相同）另跑一個行程；手機與故意弄壞在 start-menu-browser.mjs。
process.argv.push('--desktop');
await import('./start-menu-browser.mjs');
