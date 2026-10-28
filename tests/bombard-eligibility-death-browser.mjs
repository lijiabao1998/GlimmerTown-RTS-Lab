// R067: separate process for the R137 native live-death pair (normal and low FPS,
// valve on/off, equal-tick replay). The three-viewport and mixed-production baseline
// stays in bombard-eligibility-browser.mjs; negatives stay in the negative file.
process.argv.push('--r137-death-only');
await import('./bombard-eligibility-browser.mjs');
