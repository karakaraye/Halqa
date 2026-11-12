/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/lib/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/context/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      // Halqa design tokens (Figma: Foundations). Shades not listed fall back to Tailwind defaults.
      colors: {
        white: '#FFFFFF',
        teal: { 800: '#0A5C50', 700: '#0E7C6B', 100: '#CFEFE8', 50: '#E8F6F3' },
        slate: {
          900: '#111827', 700: '#1F2937', 500: '#4B5563', 400: '#6B7280',
          200: '#DDE5E3', 100: '#EEF3F2', 50: '#F6FAF9',
        },
        rose: { 600: '#BE123C', 50: '#FFF1F2' },
        amber: { 600: '#B45309', 50: '#FFFBEB' },
        emerald: { 600: '#047857', 50: '#ECFDF5' },
        sky: { 600: '#0369A1', 50: '#F0F9FF' },
        violet: { 600: '#6D28D9', 50: '#F5F3FF' },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '"Segoe UI"', '"Noto Sans"', '"Noto Sans Arabic"', '"Noto Sans Devanagari"', 'sans-serif'],
      },
      fontSize: {
        'page-title': ['32px', { lineHeight: '40px', fontWeight: '700' }],
        'section': ['24px', { lineHeight: '32px', fontWeight: '600' }],
        'card-title': ['18px', { lineHeight: '26px', fontWeight: '600' }],
        'body': ['16px', { lineHeight: '24px' }],
        'small': ['14px', { lineHeight: '20px' }],
      },
      borderRadius: {
        button: '12px',
        input: '12px',
        card: '16px',
        dialog: '20px',
      },
      minHeight: {
        touch: '48px',
        'touch-lg': '56px',
      },
    },
  },
  plugins: [],
};
