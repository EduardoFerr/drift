/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        drift: {
          bg: '#08080f',
          surface: '#0d0d16',
          border: '#1f2937',
          accent: '#a78bfa',
          spread: '#34d399',
          bury: '#f87171',
        },
      },
      fontFamily: {
        mono: ['SF Mono', 'Fira Code', 'monospace'],
      },
    },
  },
  plugins: [],
}
