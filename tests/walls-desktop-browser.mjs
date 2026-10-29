// R068: separate process for the R120 desktop pass followed by every R120 negative, in the
// original order (the replay negative uses the desktop pass's recorded log). The mobile pass
// stays in walls-browser.mjs; both share its fixtures, build and helpers.
process.argv.push('--desktop');
await import('./walls-browser.mjs');
