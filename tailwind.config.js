/** @type {import('tailwindcss').Config} */
module.exports = {
  // Pindai semua kelas yang dipakai di markup statis & yang dibuat dinamis di app.js
  content: ['./index.html', './app.js'],
  theme: { extend: {} },
  plugins: []
};
