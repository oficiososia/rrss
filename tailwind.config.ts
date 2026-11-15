import type { Config } from 'tailwindcss';

const color = (name: string) => `hsl(var(--${name}) / <alpha-value>)`;

export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: color('bg'),
        surface: color('surface'),
        subtle: color('subtle'),
        border: color('border'),
        fg: color('fg'),
        muted: color('muted'),
        primary: { DEFAULT: color('primary'), fg: color('primary-fg'), soft: color('primary-soft') },
        danger: { DEFAULT: color('danger'), soft: color('danger-soft') },
        success: { DEFAULT: color('success'), soft: color('success-soft') },
        warning: { DEFAULT: color('warning'), soft: color('warning-soft') },
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
      boxShadow: {
        card: '0 1px 2px hsl(var(--shadow) / 0.06), 0 1px 3px hsl(var(--shadow) / 0.08)',
        pop: '0 10px 30px hsl(var(--shadow) / 0.18)',
      },
    },
  },
  plugins: [],
} satisfies Config;
