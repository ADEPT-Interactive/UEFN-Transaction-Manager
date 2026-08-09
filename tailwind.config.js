/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        epic: {
          dark: '#0b0f19',
          card: '#111827',
          cardHover: '#172033',
          border: '#1f293d',
          borderHover: '#374151',
          accent: '#6366f1',
          accentLight: '#818cf8',
          vbucks: '#38bdf8',
          gold: '#fbbf24',
          emerald: '#10b981',
          rose: '#f43f5e',
        }
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'Consolas', 'monospace'],
      },
      boxShadow: {
        'glow-vbucks': '0 0 20px rgba(56, 189, 248, 0.25)',
        'glow-accent': '0 0 20px rgba(99, 102, 241, 0.25)',
        'glow-gold': '0 0 20px rgba(251, 191, 36, 0.25)',
      }
    },
  },
  plugins: [],
}
