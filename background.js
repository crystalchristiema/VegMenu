'use strict';

const PROXY_BASE = 'http://localhost:3000';

const DEFAULT_SETTINGS = {
  alwaysOn:         false,
  filterVegetarian: true,
  filterVegan:      false,
  filterPlantBased: false,
  displayMode:      'list'
};

// ── Settings ──────────────────────────────────────────────────────────────────

async function getSettings() {
  return new Promise(resolve => chrome.storage.sync.get(DEFAULT_SETTINGS, resolve));
}

function getFilterType(settings) {
  if (settings.filterVegan)      return 'vegan';
  if (settings.filterPlantBased) return 'plant-based';
  return 'vegetarian';
}

// ── Image fetching (still happens in the service worker to bypass page CORS) ──

async function fetchImageAsBase64(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status} fetching image`);

  const blob     = await response.blob();
  const mimeType = blob.type || 'image/jpeg';
  const buffer   = await blob.arrayBuffer();
  const bytes    = new Uint8Array(buffer);

  let binary = '';
  const chunk = 8192;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return { data: btoa(binary), mimeType };
}

// ── Proxy calls ───────────────────────────────────────────────────────────────

async function proxyPost(path, body) {
  let response;
  try {
    response = await fetch(`${PROXY_BASE}${path}`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body)
    });
  } catch (_networkErr) {
    // Server is not running or unreachable
    throw new Error(
      'VegMenu server not running. ' +
      'Please start it: cd backend && npm install && npm start'
    );
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.success === false) {
    throw new Error(data.error || `Server error: ${response.status}`);
  }
  return data;
}

// ── Message Router ────────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

  // ── analyzeImage ────────────────────────────────────────────────────────────
  if (message.action === 'analyzeImage') {
    (async () => {
      const settings   = await getSettings();
      const imageData  = await fetchImageAsBase64(message.imageUrl);
      const proxyResult = await proxyPost('/api/scan-menu', {
        images:     [imageData],
        text:       '',
        filterType: getFilterType(settings)
      });

      // Normalise to the shape content.js expects
      const menu = proxyResult.results?.imageMenus?.[0];
      if (!menu) return { isMenu: false, confidence: 0, vegetarianItems: [], allItems: [] };
      return {
        isMenu:          menu.isMenu,
        confidence:      menu.confidence,
        vegetarianItems: menu.vegetarianItems || [],
        allItems:        menu.allItems        || []
      };
    })()
      .then(r  => sendResponse({ success: true,  data:  r }))
      .catch(e => sendResponse({ success: false, error: e.message }));
    return true;
  }

  // ── analyzeText ─────────────────────────────────────────────────────────────
  if (message.action === 'analyzeText') {
    (async () => {
      const settings    = await getSettings();
      const proxyResult = await proxyPost('/api/scan-menu', {
        images:     [],
        text:       message.pageText,
        filterType: getFilterType(settings)
      });

      const menu = proxyResult.results?.textMenus?.[0];
      if (!menu) return { isMenu: false, confidence: 0, vegetarianItems: [], allItems: [] };
      return {
        isMenu:          menu.isMenu,
        confidence:      menu.confidence,
        vegetarianItems: menu.vegetarianItems || [],
        allItems:        menu.allItems        || []
      };
    })()
      .then(r  => sendResponse({ success: true,  data:  r }))
      .catch(e => sendResponse({ success: false, error: e.message }));
    return true;
  }

  // ── getSettings ─────────────────────────────────────────────────────────────
  if (message.action === 'getSettings') {
    getSettings().then(s => sendResponse({ success: true, data: s }));
    return true;
  }

  // ── saveSettings ────────────────────────────────────────────────────────────
  if (message.action === 'saveSettings') {
    chrome.storage.sync.set(message.settings, () => sendResponse({ success: true }));
    return true;
  }

  // ── setBadge ────────────────────────────────────────────────────────────────
  if (message.action === 'setBadge') {
    const tabId = sender.tab?.id;
    if (tabId) {
      if (message.text) {
        chrome.action.setBadgeText({ text: String(message.text), tabId });
        chrome.action.setBadgeBackgroundColor({ color: '#27AE60', tabId });
      } else {
        chrome.action.setBadgeText({ text: '', tabId });
      }
    }
    sendResponse({ success: true });
    return true;
  }

  return false;
});
