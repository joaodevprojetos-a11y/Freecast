/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        fantasy: {
          dark: '#0f0e17',
          card: '#1a1824',
          wine: '#4a1525',
          wineDark: '#2c0c16',
          gold: '#d4af37',
          goldLight: '#f3e5ab',
          parchment: '#f4f1ea',
          muted: '#8c8896',
        }
      },
      fontFamily: {
        serif: ['Cinzel', 'Georgia', 'serif'],
        sans: ['Inter', 'sans-serif'],
      }
    },
  },
  plugins: [],
}
