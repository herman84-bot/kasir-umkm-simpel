const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

// Paths to index.html and app.js
const htmlPath = path.resolve(__dirname, 'auth.html');
const jsPath = path.resolve(__dirname, 'app.js');

console.log('--- Verification Script Started ---');
console.log(`Checking files existence...`);
if (!fs.existsSync(htmlPath)) {
  console.error(`Error: index.html not found at ${htmlPath}`);
  process.exit(1);
}
if (!fs.existsSync(jsPath)) {
  console.error(`Error: app.js not found at ${jsPath}`);
  process.exit(1);
}

const htmlContent = fs.readFileSync(htmlPath, 'utf8');
const jsContent = fs.readFileSync(jsPath, 'utf8');

console.log('Initializing JSDOM environment...');
const dom = new JSDOM(htmlContent, {
  runScripts: 'outside-only',
  url: 'http://localhost/'
});
const { window } = dom;

// Mock external global objects that app.js expects to avoid initialization errors
window.supabase = {
  createClient: () => ({
    auth: {
      getSession: () => Promise.resolve({ data: { session: null } }),
      onAuthStateChange: () => {}
    }
  })
};
window.Chart = class {
  constructor() {}
  destroy() {}
};
window.QRCode = class {
  constructor() {}
};
window.print = () => {};

// Evaluate app.js script
console.log('Evaluating app.js...');
try {
  window.eval(jsContent);
  console.log('Successfully evaluated app.js');
} catch (err) {
  console.error('Failed to evaluate app.js:', err);
  process.exit(1);
}

// Wait for native DOMContentLoaded / scripts to initialize
console.log('Waiting for application initialization...');
setTimeout(() => {
  const toggleBtn = window.document.getElementById('sidebarToggleBtn');
  const sidebar = window.document.getElementById('mainSidebar');

  if (!toggleBtn) {
    console.error('FAIL: #sidebarToggleBtn element not found in DOM');
    process.exit(1);
  }
  if (!sidebar) {
    console.error('FAIL: #mainSidebar element not found in DOM');
    process.exit(1);
  }

  // 1. Initial State
  const initialClasses = Array.from(sidebar.classList);
  console.log('Initial sidebar classes:', initialClasses.join(' '));
  if (initialClasses.includes('sidebar-collapsed')) {
    console.error('FAIL: Sidebar should not be collapsed initially');
    process.exit(1);
  }

  // 2. First Click (Toggle collapse)
  console.log('Clicking #sidebarToggleBtn (1st time)...');
  toggleBtn.click();
  const step1Classes = Array.from(sidebar.classList);
  console.log('Sidebar classes after 1st click:', step1Classes.join(' '));
  if (!step1Classes.includes('sidebar-collapsed')) {
    console.error('FAIL: Sidebar did not get the class "sidebar-collapsed" after first click');
    process.exit(1);
  }

  // 3. Second Click (Toggle expand)
  console.log('Clicking #sidebarToggleBtn (2nd time)...');
  toggleBtn.click();
  const step2Classes = Array.from(sidebar.classList);
  console.log('Sidebar classes after 2nd click:', step2Classes.join(' '));
  if (step2Classes.includes('sidebar-collapsed')) {
    console.error('FAIL: Sidebar should have removed the class "sidebar-collapsed" after second click');
    process.exit(1);
  }

  console.log('SUCCESS: Sidebar toggled class "sidebar-collapsed" as expected on click!');
  process.exit(0);
}, 500);
