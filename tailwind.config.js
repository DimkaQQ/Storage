/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: {
          950: '#080b14',
          900: '#0b101c',
          850: '#0f1524',
          800: '#141b2e',
          750: '#1a2338',
          700: '#232f4a',
          600: '#33415f',
        },
        brand: {
          50: '#eef4ff',
          300: '#7ea8ff',
          400: '#5b8bff',
          500: '#3d6bff',
          600: '#2b52e6',
        },
        good: '#2fd2a5',
        bad: '#ff5d73',
        warn: '#ffb547',
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
