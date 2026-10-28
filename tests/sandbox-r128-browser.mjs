// R068: separate process for the R128 sandbox browser guards (entry, placement, start/pause,
// replay, capacity, reset, return, layout at four sizes, valve, R128 negatives).
// R129 audio/placement guards stay in sandbox-browser.mjs; both share its build and helpers.
process.argv.push('--r128-only');
await import('./sandbox-browser.mjs');
