// R068: separate process for the R137 860 landscape viewport (on/off parity) and native mixed
// production (tank + howitzer + produced mortar, valve on/off). The 1440 and 412 viewports stay in
// bombard-eligibility-browser.mjs; live deaths and negatives have their own files.
process.argv.push('--r137-mixed-only');
await import('./bombard-eligibility-browser.mjs');
