import React from 'react';
import { render } from 'ink-testing-library';
import { InteractiveMenu } from '../cli/components/InteractiveMenu';
import { getTheme } from '../cli/themes';

// Real-keypress regression test for the live slash-menu. Earlier unit tests only checked the
// command *objects* (that /config and /model carry onSelect); this drives the actual Ink
// component with stdin keystrokes to prove Enter routes to onSelect — the path the user hit
// when "/config → Model → Enter did nothing".
const theme = getTheme('dark');
const options = [
  { label: 'Model', value: '/model', desc: 'pick model' },
  { label: 'Theme', value: '/config theme', desc: 'color theme' },
  { label: 'Governor', value: '/governor', desc: 'permissions' },
];

const ENTER = '\r';
const DOWN = '[B';
const UP = '[A';
const ESC = '';

function flush() {
  return new Promise((r) => setTimeout(r, 20));
}

describe('InteractiveMenu live keypresses', () => {
  it('Enter selects the highlighted option (default = first)', async () => {
    const onSelect = jest.fn();
    const { stdin, unmount } = render(
      <InteractiveMenu theme={theme} title="t" options={options} onSelect={onSelect} onCancel={() => {}} />
    );
    await flush();
    stdin.write(ENTER);
    await flush();
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(options[0]);
    unmount();
  });

  it('Down then Enter selects the second option', async () => {
    const onSelect = jest.fn();
    const { stdin, unmount } = render(
      <InteractiveMenu theme={theme} title="t" options={options} onSelect={onSelect} onCancel={() => {}} />
    );
    await flush();
    stdin.write(DOWN);
    await flush();
    stdin.write(ENTER);
    await flush();
    expect(onSelect).toHaveBeenCalledWith(options[1]);
    unmount();
  });

  it('Up wraps to the last option', async () => {
    const onSelect = jest.fn();
    const { stdin, unmount } = render(
      <InteractiveMenu theme={theme} title="t" options={options} onSelect={onSelect} onCancel={() => {}} />
    );
    await flush();
    stdin.write(UP);
    await flush();
    stdin.write(ENTER);
    await flush();
    expect(onSelect).toHaveBeenCalledWith(options[2]);
    unmount();
  });

  it('Esc cancels without selecting', async () => {
    const onSelect = jest.fn();
    const onCancel = jest.fn();
    const { stdin, unmount } = render(
      <InteractiveMenu theme={theme} title="t" options={options} onSelect={onSelect} onCancel={onCancel} />
    );
    await flush();
    stdin.write(ESC);
    await flush();
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();
    unmount();
  });
});
