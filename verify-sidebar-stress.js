const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const htmlPath = path.resolve(__dirname, 'index.html');
const jsPath = path.resolve(__dirname, 'app.js');
const cssPath = path.resolve(__dirname, 'tailwind.css');

console.log('=== Sidebar Toggle Stress Test Starting ===');

// Check file existence
if (!fs.existsSync(htmlPath)) {
  console.error('FAIL: index.html not found');
  process.exit(1);
}
if (!fs.existsSync(jsPath)) {
  console.error('FAIL: app.js not found');
  process.exit(1);
}
if (!fs.existsSync(cssPath)) {
  console.error('FAIL: tailwind.css not found');
  process.exit(1);
}

const htmlContent = fs.readFileSync(htmlPath, 'utf8');
const jsContent = fs.readFileSync(jsPath, 'utf8');
const cssContent = fs.readFileSync(cssPath, 'utf8');

// 1. Verify CSS media query constraints
console.log('Verifying CSS media query for .sidebar-collapsed...');
// Find index of sidebar-collapsed and min-width:768px
const hasCollapsedClass = cssContent.includes('sidebar-collapsed');
const hasMediaQuery = cssContent.includes('min-width:768px') || cssContent.includes('min-width: 768px');
console.log(`Debug CSS search: hasCollapsedClass=${hasCollapsedClass}, hasMediaQuery=${hasMediaQuery}`);

if (!hasCollapsedClass) {
  console.error('FAIL: sidebar-collapsed class not found in tailwind.css');
  process.exit(1);
}

const minifiedMatch = /@media\s*\(min-width:\s*768px\)\s*\{[^}]*sidebar-collapsed/.test(cssContent);
if (!minifiedMatch) {
  console.error('FAIL: sidebar-collapsed rule is not properly media-queried to min-width: 768px in tailwind.css');
  process.exit(1);
}
console.log('PASS: CSS media query constraints verified.');

// 2. Verify layout responsiveness classes in index.html
console.log('Verifying HTML layout responsiveness classes...');
const dom = new JSDOM(htmlContent);
const { window } = dom;

const sidebar = window.document.getElementById('mainSidebar');
const toggleBtn = window.document.getElementById('sidebarToggleBtn');

if (!sidebar) {
  console.error('FAIL: #mainSidebar not found in HTML');
  process.exit(1);
}
if (!toggleBtn) {
  console.error('FAIL: #sidebarToggleBtn not found in HTML');
  process.exit(1);
}

const sidebarClasses = Array.from(sidebar.classList);
const toggleBtnClasses = Array.from(toggleBtn.classList);

console.log('Sidebar classes:', sidebarClasses.join(' '));
console.log('Toggle button classes:', toggleBtnClasses.join(' '));

// Ensure sidebar is hidden on mobile, flex on desktop
if (!sidebarClasses.includes('hidden') || !sidebarClasses.includes('md:flex')) {
  console.error('FAIL: #mainSidebar must have "hidden" and "md:flex" classes for mobile/desktop responsiveness');
  process.exit(1);
}

// Ensure toggleBtn is hidden on mobile, block on desktop
if (!toggleBtnClasses.includes('hidden') || !toggleBtnClasses.includes('md:block')) {
  console.error('FAIL: #sidebarToggleBtn must have "hidden" and "md:block" classes for mobile/desktop responsiveness');
  process.exit(1);
}
console.log('PASS: Responsive classes verified in HTML.');

// 3. JSDOM Execution & Click Stress Testing
console.log('Initializing JSDOM environment for stress test...');
const testDom = new JSDOM(htmlContent, {
  runScripts: 'outside-only',
  url: 'http://localhost/'
});
const testWin = testDom.window;

// Mock external globals
testWin.supabase = {
  createClient: () => ({
    auth: {
      getSession: () => Promise.resolve({ data: { session: null } }),
      onAuthStateChange: () => {}
    }
  })
};
testWin.Chart = class {
  constructor() {}
  destroy() {}
};
testWin.QRCode = class {
  constructor() {}
};
testWin.print = () => {};

console.log('Evaluating app.js...');
try {
  testWin.eval(jsContent);
  console.log('app.js evaluated successfully.');
} catch (err) {
  console.error('FAIL: app.js evaluation crashed:', err);
  process.exit(1);
}

console.log('Waiting for initialization...');
setTimeout(() => {
  const sidebarEl = testWin.document.getElementById('mainSidebar');
  const toggleBtnEl = testWin.document.getElementById('sidebarToggleBtn');

  if (!sidebarEl || !toggleBtnEl) {
    console.error('FAIL: DOM elements not found after app.js init');
    process.exit(1);
  }

  // Stress test: Click 10 times consecutively
  console.log('Starting 10-click stress test...');
  for (let i = 1; i <= 10; i++) {
    toggleBtnEl.click();
    const hasCollapsed = sidebarEl.classList.contains('sidebar-collapsed');
    console.log(`Click ${i}: sidebar-collapsed is ${hasCollapsed}`);
    
    const shouldHaveCollapsed = (i % 2 !== 0); // odd clicks should collapse, even clicks expand
    if (hasCollapsed !== shouldHaveCollapsed) {
      console.error(`FAIL: Click ${i} state mismatch! Expected collapsed to be ${shouldHaveCollapsed}, got ${hasCollapsed}`);
      process.exit(1);
    }
  }

  console.log('PASS: 10-click stress test completed successfully.');
  console.log('=== ALL TESTS PASSED SUCCESSFULLY ===');
  process.exit(0);
}, 500);
