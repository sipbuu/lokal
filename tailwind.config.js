/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: { display: ['DM Mono', 'monospace'] },
      colors: {
        base: '#0a0a0a',
        surface: '#111111',
        elevated: '#181818',
        card: '#202020',
        border: '#2a2a2a',
        accent: '#e8ff57',
        'accent-dim': '#c8df47',
        muted: '#888888',
        subtle: '#444444',
      },
    },
  },
  plugins: [],
}
