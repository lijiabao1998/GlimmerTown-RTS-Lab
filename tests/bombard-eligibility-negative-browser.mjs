// Separate process for all R137 semantic negative pairs. The complete native
// three-viewport baseline stays in bombard-eligibility-browser.mjs; every mutant
// additionally runs its identical unmodified case first here.
process.argv.push('--r137-negatives-only');
await import('./bombard-eligibility-browser.mjs');
