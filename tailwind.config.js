/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: { display: ['DM Mono', 'monospace'] },
      colors: {
        base: 'var(--bg)',
        surface: 'var(--surface)',
        elevated: 'var(--surface2)',
        card: 'var(--surface3)',
        border: 'var(--border)',
        'border2': 'var(--border2)',
        accent: 'var(--accent)',
        'accent-dim': 'var(--accent-dim)',
        muted: 'var(--muted)',
        subtle: 'var(--muted2)',
        text: 'var(--text)',
        red: 'var(--red)',
        purple: 'var(--purple)',
        orange: 'var(--orange)',
      },
    },
  },
  plugins: [],
}
