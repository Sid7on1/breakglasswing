/**
 * Light, dark, and match-system.
 *
 * `04_FRONTEND_PLAN.md`: remove the ornamental theme set; ship light and dark first. Moonlight and
 * Starlight express hierarchy with black, white and silver rather than decorative hue. Every legacy
 * selection is migrated instead of being left on a class that no longer exists.
 *
 * `auto` is the Mac-native default: the app follows the system appearance, which the previous
 * fixed-theme list could not express at all.
 */

export type Appearance = 'auto' | 'moonlight' | 'starlight';

/** The class actually applied to the document; `auto` resolves against the system. */
export type ResolvedAppearance = 'moonlight' | 'starlight';

export const APPEARANCES: { id: Appearance; label: string; description: string }[] = [
  { id: 'auto', label: 'Match system', description: 'Follow your Mac’s appearance' },
  { id: 'moonlight', label: 'Moonlight', description: 'Black, graphite and silver' },
  { id: 'starlight', label: 'Starlight', description: 'White, pearl and soft silver' },
];

const THEME_CLASSES = ['theme-graphite', 'theme-linen', 'theme-moonlight', 'theme-starlight'];

export function savedAppearance(): Appearance {
  const value = localStorage.getItem('bimax:appearance');
  if (value === 'auto' || value === 'moonlight' || value === 'starlight') return value;
  // Migrate every theme shipped before the frontend reset.
  if (value === 'cloud' || value === 'linen') return 'starlight';
  if (value === 'ink' || value === 'aurora' || value === 'midnight' || value === 'graphite') return 'moonlight';
  return 'auto';
}

export function resolveAppearance(
  appearance: Appearance,
  prefersDark: boolean,
): ResolvedAppearance {
  if (appearance === 'auto') return prefersDark ? 'moonlight' : 'starlight';
  return appearance;
}

/**
 * Apply the appearance and keep following the system while `auto` is selected. Returns the
 * teardown so the caller can stop listening when the choice changes.
 */
export function applyAppearance(appearance: Appearance): () => void {
  localStorage.setItem('bimax:appearance', appearance);
  const query = window.matchMedia('(prefers-color-scheme: dark)');
  const paint = (): void => {
    const resolved = resolveAppearance(appearance, query.matches);
    document.documentElement.classList.remove(...THEME_CLASSES);
    document.documentElement.classList.add(`theme-${resolved}`);
    document.documentElement.dataset.appearance = resolved;
  };
  paint();
  if (appearance !== 'auto') return () => {};
  query.addEventListener('change', paint);
  return () => query.removeEventListener('change', paint);
}
