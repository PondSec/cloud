import type { Config } from 'tailwindcss';

export default {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        card: 'hsl(var(--card))',
        'card-foreground': 'hsl(var(--card-foreground))',
        primary: 'hsl(var(--primary))',
        'primary-foreground': 'hsl(var(--primary-foreground))',
        accent: 'hsl(var(--accent))',
        'accent-foreground': 'hsl(var(--accent-foreground))',
        border: 'hsl(var(--border))',
        muted: 'hsl(var(--muted))',
        'muted-foreground': 'hsl(var(--muted-foreground))',
      },
      borderRadius: {
        xl: '1rem',
      },
      boxShadow: {
        neon: '0 0 0 1px rgba(125, 252, 255, 0.35), 0 0 24px rgba(125, 252, 255, 0.2)',
      },
      fontFamily: {
        sans: ['"Outfit"', 'ui-sans-serif', 'system-ui'],
        display: ['"Space Grotesk"', 'ui-sans-serif', 'system-ui'],
      },
    },
  },
  plugins: [],
} satisfies Config;
