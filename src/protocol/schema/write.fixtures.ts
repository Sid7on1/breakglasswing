import * as fs from 'fs';
import * as path from 'path';
import { fixturesJson } from './fixtures';

// `npm run gen:protocol` — (re)write the committed contract artifact from the
// type-checked TS fixtures. The jest + go contract tests verify it never drifts.
const out = path.join(__dirname, '..', '..', '..', 'src', 'protocol', 'schema', 'fixtures.json');
fs.writeFileSync(out, fixturesJson(), 'utf-8');
console.log(`protocol fixtures written: ${out}`);
