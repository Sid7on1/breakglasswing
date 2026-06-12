#!/usr/bin/env node

// Thin bootstrap entry for the bimax CLI.
// After `npm run build`, compiled JS lives in dist/.
// This wrapper ensures the shebang is preserved (tsc strips it from dist/index.js).

require('../dist/index.js');
