'use strict';

const PROXY_HEALTH = 'http://localhost:3000/api/health';

const DEFAULTS = {
  alwaysOn:         false,
  filterVegetarian: true,
  filterVegan:      false,
  filterPlantBased: false,
  displayMode:      'list'
};

// ── Storage ───────────────────────────────────────────────────────────────────

function loadSettings() {
  return new Promise(resolve => chrome.storage.sync.get(DEFAULTS, resolve));
}

function saveSettings(settings) {
  return new Promise(resolve => chrome.storage.sync.set(settings, resolve));
}

// ── Tab helpers ───────────────────────────────────────────────────────────────

function getActiveTab() {
  return new Promise(resolve =>
    chrome.tabs.query({ active: true, currentWindow: true }, tabs => resolve(tabs[0]))
  );
}

function sendToContent(tabId, msg) {
  return new Promise(resolve =>
    chrome.tabs.sendMessage(tabId, msg, res => {
      if (chrome.runtime.lastError) {
        resolve({ success: false, error: chrome.runtime.lastError.message });
      } else {
        resolve(res || { success: false, error: 'No response from page' });
      }
    })
  );
}

async function ensureContentScript(tabId) {
  const ping = await sendToContent(tabId, { action: 'getStatus' });
  if (ping.success) return true;
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
    await new Promise(r => setTimeout(r, 350));
    return true;
  } catch (_) { return false; }
}

// ── Status UI ─────────────────────────────────────────────────────────────────

let $status;

function setStatus(msg, type = 'info') {
  $status.textContent = msg;
  $status.className   = `status ${type}`;
}
function clearStatus() { $status.className = 'status hidden'; }

// ── Health check ──────────────────────────────────────────────────────────────

async function checkHealth() {
  const statusEl = document.getElementById('server-status');
  const textEl   = document.getElementById('server-status-text');

  statusEl.className = 'server-status checking';
  textEl.textContent = 'Checking…';

  try {
    const res = await fetch(PROXY_HEALTH, {
      signal: AbortSignal.timeout(3000)
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    if (!data.apiKeyConfigured) {
      statusEl.className = 'server-status offline';
      textEl.textContent = 'Server running but ANTHROPIC_API_KEY not set';
      return false;
    }

    statusEl.className = 'server-status online';
    textEl.textContent = `Backend running ✓  (${data.model})`;
    return true;

  } catch (_) {
    statusEl.className = 'server-status offline';
    textEl.textContent = 'Server not running';
    return false;
  }
}

// ── Scan handler ──────────────────────────────────────────────────────────────

async function handleScan() {
  // Gate on server health before touching the page
  const healthy = await checkHealth();
  if (!healthy) {
    setStatus(
      'Start the backend first: cd backend && npm install && npm start',
      'error'
    );
    return;
  }

  const tab = await getActiveTab();
  if (!tab) { setStatus('No active tab found.', 'error'); return; }
  if (!tab.url?.startsWith('http')) {
    setStatus('VegMenu only works on http/https pages.', 'error');
    return;
  }

  const scanBtn  = document.getElementById('scan-btn');
  const scanIcon = document.getElementById('scan-icon');
  const scanLbl  = document.getElementById('scan-label');

  scanBtn.disabled     = true;
  scanIcon.textContent = '⏳';
  scanLbl.textContent  = 'Scanning…';
  setStatus('Injecting scanner into page…', 'info');

  const ready = await ensureContentScript(tab.id);
  if (!ready) {
    setStatus('Could not inject VegMenu into this page.', 'error');
    scanBtn.disabled     = false;
    scanIcon.textContent = '🔍';
    scanLbl.textContent  = 'Scan This Page';
    return;
  }

  setStatus('Scanning for menus…', 'info');
  const res = await sendToContent(tab.id, { action: 'startScan' });

  scanBtn.disabled     = false;
  scanIcon.textContent = '🔍';
  scanLbl.textContent  = 'Scan This Page';

  if (res.success) {
    setStatus('Scan complete! Check the panel on the page.', 'success');
    setTimeout(clearStatus, 3500);
  } else {
    setStatus(`Scan failed: ${res.error || 'unknown error'}`, 'error');
  }
}

// ── Save handler ──────────────────────────────────────────────────────────────

async function handleSave() {
  await saveSettings({
    alwaysOn:         document.getElementById('always-on').checked,
    filterVegetarian: true,
    filterVegan:      document.getElementById('filter-vegan').checked,
    filterPlantBased: document.getElementById('filter-plant').checked,
    displayMode:      document.getElementById('display-mode').value
  });
  setStatus('Settings saved!', 'success');
  setTimeout(clearStatus, 2000);
}

// ── Init ──────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  $status = document.getElementById('status');

  const settings = await loadSettings();
  document.getElementById('always-on').checked    = settings.alwaysOn;
  document.getElementById('filter-vegan').checked = settings.filterVegan;
  document.getElementById('filter-plant').checked = settings.filterPlantBased;
  document.getElementById('display-mode').value   = settings.displayMode;

  // Check server on popup open
  checkHealth();

  document.getElementById('recheck-btn').addEventListener('click', checkHealth);
  document.getElementById('scan-btn').addEventListener('click', handleScan);
  document.getElementById('save-btn').addEventListener('click', handleSave);

  ['always-on', 'filter-vegan', 'filter-plant'].forEach(id =>
    document.getElementById(id).addEventListener('change', handleSave)
  );
  document.getElementById('display-mode').addEventListener('change', handleSave);
});
