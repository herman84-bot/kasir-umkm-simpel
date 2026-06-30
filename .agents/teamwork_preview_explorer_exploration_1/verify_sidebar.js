const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

// Paths to index.html and app.js in the parent directory
const htmlPath = path.resolve(__dirname, '../../index.html');
const jsPath = path.resolve(__dirname, '../../app.js');

console.log('Reading files...');
if (!fs.existsSync(htmlPath)) {
  console.error(`Error: html file not found at ${htmlPath}`);
  process.exit(1);
}
if (!fs.existsSync(jsPath)) {
  console.error(`Error: js file not found at ${jsPath}`);
  process.exit(1);
}

const htmlContent = fs.readFileSync(htmlPath, 'utf8');
const jsContent = fs.readFileSync(jsPath, 'utf8');

console.log('Setting up JSDOM environment with local origin...');
const dom = new JSDOM(htmlContent, {
  runScripts: 'outside-only',
  url: 'http://localhost/'
});

const { window } = dom;

// Spy on DOMTokenList.prototype.toggle
const originalToggle = window.DOMTokenList.prototype.toggle;
window.DOMTokenList.prototype.toggle = function(token, force) {
  console.log(`[SPY] classList.toggle called with "${token}"`);
  return originalToggle.call(this, token, force);
};

// Spy on addEventListener for all targets
const originalAddEventListener = window.EventTarget.prototype.addEventListener;
window.EventTarget.prototype.addEventListener = function(type, listener, options) {
  const targetDesc = this.id ? `#${this.id}` : this.constructor.name;
  if (type === 'DOMContentLoaded' || this.id === 'sidebarToggleBtn') {
    console.log(`[SPY] addEventListener called on ${targetDesc} for "${type}"`);
  }
  return originalAddEventListener.call(this, type, listener, options);
};

// Mock Supabase CDN client
window.supabase = {
  createClient: () => ({
    auth: {
      getSession: () => Promise.resolve({ data: { session: null } }),
      onAuthStateChange: () => {}
    }
  })
};

// Mock Chart.js CDN client
window.Chart = class {
  constructor() {}
  destroy() {}
};

// Mock printing
window.print = () => {};

// Un-comment manual evaluation
try {
  window.eval(jsContent);
  console.log('Successfully evaluated app.js');
} catch (err) {
  console.error('Failed to parse app.js:', err);
  process.exit(1);
}

// COMMENTED OUT MANUAL DISPATCH — Let JSDOM fire it automatically in the next event loop tick
console.log('Waiting for JSDOM to fire DOMContentLoaded natively...');

// Wait briefly for initial async routines in App.init to execute
setTimeout(() => {
  const toggleBtn = window.document.getElementById('sidebarToggleBtn');
  const sidebar = window.document.getElementById('mainSidebar');

  if (!toggleBtn) {
    console.error('FAIL: #sidebarToggleBtn not found in DOM');
    process.exit(1);
  }

  if (!sidebar) {
    console.error('FAIL: #mainSidebar not found in DOM');
    process.exit(1);
  }

  const initialClasses = Array.from(sidebar.classList);
  console.log('Initial sidebar classes:', initialClasses.join(' '));

  // Trigger toggle click
  console.log('Clicking #sidebarToggleBtn...');
  toggleBtn.click();

  const postClasses = Array.from(sidebar.classList);
  console.log('Sidebar classes after click:', postClasses.join(' '));

  const beforeHasMdFlex = initialClasses.includes('md:flex');
  const beforeHasMdHidden = initialClasses.includes('md:hidden');
  const beforeHasCollapsed = initialClasses.includes('sidebar-collapsed');

  const afterHasMdFlex = postClasses.includes('md:flex');
  const afterHasMdHidden = postClasses.includes('md:hidden');
  const afterHasCollapsed = postClasses.includes('sidebar-collapsed');

  const toggledProposed = (afterHasCollapsed !== beforeHasCollapsed);
  const toggledCurrent = (beforeHasMdFlex !== afterHasMdFlex) && (beforeHasMdHidden !== afterHasMdHidden);

  if (toggledProposed) {
    console.log('SUCCESS: Sidebar toggled successfully using the PROPOSED "sidebar-collapsed" strategy.');
    process.exit(0);
  } else if (toggledCurrent) {
    console.log('SUCCESS: Sidebar toggled successfully using the CURRENT "md:flex / md:hidden" strategy.');
    process.exit(0);
  } else {
    console.error('FAIL: Sidebar classes did not toggle as expected.');
    process.exit(1);
  }
}, 500);
