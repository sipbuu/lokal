/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: { display: ['DM Mono', 'monospace'] },
      colors: {
        base: 'rgb(var(--bg-rgb) / <alpha-value>)',
        surface: 'rgb(var(--surface-rgb) / <alpha-value>)',
        elevated: 'rgb(var(--surface2-rgb) / <alpha-value>)',
        card: 'rgb(var(--surface3-rgb) / <alpha-value>)',
        border: 'rgb(var(--border-rgb) / <alpha-value>)',
        'border2': 'rgb(var(--border2-rgb) / <alpha-value>)',
        accent: 'rgb(var(--accent-rgb) / <alpha-value>)',
        'accent-dim': 'rgb(var(--accent-dim-rgb) / <alpha-value>)',
        muted: 'rgb(var(--muted-rgb) / <alpha-value>)',
        subtle: 'rgb(var(--muted2-rgb) / <alpha-value>)',
        text: 'rgb(var(--text-rgb) / <alpha-value>)',
        red: 'rgb(var(--red-rgb) / <alpha-value>)',
        purple: 'rgb(var(--purple-rgb) / <alpha-value>)',
        orange: 'rgb(var(--orange-rgb) / <alpha-value>)',
      },
    },
  },
  plugins: [],
}