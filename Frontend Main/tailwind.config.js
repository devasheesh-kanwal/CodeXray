/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // ── Landing / Hero tokens (unchanged) ────────────────────────────────
        'hero-red':  '#DC1F1F',
        'hero-mint': '#CFF1E6',
        'landing-bg':      '#000000',
        'landing-surface': '#0A0A0A',
        'landing-raised':  '#121212',
        'landing-red':     '#C21C1D',
        'landing-mint':    '#DFF5EB',
        'landing-muted':   '#8FA8A0',

        // ── App-shell dark graphite palette ──────────────────────────────────
        // Page / layer backgrounds
        'bg-deep':     '#101113',   // page background
        'bg-surface':  '#17181B',   // sidebar, topbar, cards
        'bg-raised':   '#202125',   // inputs, hover, segmented control
        'bg-elevated': '#26272C',   // modals, dropdowns, drawers

        // Semantic shorthands used throughout the shell JSX
        bg:             '#101113',
        surface:        '#17181B',
        'surface-muted':'#202125',

        // Borders
        border:        'rgba(255,255,255,0.08)',
        'border-strong':'rgba(255,255,255,0.16)',

        // Text  (mint-tinted scale)
        text: {
          DEFAULT: '#DFF5EB',      // --text  (mint)
          muted:   '#8FA8A0',      // --text-muted
          faint:   'rgba(143,168,160,0.5)', // --text-faint
          inverse: '#000000',
        },

        // Accent – CodeXray red
        accent: {
          DEFAULT: '#DC1F1F',
          hover:   '#C41A1A',
          active:  '#A81515',
          soft:    'rgba(220,31,31,0.12)',
        },

        // Semantic colours (keep same hue, just referenced)
        highlight: '#eca800',
        success: {
          DEFAULT: '#30a46c',
          soft:    'rgba(48,164,108,0.12)',
        },
        warning: {
          DEFAULT: '#f5a623',
          soft:    'rgba(245,166,35,0.12)',
        },
        danger: {
          DEFAULT: '#e5484d',
          soft:    'rgba(229,72,77,0.12)',
        },
      },

      fontFamily: {
        sans:    ['Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'sans-serif'],
        mono:    ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'Monaco', 'Consolas', 'monospace'],
        display: ['Bodoni Moda', 'Georgia', 'serif'],
        landing: ['Jost', 'system-ui', 'sans-serif'],
      },

      fontSize: {
        h1:       ['40px', { lineHeight: '48px', fontWeight: '700' }],
        h2:       ['32px', { lineHeight: '40px', fontWeight: '700' }],
        h3:       ['24px', { lineHeight: '32px', fontWeight: '600' }],
        h4:       ['20px', { lineHeight: '28px', fontWeight: '600' }],
        body:     ['16px', { lineHeight: '24px', fontWeight: '400' }],
        'body-sm':['14px', { lineHeight: '20px', fontWeight: '400' }],
        caption:  ['12px', { lineHeight: '16px', fontWeight: '400' }],
        mono:     ['14px', { lineHeight: '20px', fontWeight: '400' }],
      },

      spacing: {
        '4.5': '18px',
      },

      borderRadius: {
        sm:  '6px',
        md:  '8px',
        lg:  '12px',
        xl:  '16px',
        '2xl':'20px',
      },

      boxShadow: {
        sm:   '0 1px 2px rgba(0,0,0,0.18)',
        md:   '0 4px 12px rgba(0,0,0,0.35)',
        lg:   '0 8px 30px rgba(0,0,0,0.55)',
        card: '0 8px 30px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.04)',
      },

      maxWidth: {
        content: '1280px',
      },

      width: {
        sidebar: '240px',
      },

      height: {
        topbar: '72px',
      },
    },
  },
  plugins: [],
}