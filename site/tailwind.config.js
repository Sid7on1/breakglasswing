/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        heading: ["'Instrument Serif'", 'serif'],
        body: ["'Inter'", 'system-ui', 'sans-serif'],
        mono: ["'JetBrains Mono'", 'ui-monospace', 'monospace'],
      },
      colors: {
        // Deep-space observatory system — indigo-black void, violet aurora accent, starlight cyan.
        // Keyed as `ink` so every surviving ink-* utility (nav, glass, borders) re-themes in place.
        ink: {
          950: '#040412',
          900: '#08081d',
          800: '#0e0e2a',
          700: '#161638',
          600: '#1e1e4b',
        },
        accent: {
          DEFAULT: '#8b5cf6', // violet — the observatory beam
          bright: '#a78bfa',
          dim: '#7c3aed',
        },
        glowblue: '#67e8f9', // starlight cyan
      },
      boxShadow: {
        glow: '0 0 40px -8px rgba(139, 92, 246, 0.4)',
      },
    },
  },
  plugins: [],
};
