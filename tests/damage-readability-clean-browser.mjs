// Same real replay and camera as the normal captures; only native R004/R014 overlay valves differ.
import{spawnSync}from'node:child_process';
const r=spawnSync(process.execPath,['tests/damage-readability-browser.mjs','--geometry-only',...process.argv.slice(2)],{cwd:new URL('..',import.meta.url),stdio:'inherit'});
process.exit(r.status??1);
