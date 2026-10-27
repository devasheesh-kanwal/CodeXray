/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        'hero-red': '#DC1F1F',
        'hero-mint': '#CFF1E6',
        'bg-deep': '#000000',
        'bg-teal': '#000000',
        'landing-bg': '#000000',
        'landing-surface': '#0A0A0A',
        'landing-raised': '#121212',
        'landing-red': '#C21C1D',
        'landing-mint': '#DFF5EB',
        'landing-muted': '#8FA8A0',
        bg: '#ededed',
        surface: '#ffffff',
        'surface-muted': '#f5f5f5',
        border: '#d9d9d9',
        'border-strong': '#c4c4c4',
        text: {
          primary: '#030303',
          secondary: '#6b6b6b',
          muted: '#9a9a9a',
          inverse: '#ffffff',
        },
        accent: {
          DEFAULT: '#3164f4',
          hover: '#2554d4',
          active: '#1f47c9',
          soft: '#e8eeff',
        },
        highlight: '#eca800',
        success: {
          DEFAULT: '#30a46c',
          soft: '#e7f5ee',
        },
        warning: {
          DEFAULT: '#f5a623',
          soft: '#fef3e2',
        },
        danger: {
          DEFAULT: '#e5484d',
          soft: '#fdecee',
        },
      },
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'Monaco', 'Consolas', 'monospace'],
        display: ['Bodoni Moda', 'Georgia', 'serif'],
        landing: ['Jost', 'system-ui', 'sans-serif'],
      },
      fontSize: {
        h1: ['40px', { lineHeight: '48px', fontWeight: '700' }],
        h2: ['32px', { lineHeight: '40px', fontWeight: '700' }],
        h3: ['24px', { lineHeight: '32px', fontWeight: '600' }],
        h4: ['20px', { lineHeight: '28px', fontWeight: '600' }],
        body: ['16px', { lineHeight: '24px', fontWeight: '400' }],
        'body-sm': ['14px', { lineHeight: '20px', fontWeight: '400' }],
        caption: ['12px', { lineHeight: '16px', fontWeight: '400' }],
        mono: ['14px', { lineHeight: '20px', fontWeight: '400' }],
      },
      spacing: {
        '4.5': '18px',
      },
      borderRadius: {
        sm: '6px',
        md: '8px',
        lg: '12px',
        xl: '16px',
        '2xl': '20px',
      },
      boxShadow: {
        sm: '0 1px 2px rgba(0,0,0,0.06)',
        md: '0 4px 12px rgba(0,0,0,0.08)',
        lg: '0 8px 24px rgba(0,0,0,0.12)',
      },
      maxWidth: {
        content: '1280px',
      },
      width: {
        sidebar: '240px',
      },
      height: {
        topbar: '64px',
      },
    },
  },
  plugins: [],
}