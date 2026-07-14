/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './app.js', './public/index.html', './public/app.js'],
  theme: {
    extend: {
      colors: {
        primary: '#CC6B49',
        'primary-active': '#B15537',
        'primary-light': '#FBEEE7',
        'primary-disabled': '#F0CFC0',
        'accent-gold': '#E3A868',
        ink: '#26231F',
        body: '#44403C',
        muted: '#78716C',
        'muted-soft': '#A8A29E',
        hairline: '#E7E2DB',
        'hairline-soft': '#EFEBE4',
        'border-strong': '#D6CFC4',
        canvas: '#ffffff',
        'surface-soft': '#F5F2EB',
        'surface-strong': '#EDE7DB',
      }
    }
  },
  plugins: []
};
