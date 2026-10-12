/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Neutrals + accent are CSS-variable-driven so the whole app can be
        // re-themed at runtime (see :root themes in index.css).
        ink: {
          950: 'rgb(var(--ink-950) / <alpha-value>)',
          900: 'rgb(var(--ink-900) / <alpha-value>)',
          850: 'rgb(var(--ink-850) / <alpha-value>)',
          800: 'rgb(var(--ink-800) / <alpha-value>)',
          750: 'rgb(var(--ink-750) / <alpha-value>)',
          700: 'rgb(var(--ink-700) / <alpha-value>)',
          600: 'rgb(var(--ink-600) / <alpha-value>)',
        },
        brand: {
          50: 'rgb(var(--brand-50) / <alpha-value>)',
          300: 'rgb(var(--brand-300) / <alpha-value>)',
          400: 'rgb(var(--brand-400) / <alpha-value>)',
          500: 'rgb(var(--brand-500) / <alpha-value>)',
          600: 'rgb(var(--brand-600) / <alpha-value>)',
        },
        // Foreground/text — mirrors the old static slate-*/white scale, but
        // themeable: identical values to Tailwind's own slate/white for every
        // dark theme (zero visual change there), inverted (dark-on-light)
        // for the light theme. 50 = was "white" (most prominent), 600 = was
        // "slate-600" (most muted).
        fg: {
          50: 'rgb(var(--fg-50) / <alpha-value>)',
          100: 'rgb(var(--fg-100) / <alpha-value>)',
          200: 'rgb(var(--fg-200) / <alpha-value>)',
          300: 'rgb(var(--fg-300) / <alpha-value>)',
          400: 'rgb(var(--fg-400) / <alpha-value>)',
          500: 'rgb(var(--fg-500) / <alpha-value>)',
          600: 'rgb(var(--fg-600) / <alpha-value>)',
        },
        // Semantic colors — same hue across themes (meaning must not change),
        // but CSS-var-driven so the light theme can darken them just enough
        // to stay readable as text on a white background (see index.css).
        good: 'rgb(var(--good) / <alpha-value>)',
        bad: 'rgb(var(--bad) / <alpha-value>)',
        warn: 'rgb(var(--warn) / <alpha-value>)',
        purple: 'rgb(var(--purple) / <alpha-value>)',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
      },
      boxShadow: {
        card: '0 1px 0 0 rgba(255,255,255,0.04) inset, 0 12px 32px -12px rgba(0,0,0,0.6)',
      },
    },
  },
  plugins: [],
}
