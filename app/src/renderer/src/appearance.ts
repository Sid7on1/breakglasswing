export type Appearance = 'graphite' | 'linen' | 'ink';

export const APPEARANCES: { id: Appearance; label: string; description: string }[] = [
  { id: 'graphite', label: 'Graphite', description: 'Quiet, warm and focused' },
  { id: 'linen', label: 'Linen', description: 'Soft daylight workspace' },
  { id: 'ink', label: 'Ink', description: 'Cool blue-black contrast' },
];

export function savedAppearance(): Appearance {
  const value = localStorage.getItem('bimax:appearance');
  if (value === 'linen' || value === 'ink' || value === 'graphite') return value;
  // Migrate the themes shipped before the desktop product refactor.
  if (value === 'cloud') return 'linen';
  if (value === 'aurora') return 'ink';
  return 'graphite';
}
