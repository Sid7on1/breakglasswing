/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        heading: ["'Bimax Sans'", 'system-ui', 'sans-serif'],
        body: ["'Bimax Sans'", 'system-ui', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      colors: {
        void: '#09100B',
        surface: {
          DEFAULT: '#0F1611',
          raised: '#151D17',
        },
        panel: '#1A241C',
        chalk: '#E8E2CF',
        mist: '#AEB8A7',
        line: 'rgba(232, 226, 207, 0.13)',
        ember: '#4566FF',
        teal: '#8FBF8A',
      },
      maxWidth: {
        content: '1240px',
        wide: '1440px',
      },
    },
  },
  plugins: [],
};
