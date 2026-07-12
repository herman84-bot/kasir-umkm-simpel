/** @type {import('tailwindcss').Config} */
module.exports = {
  // Pindai semua kelas yang dipakai di markup statis & yang dibuat dinamis di app.js
  content: ['./index.html', './app.js', './public/index.html', './public/app.js'],
  theme: {
    extend: {
      colors: {
        primary: '#ff385c',
        ink: '#222222',
        canvas: '#ffffff',
        'surface-soft': '#f7f7f7',
        muted: '#6a6a6a',
        hairline: '#dddddd',
      }
    }
  },
  plugins: []
};
