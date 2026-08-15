/**
 * Guards the Phase 1 product boundary from docs/product-reset: Bimax Terminal is a coding agent,
 * while native host capabilities ship only inside the embedding application. The Terminal build
 * must not stage or embed any native-control payload.
 */

import * as fs from 'fs';
import * as path from 'path';

const repoRoot = path.resolve(__dirname, '..', '..');
const libBuild = path.join(repoRoot, 'scripts', 'lib-build.sh');
const embedProd = path.join(repoRoot, 'tui', 'embed_prod.go');
const releaseGate = path.join(repoRoot, 'scripts', 'release-gate.sh');

describe('Bimax Terminal packaging boundary', () => {
  const buildScript = fs.readFileSync(libBuild, 'utf8');
  const embedSource = fs.readFileSync(embedProd, 'utf8');
  const gate = fs.readFileSync(releaseGate, 'utf8');
  const forbiddenPayloads = [
    'bimax-computer-use',
    'bimax-live-pip',
    'bimax-desktop-helper',
    'bimax-cu-service',
  ];

  it('embeds exactly the coding engine', () => {
    const embeddedPaths = [...embedSource.matchAll(/go:embed\s+([^\s]+)/g)].map(match => match[1]);
    expect(embeddedPaths).toEqual(['embed/bimax-engine']);
  });

  it.each(forbiddenPayloads)('does not stage or embed %s', (payload) => {
    expect(buildScript).not.toContain(payload);
    expect(embedSource).not.toContain(`go:embed embed/${payload}`);
  });

  it('keeps the boundary in the release gate', () => {
    expect(gate).toContain('Terminal release source still embeds a Computer Use payload');
    for (const payload of forbiddenPayloads) expect(gate).toContain(payload);
  });
});
