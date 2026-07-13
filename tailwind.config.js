/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './app.js', './public/index.html', './public/app.js'],
  theme: {
    extend: {
      colors: {
        // Dark theme reskin (9router.com-inspired). Token names kept from the
        // legacy light theme so every existing class in index.html/app.js
        // repaints automatically — only hex values changed, plus a few new
        // tokens (heading, secondary, card, success*) for meanings the old
        // palette didn't separate (e.g. "ink" used to mean both text AND bg).
        primary: '#f97316',
        'primary-active': '#ea580c',
        'primary-light': 'rgba(249,115,22,0.16)',
        'primary-disabled': 'rgba(249,115,22,0.35)',
        success: '#22c55e',
        'success-active': '#16a34a',
        'success-light': 'rgba(34,197,94,0.16)',
        heading: '#ffffff',
        ink: '#1c1c1e',
        body: '#242424',
        secondary: '#9ca3af',
        muted: '#a1a1aa',
        'muted-soft': '#8b8f98',
        hairline: '#2a2a2a',
        'hairline-soft': '#242424',
        'border-strong': '#3f3f3f',
        canvas: '#0d0d0d',
        card: '#1a1a1a',
        'surface-soft': '#0d0d0d',
        'surface-strong': '#141414',
      }
    }
  },
  plugins: []
};
