import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './lib/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        bg: '#080807',
        surface: '#0F0F0E',
        border: '#1C1C1A',
        text: '#F0EDE6',
        muted: '#46443D',
        dim: '#2A2925',
        accent: '#26ab83',
        red: '#E84332',
      },
      fontFamily: {
        mono: ["'Menlo'", "'Monaco'", "'Courier New'", 'monospace'],
      },
    },
  },
  plugins: [],
}

export default config
