/* VegMenu Content Script */
(function () {
  'use strict';

  if (window.__vegMenuInitialized) return;
  window.__vegMenuInitialized = true;

  // ─── Constants ──────────────────────────────────────────────────────────────
  const MIN_IMAGE_PX = 150;   // Minimum width OR height to consider an image
  const MAX_IMAGES   = 10;    // Max images to analyze per page

  // ─── State ──────────────────────────────────────────────────────────────────
  let scanResults  = [];   // [{ imageUrl, element, items, confidence }]
  let currentView  = 'filtered'; // 'filtered' | 'original'
  let isScanning   = false;
  let displayMode  = 'list';  // 'list' | 'overlay'

  // ─── Styles ─────────────────────────────────────────────────────────────────
  function injectStyles() {
    if (document.getElementById('vegmenu-styles')) return;
    const s = document.createElement('style');
    s.id = 'vegmenu-styles';
    s.textContent = `
/* ── VegMenu Extension ──────────────────────────────────────── */
#vegmenu-panel {
  position: fixed; top: 0; right: 0;
  width: 360px; height: 100vh;
  background: #fff;
  box-shadow: -4px 0 24px rgba(0,0,0,.18);
  z-index: 2147483647;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  font-size: 14px; color: #333;
  display: flex; flex-direction: column;
  transform: translateX(100%);
  transition: transform .3s ease;
  overflow: hidden;
}
#vegmenu-panel.open { transform: translateX(0); }

#vegmenu-toggle-btn {
  position: fixed; right: 0; top: 50%;
  transform: translateY(-50%);
  background: #27AE60; color: #fff;
  border: none; border-radius: 8px 0 0 8px;
  padding: 14px 8px; cursor: pointer;
  z-index: 2147483646; font-size: 20px;
  box-shadow: -2px 2px 10px rgba(0,0,0,.25);
  display: flex; flex-direction: column; align-items: center; gap: 6px;
  transition: right .3s ease, background .2s;
}
#vegmenu-toggle-btn:hover { background: #219A52; }
#vegmenu-toggle-btn .vm-label {
  writing-mode: vertical-rl; text-orientation: mixed;
  font-size: 10px; font-weight: 700; letter-spacing: 1px;
  text-transform: uppercase;
}

#vegmenu-panel-header {
  background: linear-gradient(135deg, #1E8449, #27AE60, #2ECC71);
  color: #fff; padding: 16px;
  display: flex; align-items: center; justify-content: space-between;
  flex-shrink: 0;
}
#vegmenu-panel-header h2 {
  margin: 0; font-size: 16px; font-weight: 700;
  display: flex; align-items: center; gap: 8px;
}
#vegmenu-close-btn {
  background: rgba(255,255,255,.2); border: none; color: #fff;
  width: 28px; height: 28px; border-radius: 50%;
  cursor: pointer; font-size: 15px;
  display: flex; align-items: center; justify-content: center;
  transition: background .2s;
}
#vegmenu-close-btn:hover { background: rgba(255,255,255,.35); }

#vegmenu-view-toggle {
  padding: 10px 14px; background: #f8f9fa;
  border-bottom: 1px solid #e9ecef;
  display: flex; gap: 8px; flex-shrink: 0;
}
.vm-view-btn {
  flex: 1; padding: 7px 10px;
  border: 1px solid #dee2e6; background: #fff;
  border-radius: 6px; cursor: pointer;
  font-size: 12px; font-weight: 500; color: #666;
  transition: all .2s;
}
.vm-view-btn.active {
  background: #27AE60; color: #fff; border-color: #27AE60;
}

#vegmenu-panel-content {
  flex: 1; overflow-y: auto; padding: 14px;
}

.vm-menu-section {
  margin-bottom: 16px;
  border: 1px solid #e9ecef; border-radius: 8px; overflow: hidden;
}
.vm-menu-section-head {
  background: #f8f9fa; padding: 9px 13px;
  font-weight: 600; font-size: 12px; color: #555;
  border-bottom: 1px solid #e9ecef;
  display: flex; align-items: center; gap: 6px;
}
.vm-item {
  padding: 10px 13px; border-bottom: 1px solid #f0f0f0;
  display: flex; justify-content: space-between;
  align-items: flex-start; gap: 10px;
}
.vm-item:last-child { border-bottom: none; }
.vm-item-name { font-weight: 600; color: #1a1a1a; font-size: 13px; margin-bottom: 2px; }
.vm-item-desc { font-size: 11px; color: #777; line-height: 1.4; }
.vm-item-right {
  display: flex; flex-direction: column;
  align-items: flex-end; gap: 4px; flex-shrink: 0;
}
.vm-price { font-weight: 700; color: #27AE60; font-size: 13px; }
.vm-vegan-badge {
  background: #E8F5E9; color: #1B5E20;
  padding: 2px 7px; border-radius: 10px;
  font-size: 10px; font-weight: 600;
}
/* Original-view item badges */
.vm-veg-badge {
  background: #E8F5E9; color: #2E7D32;
  padding: 2px 7px; border-radius: 10px;
  font-size: 10px; font-weight: 600;
}
.vm-nonveg-badge {
  background: #F5F5F5; color: #9E9E9E;
  padding: 2px 7px; border-radius: 10px;
  font-size: 10px; font-weight: 600;
  border: 1px solid #E0E0E0;
}
.vm-item.vm-nonveg { opacity: 0.55; }

.vm-empty {
  text-align: center; color: #aaa;
  padding: 40px 20px;
}
.vm-empty-icon { font-size: 44px; margin-bottom: 12px; }
.vm-empty p { font-size: 13px; line-height: 1.5; }

#vegmenu-loading {
  position: fixed; top: 20px; right: 20px;
  background: #27AE60; color: #fff;
  padding: 11px 18px; border-radius: 8px;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  font-size: 13px; font-weight: 500;
  z-index: 2147483647;
  display: flex; align-items: center; gap: 10px;
  box-shadow: 0 4px 16px rgba(0,0,0,.22);
}
.vm-spinner {
  width: 15px; height: 15px;
  border: 2px solid rgba(255,255,255,.35);
  border-top-color: #fff; border-radius: 50%;
  animation: vm-spin .7s linear infinite; flex-shrink: 0;
}
@keyframes vm-spin { to { transform: rotate(360deg); } }

#vegmenu-confirm-overlay {
  position: fixed; inset: 0;
  background: rgba(0,0,0,.55);
  z-index: 2147483647;
  display: flex; align-items: center; justify-content: center;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
}
.vm-confirm-box {
  background: #fff; border-radius: 14px; padding: 26px;
  max-width: 400px; width: 90%;
  box-shadow: 0 24px 64px rgba(0,0,0,.3);
}
.vm-confirm-box h3 { margin: 0 0 6px; font-size: 17px; color: #1a1a1a; }
.vm-confirm-box p  { margin: 0 0 14px; font-size: 13px; color: #666; }
.vm-confirm-img {
  width: 100%; max-height: 200px; object-fit: contain;
  border-radius: 8px; border: 1px solid #eee; margin-bottom: 12px;
}
.vm-conf-badge {
  display: inline-block; background: #FFF3E0; color: #E65100;
  padding: 4px 10px; border-radius: 12px;
  font-size: 11px; font-weight: 700; margin-bottom: 16px;
}
.vm-confirm-actions { display: flex; gap: 10px; }
.vm-btn-primary {
  flex: 1; padding: 10px; background: #27AE60; color: #fff;
  border: none; border-radius: 8px; cursor: pointer;
  font-size: 14px; font-weight: 600; transition: background .2s;
}
.vm-btn-primary:hover { background: #219A52; }
.vm-btn-secondary {
  flex: 1; padding: 10px; background: #f8f9fa; color: #555;
  border: 1px solid #dee2e6; border-radius: 8px; cursor: pointer;
  font-size: 14px; font-weight: 600; transition: background .2s;
}
.vm-btn-secondary:hover { background: #e9ecef; }

.vm-highlighted {
  outline: 3px solid #27AE60 !important;
  outline-offset: 3px !important;
}

.vm-img-badge {
  position: absolute;
  background: #27AE60; color: #fff;
  padding: 4px 8px; border-radius: 6px;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  font-size: 11px; font-weight: 600;
  z-index: 2147483645; pointer-events: none;
  white-space: nowrap;
  box-shadow: 0 2px 8px rgba(0,0,0,.2);
}

.vm-original-note {
  background: #FFFDE7; border: 1px solid #FFF59D;
  border-radius: 8px; padding: 12px; margin-bottom: 12px;
  font-size: 12px; color: #5D4037; line-height: 1.5;
}

/* ── Source badges ── */
.vm-source-badge {
  display: inline-block; padding: 2px 7px; border-radius: 9px;
  font-size: 10px; font-weight: 700; letter-spacing: .2px;
}
.vm-source-text { background: #E3F2FD; color: #0D47A1; }
.vm-source-img  { background: #F3E5F5; color: #4A148C; }

/* ── Cost confirmation dialog ── */
#vegmenu-cost-overlay {
  position: fixed; inset: 0;
  background: rgba(0,0,0,.55);
  z-index: 2147483647;
  display: flex; align-items: center; justify-content: center;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
}
.vm-cost-box {
  background: #fff; border-radius: 14px; padding: 26px;
  max-width: 420px; width: 92%;
  box-shadow: 0 24px 64px rgba(0,0,0,.3);
}
.vm-cost-box h3 { margin: 0 0 4px; font-size: 17px; color: #1a1a1a; }
.vm-cost-box .vm-cost-sub {
  font-size: 13px; color: #888; margin-bottom: 18px;
}
.vm-cost-stats {
  background: #f8f9fa; border-radius: 10px;
  padding: 14px 16px; margin-bottom: 16px;
  display: flex; flex-direction: column; gap: 8px;
}
.vm-cost-row {
  display: flex; justify-content: space-between; align-items: center;
  font-size: 13px;
}
.vm-cost-row .vm-cost-label { color: #666; }
.vm-cost-row .vm-cost-val   { font-weight: 700; color: #1a1a1a; }
.vm-cost-row .vm-cost-free  { font-weight: 700; color: #27AE60; }
.vm-cost-row .vm-cost-amt   { font-weight: 700; color: #E65100; font-size: 15px; }
.vm-cost-divider {
  border: none; border-top: 1px solid #e9ecef; margin: 2px 0;
}
.vm-cost-note {
  background: #FFF8E1; border: 1px solid #FFE082;
  border-radius: 8px; padding: 10px 12px;
  font-size: 11px; color: #6D4C41; line-height: 1.5;
  margin-bottom: 18px;
}
.vm-cost-text-found {
  background: #E8F5E9; border: 1px solid #A5D6A7;
  border-radius: 8px; padding: 10px 12px;
  font-size: 12px; color: #1B5E20; line-height: 1.5;
  margin-bottom: 12px; display: flex; align-items: flex-start; gap: 8px;
}
.vm-cost-actions { display: flex; gap: 10px; }
    `;
    document.head.appendChild(s);
  }

  // ─── Loading Indicator ───────────────────────────────────────────────────────
  function showLoading(msg = 'Scanning for menus…') {
    hideLoading();
    const div = document.createElement('div');
    div.id = 'vegmenu-loading';
    div.innerHTML = `<div class="vm-spinner"></div><span>${esc(msg)}</span>`;
    document.body.appendChild(div);
  }
  function hideLoading() {
    document.getElementById('vegmenu-loading')?.remove();
  }

  // ─── Image Collection ────────────────────────────────────────────────────────
  function getPageImages() {
    return Array.from(document.querySelectorAll('img'))
      .filter(img => {
        const w = img.naturalWidth  || img.offsetWidth;
        const h = img.naturalHeight || img.offsetHeight;
        return w >= MIN_IMAGE_PX && h >= MIN_IMAGE_PX
          && img.src && /^https?:/.test(img.src);
      })
      .slice(0, MAX_IMAGES);
  }

  // ─── Text Extraction ─────────────────────────────────────────────────────────
  const SKIP_TAGS = new Set(['SCRIPT','STYLE','NOSCRIPT','NAV','HEADER','FOOTER','ASIDE','IFRAME','SVG']);
  const SKIP_ROLES = new Set(['navigation','banner','contentinfo','search']);

  function extractPageText() {
    const lines = [];

    function walk(node) {
      if (node.nodeType === Node.TEXT_NODE) {
        const t = node.textContent.trim();
        if (t) lines.push(t);
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      if (SKIP_TAGS.has(node.tagName)) return;
      if (SKIP_ROLES.has(node.getAttribute?.('role'))) return;
      for (const child of node.childNodes) walk(child);
    }

    walk(document.body);

    return lines
      .join('\n')
      .replace(/[ \t]{2,}/g, ' ')   // collapse horizontal whitespace
      .replace(/\n{3,}/g, '\n\n')   // collapse blank lines
      .trim()
      .slice(0, 8000);               // cap token cost
  }

  // ─── Core: Analyze text ──────────────────────────────────────────────────────
  function callAnalyzeText(pageText) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ action: 'analyzeText', pageText }, res => {
        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
        res.success ? resolve(res.data) : reject(new Error(res.error));
      });
    });
  }

  // ─── Confirmation Dialog ─────────────────────────────────────────────────────
  function showConfirmDialog(imageUrl, confidence) {
    return new Promise(resolve => {
      const overlay = document.createElement('div');
      overlay.id = 'vegmenu-confirm-overlay';
      overlay.innerHTML = `
        <div class="vm-confirm-box">
          <h3>Is this a restaurant menu?</h3>
          <p>VegMenu detected a possible menu but wants your confirmation.</p>
          <img class="vm-confirm-img" src="${esc(imageUrl)}" alt="Possible menu" />
          <div class="vm-conf-badge">AI Confidence: ${confidence}%</div>
          <div class="vm-confirm-actions">
            <button class="vm-btn-secondary" id="vm-no">Skip</button>
            <button class="vm-btn-primary"   id="vm-yes">Yes, Filter It</button>
          </div>
        </div>`;
      document.body.appendChild(overlay);

      const cleanup = (val) => { overlay.remove(); resolve(val); };
      document.getElementById('vm-yes').onclick = () => cleanup(true);
      document.getElementById('vm-no').onclick  = () => cleanup(false);
      overlay.onclick = e => { if (e.target === overlay) cleanup(false); };
    });
  }

  // ─── Cost Confirmation Dialog ────────────────────────────────────────────────
  const COST_PER_IMAGE = 0.02; // rough estimate per vision call in USD

  function showCostDialog(imageCount, textMenuFound) {
    return new Promise(resolve => {
      const estimatedCost = (imageCount * COST_PER_IMAGE).toFixed(2);

      const textFoundHtml = textMenuFound
        ? `<div class="vm-cost-text-found">
            <span>✅</span>
            <span><strong>Text menu already found (free).</strong> Image scan is optional — it may find additional menus in photos.</span>
           </div>`
        : '';

      const overlay = document.createElement('div');
      overlay.id = 'vegmenu-cost-overlay';
      overlay.innerHTML = `
        <div class="vm-cost-box">
          <h3>📸 Scan Images for Menus?</h3>
          <p class="vm-cost-sub">Review estimated cost before proceeding.</p>

          ${textFoundHtml}

          <div class="vm-cost-stats">
            <div class="vm-cost-row">
              <span class="vm-cost-label">📝 Text analysis</span>
              <span class="vm-cost-free">✓ Free</span>
            </div>
            <hr class="vm-cost-divider" />
            <div class="vm-cost-row">
              <span class="vm-cost-label">🖼 Images found</span>
              <span class="vm-cost-val">${imageCount}</span>
            </div>
            <div class="vm-cost-row">
              <span class="vm-cost-label">Est. cost per image</span>
              <span class="vm-cost-val">~$${COST_PER_IMAGE.toFixed(2)}</span>
            </div>
            <hr class="vm-cost-divider" />
            <div class="vm-cost-row">
              <span class="vm-cost-label" style="font-weight:600">Estimated total</span>
              <span class="vm-cost-amt">~$${estimatedCost}</span>
            </div>
          </div>

          <div class="vm-cost-note">
            ⚠ Cost estimates are approximate. Actual charges depend on image size and API usage.
            Check your <strong>Anthropic Console</strong> for real-time usage.
          </div>

          <div class="vm-cost-actions">
            <button class="vm-btn-secondary" id="vm-cost-cancel">Cancel</button>
            <button class="vm-btn-primary"   id="vm-cost-scan">Scan All ${imageCount} Image${imageCount !== 1 ? 's' : ''}</button>
          </div>
        </div>`;

      document.body.appendChild(overlay);

      const cleanup = val => { overlay.remove(); resolve(val); };
      document.getElementById('vm-cost-scan').onclick   = () => cleanup(true);
      document.getElementById('vm-cost-cancel').onclick = () => cleanup(false);
      overlay.onclick = e => { if (e.target === overlay) cleanup(false); };
    });
  }

  // ─── Panel ───────────────────────────────────────────────────────────────────
  function buildPanel() {
    if (document.getElementById('vegmenu-panel')) return;

    const panel = document.createElement('div');
    panel.id = 'vegmenu-panel';
    panel.innerHTML = `
      <div id="vegmenu-panel-header">
        <h2>🌿 Vegetarian Options</h2>
        <button id="vegmenu-close-btn" title="Close">✕</button>
      </div>
      <div id="vegmenu-view-toggle">
        <button class="vm-view-btn active" data-mode="filtered">🌿 Filtered View</button>
        <button class="vm-view-btn"        data-mode="original">📋 Original Menu</button>
      </div>
      <div id="vegmenu-panel-content">
        <div class="vm-empty">
          <div class="vm-empty-icon">🔍</div>
          <p>Click <strong>Scan This Page</strong> in the extension popup to find vegetarian options.</p>
        </div>
      </div>`;
    document.body.appendChild(panel);

    // Floating toggle tab
    const tab = document.createElement('button');
    tab.id = 'vegmenu-toggle-btn';
    tab.title = 'Toggle VegMenu';
    tab.innerHTML = '🌿<span class="vm-label">VegMenu</span>';
    document.body.appendChild(tab);

    // Events
    document.getElementById('vegmenu-close-btn').onclick = closePanel;
    tab.onclick = () => {
      document.getElementById('vegmenu-panel').classList.contains('open')
        ? closePanel()
        : openPanel();
    };
    panel.querySelectorAll('.vm-view-btn').forEach(btn => {
      btn.onclick = () => switchView(btn.dataset.mode);
    });
  }

  function openPanel() {
    const panel = document.getElementById('vegmenu-panel');
    const tab   = document.getElementById('vegmenu-toggle-btn');
    panel?.classList.add('open');
    if (tab) tab.style.right = '360px';
  }
  function closePanel() {
    const panel = document.getElementById('vegmenu-panel');
    const tab   = document.getElementById('vegmenu-toggle-btn');
    panel?.classList.remove('open');
    if (tab) tab.style.right = '0';
  }

  function switchView(mode) {
    currentView = mode;
    document.querySelectorAll('.vm-view-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.mode === mode);
    });
    const content = document.getElementById('vegmenu-panel-content');
    if (content) {
      mode === 'filtered' ? renderFiltered(content) : renderOriginal(content);
    }
    // Manage image highlights
    document.querySelectorAll('.vm-highlighted').forEach(el => el.classList.remove('vm-highlighted'));
    if (mode === 'original') {
      scanResults.forEach(r => r.element?.classList.add('vm-highlighted'));
    }
  }

  // ─── Renderers ───────────────────────────────────────────────────────────────
  function renderFiltered(container) {
    const menus = scanResults.filter(r => r.items?.length > 0);
    if (menus.length === 0) {
      container.innerHTML = `
        <div class="vm-empty">
          <div class="vm-empty-icon">😔</div>
          <p>No vegetarian items found in the detected menus on this page.</p>
        </div>`;
      return;
    }

    let imgIndex = 0;
    container.innerHTML = menus.map(r => {
      let icon, label, badge;
      if (r.source === 'text') {
        icon  = '📝';
        label = 'Text Menu';
        badge = `<span class="vm-source-badge vm-source-text">Page Text</span>`;
      } else {
        imgIndex++;
        icon  = '🖼';
        label = `Image Menu ${imgIndex}`;
        badge = `<span class="vm-source-badge vm-source-img">Photo</span>`;
      }

      return `
        <div class="vm-menu-section">
          <div class="vm-menu-section-head">
            ${icon} ${label} ${badge}
            <span style="color:#aaa;font-weight:400;margin-left:auto">
              ${r.items.length} item${r.items.length !== 1 ? 's' : ''}
            </span>
          </div>
          ${r.items.map(item => `
            <div class="vm-item">
              <div>
                <div class="vm-item-name">${esc(item.name)}</div>
                ${item.description ? `<div class="vm-item-desc">${esc(item.description)}</div>` : ''}
              </div>
              <div class="vm-item-right">
                ${item.price   ? `<span class="vm-price">${esc(item.price)}</span>` : ''}
                ${item.isVegan ? `<span class="vm-vegan-badge">Vegan</span>`        : ''}
              </div>
            </div>`).join('')}
        </div>`;
    }).join('');
  }

  function renderOriginal(container) {
    // Show ALL items (veg + non-veg). Fall back to veg-only if allItems not populated.
    const menus = scanResults.filter(r => (r.allItems?.length || r.items?.length) > 0);

    if (menus.length === 0) {
      container.innerHTML = `
        <div class="vm-empty">
          <div class="vm-empty-icon">📋</div>
          <p>No menus detected yet. Run a scan first.</p>
        </div>`;
      return;
    }

    let imgIndex = 0;
    container.innerHTML = menus.map(r => {
      // Use full item list when available; fall back to vegetarian-only
      const allItems  = r.allItems?.length ? r.allItems : r.items;
      const vegCount  = allItems.filter(i => i.isVegetarian).length;
      const total     = allItems.length;

      let icon, label, badge;
      if (r.source === 'text') {
        icon  = '📝';
        label = 'Text Menu';
        badge = `<span class="vm-source-badge vm-source-text">Page Text</span>`;
      } else {
        imgIndex++;
        icon  = '🖼';
        label = `Image Menu ${imgIndex}`;
        badge = `<span class="vm-source-badge vm-source-img">Photo</span>`;
      }

      return `
        <div class="vm-menu-section">
          <div class="vm-menu-section-head">
            ${icon} ${label} ${badge}
            <span style="color:#aaa;font-weight:400;margin-left:auto">
              ${vegCount} veg · ${total} total
            </span>
          </div>
          ${allItems.map(item => `
            <div class="vm-item${item.isVegetarian ? '' : ' vm-nonveg'}">
              <div>
                <div class="vm-item-name">${esc(item.name)}</div>
                ${item.description ? `<div class="vm-item-desc">${esc(item.description)}</div>` : ''}
              </div>
              <div class="vm-item-right">
                ${item.price ? `<span class="vm-price">${esc(item.price)}</span>` : ''}
                ${item.isVegan
                  ? `<span class="vm-vegan-badge">Vegan</span>`
                  : item.isVegetarian
                    ? `<span class="vm-veg-badge">🌿 Vegetarian</span>`
                    : `<span class="vm-nonveg-badge">Contains meat</span>`}
              </div>
            </div>`).join('')}
        </div>`;
    }).join('');
  }

  // ─── Overlay Badges (overlay display mode) ───────────────────────────────────
  function placeOverlayBadges() {
    document.querySelectorAll('.vm-img-badge').forEach(b => b.remove());
    scanResults.forEach(r => {
      if (!r.element || !r.items?.length) return;
      const rect = r.element.getBoundingClientRect();
      const badge = document.createElement('div');
      badge.className = 'vm-img-badge';
      badge.textContent = `🌿 ${r.items.length} veg item${r.items.length !== 1 ? 's' : ''}`;
      badge.style.top  = `${rect.top  + window.scrollY + 8}px`;
      badge.style.left = `${rect.left + window.scrollX + 8}px`;
      document.body.appendChild(badge);
    });
  }

  // ─── Core: Analyze one image ─────────────────────────────────────────────────
  function callAnalyzeImage(imageUrl) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ action: 'analyzeImage', imageUrl }, res => {
        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
        res.success ? resolve(res.data) : reject(new Error(res.error));
      });
    });
  }

  // ─── Error classification ────────────────────────────────────────────────────
  function isFatalError(msg) {
    return msg.includes('API key')
        || msg.includes('server not running')
        || msg.includes('Cannot connect')
        || msg.includes('ANTHROPIC_API_KEY');
  }

  // ─── Fatal error display ─────────────────────────────────────────────────────
  function handleFatalError(msg) {
    hideLoading();
    showLoading(`⚠ ${msg}`);
    setTimeout(hideLoading, 5000);
    isScanning = false;
  }

  // ─── Main Scan ───────────────────────────────────────────────────────────────
  // options.autoScan = true  → always-on mode; skips image scanning & cost dialog
  async function scanPage(options = {}) {
    const { autoScan = false } = options;
    if (isScanning) return;
    isScanning = true;
    scanResults = [];
    currentView = 'filtered';

    injectStyles();
    buildPanel();

    displayMode = await new Promise(resolve =>
      chrome.storage.sync.get({ displayMode: 'list' }, s => resolve(s.displayMode))
    );

    try {
      // ── Phase 1: Text analysis (free, always runs) ────────────────────────
      showLoading('Analyzing page text…');
      const pageText = extractPageText();
      let textMenuFound = false;

      if (pageText.length > 150) {
        try {
          const textResult = await callAnalyzeText(pageText);
          if (textResult.isMenu && textResult.vegetarianItems?.length > 0) {
            textMenuFound = true;
            scanResults.push({
              source:     'text',
              items:      textResult.vegetarianItems || [],
              allItems:   textResult.allItems        || [],
              confidence: textResult.confidence
            });
          }
        } catch (err) {
          console.error('[VegMenu] Text analysis error:', err.message);
          if (isFatalError(err.message)) { handleFatalError(err.message); return; }
          // Non-fatal: continue to image phase
        }
      }

      // ── Phase 2: Image scanning (manual scan only, with cost confirmation) ─
      const images = getPageImages();

      if (!autoScan && images.length > 0) {
        hideLoading();
        const proceed = await showCostDialog(images.length, textMenuFound);

        if (proceed) {
          for (let i = 0; i < images.length; i++) {
            showLoading(`Analyzing image ${i + 1} of ${images.length}…`);
            try {
              const result = await callAnalyzeImage(images[i].src);

              if (result.confidence < 50) continue;

              if (result.isMenu && result.confidence < 85) {
                const ok = await showConfirmDialog(images[i].src, result.confidence);
                if (!ok) continue;
              }

              if (result.isMenu) {
                scanResults.push({
                  source:     'image',
                  imageUrl:   images[i].src,
                  element:    images[i],
                  items:      result.vegetarianItems || [],
                  allItems:   result.allItems        || [],
                  confidence: result.confidence
                });
              }
            } catch (err) {
              console.error('[VegMenu]', err.message);
              if (isFatalError(err.message)) { handleFatalError(err.message); return; }
            }
          }
        }
      }

      // ── Phase 3: Show results ─────────────────────────────────────────────
      hideLoading();

      if (scanResults.length === 0) {
        showLoading('No menus detected on this page.');
        setTimeout(hideLoading, 2500);
      } else {
        const totalItems = scanResults.reduce((n, r) => n + (r.items?.length || 0), 0);
        chrome.runtime.sendMessage({ action: 'setBadge', text: String(totalItems) });

        const content = document.getElementById('vegmenu-panel-content');
        if (content) renderFiltered(content);
        openPanel();

        if (displayMode === 'overlay') placeOverlayBadges();
        showBanner();
      }

    } catch (err) {
      hideLoading();
      showLoading(`Error: ${err.message}`);
      setTimeout(hideLoading, 3500);
    }

    isScanning = false;
  }

  // ─── Active-mode banner ──────────────────────────────────────────────────────
  function showBanner() {
    const existing = document.getElementById('vegmenu-banner');
    if (existing) { existing.remove(); }
    const banner = document.createElement('div');
    banner.id = 'vegmenu-banner';
    banner.style.cssText = `
      position:fixed; top:0; left:50%; transform:translateX(-50%);
      background:#27AE60; color:#fff;
      padding:8px 20px; border-radius:0 0 12px 12px;
      font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
      font-size:13px; font-weight:700;
      z-index:2147483646;
      box-shadow:0 4px 14px rgba(39,174,96,.35);
    `;
    banner.textContent = '🌿 Vegetarian Mode Active';
    document.body.appendChild(banner);
    setTimeout(() => banner.remove(), 3000);
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────
  function esc(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;')
      .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // ─── Message Listener ─────────────────────────────────────────────────────────
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.action === 'startScan') {
      scanPage()
        .then(()  => sendResponse({ success: true }))
        .catch(e  => sendResponse({ success: false, error: e.message }));
      return true;
    }

    if (msg.action === 'getStatus') {
      sendResponse({
        success:    true,
        isScanning,
        menusFound: scanResults.length,
        itemsFound: scanResults.reduce((n, r) => n + (r.items?.length || 0), 0)
      });
      return true;
    }

    if (msg.action === 'togglePanel') {
      injectStyles();
      buildPanel();
      const panel = document.getElementById('vegmenu-panel');
      panel?.classList.contains('open') ? closePanel() : openPanel();
      sendResponse({ success: true });
      return true;
    }

    return false;
  });

  // ─── Auto-scan if "Always On" ────────────────────────────────────────────────
  // autoScan=true → text-only (free); image scanning requires manual confirmation
  chrome.storage.sync.get({ alwaysOn: false }, ({ alwaysOn }) => {
    if (!alwaysOn) return;
    const run = () => setTimeout(() => scanPage({ autoScan: true }), 800);
    document.readyState === 'complete' ? run() : window.addEventListener('load', run);
  });

})();
