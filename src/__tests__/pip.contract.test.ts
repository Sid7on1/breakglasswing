import * as fs from 'fs';
import * as path from 'path';
import { NativeLivePip } from '../computer/pip';

describe('continuous native PiP contract', () => {
  const root = path.resolve(__dirname, '../..');

  it('uses a continuous ScreenCaptureKit window filter rather than the legacy screenshot viewer', () => {
    const swift = fs.readFileSync(path.join(root, 'native', 'BimaxLivePip.swift'), 'utf8');
    const transport = fs.readFileSync(path.join(root, 'src', 'computer', 'transport.ts'), 'utf8');

    expect(swift).toContain('SCStreamOutput');
    expect(swift).toContain('SCContentFilter(desktopIndependentWindow: target)');
    expect(swift).toContain('minimumFrameInterval = CMTime(value: 1, timescale: 15)');
    expect(swift).toContain('first_frame');
    expect(transport).not.toContain("driverArgs.push('--experimental-pip')");
  });

  it('reports an enabled but capture-unsafe waiting state until a target window exists', async () => {
    const pip = new NativeLivePip();
    pip.sync(null, true);
    expect(pip.status()).toEqual({
      enabled: true,
      running: false,
      continuous: true,
      captureSafe: false,
      surface: undefined,
      error: undefined,
    });
    await pip.stop();
  });
});
