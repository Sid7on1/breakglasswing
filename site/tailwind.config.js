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
        // Dark Mode (OLED) system — deep navy-black base, slate surfaces, emerald "build" accent.
        ink: {
          950: '#05070d',
          900: '#0a0e1a',
          800: '#0f1626',
          700: '#161f33',
          600: '#1e293b',
        },
        accent: {
          DEFAULT: '#34d399', // emerald — the "run / build" energy
          bright: '#4ade80',
          dim: '#22c55e',
        },
        glowblue: '#3b82f6',
      },
      boxShadow: {
        glow: '0 0 40px -8px rgba(52, 211, 153, 0.35)',
      },
    },
  },
  plugins: [],
};
