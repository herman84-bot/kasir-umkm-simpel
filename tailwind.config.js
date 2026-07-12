/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './app.js', './public/index.html', './public/app.js'],
  theme: {
    extend: {
      colors: {
        primary: '#ff385c',
        'primary-active': '#e00b41',
        'primary-light': '#fff1f3',
        'primary-disabled': '#ffd1da',
        ink: '#222222',
        body: '#3f3f3f',
        muted: '#6a6a6a',
        'muted-soft': '#929292',
        hairline: '#dddddd',
        'hairline-soft': '#ebebeb',
        'border-strong': '#c1c1c1',
        canvas: '#ffffff',
        'surface-soft': '#f7f7f7',
        'surface-strong': '#f2f2f2',
      }
    }
  },
  plugins: []
};
