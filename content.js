/**
 * Content Script — Attribute Reliability Tracker
 *
 * Capture triggers:
 *   1. Page load — auto-refreshes 4x on first visit to a new page (with overlay)
 *   2. SPA navigation (pushState / replaceState / popstate / hashchange)
 *   3. Significant DOM mutations after initial load (lazy content, modals, AJAX)
 */

const TRACKED_ATTRIBUTES = [
  'id', 'class', 'name', 'type', 'role', 'aria-label', 'aria-labelledby',
  'aria-describedby', 'data-testid', 'data-cy', 'data-qa', 'data-id',
  'data-automation', 'data-test', 'placeholder', 'href', 'src',
  'alt', 'title', 'value', 'for', 'action', 'method', 'tabindex',
  'autocomplete', 'required', 'disabled', 'readonly', 'checked',
  'selected', 'multiple', 'pattern', 'min', 'max', 'step', 'maxlength'
];

const MAX_ELEMENTS    = 500;
const AUTO_RELOAD_COUNT = 4;   // number of auto-reloads per new page
const DOM_IDLE_MS     = 800;
const DOM_MAX_WAIT_MS = 6000;
const POST_SNAP_QUIET = 3000;
const MUT_DEBOUNCE_MS = 2000;
const MUT_THRESHOLD   = 5;

const SKIP_TAGS = new Set([
  'script', 'style', 'head', 'meta', 'link', 'noscript',
  'template', 'svg', 'path', 'defs', 'symbol', 'use',
  'br', 'hr', 'wbr'
]);

// ── State ─────────────────────────────────────────────────────────────────────
let snapshotSentForCurrentPage = false;
let lastSnapshotTime           = 0;
let idleTimer                  = null;
let hardCapTimer               = null;
let mutDebounceTimer           = null;
let mutCount                   = 0;
let navigationReady            = false;

// ── Overlay ───────────────────────────────────────────────────────────────────
let overlayEl = null;

function showOverlay(current, total) {
  if (!overlayEl) {
    overlayEl = document.createElement('div');
    overlayEl.id = '__art_overlay__';
    overlayEl.style.cssText = [
      'position:fixed', 'inset:0', 'z-index:2147483647',
      'background:rgba(15,17,23,0.92)', 'display:flex',
      'flex-direction:column', 'align-items:center', 'justify-content:center',
      'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
      'color:#e2e8f0', 'gap:16px', 'backdrop-filter:blur(4px)'
    ].join(';');
    document.documentElement.appendChild(overlayEl);
  }
  const pct = Math.round((current / total) * 100);
  overlayEl.innerHTML = `
    <div style="font-size:28px">🎯</div>
    <div style="font-size:16px;font-weight:700;color:#fff">Attribute Reliability Tracker</div>
    <div style="font-size:13px;color:#a0aec0">Analysing page attributes — snapshot ${current} of ${total}</div>
    <div style="width:220px;height:6px;background:#2d3748;border-radius:3px;overflow:hidden">
      <div style="height:100%;width:${pct}%;background:#63b3ed;border-radius:3px;transition:width 0.3s"></div>
    </div>
    <div style="font-size:11px;color:#4a5568">Please wait — do not navigate away</div>
  `;
}

function hideOverlay() {
  if (overlayEl) { overlayEl.remove(); overlayEl = null; }
}

// ── Element fingerprint ───────────────────────────────────────────────────────
function getFingerprint(el) {
  const parts = [];
  let node = el;
  while (node && node !== document.documentElement) {
    const tag    = node.tagName.toLowerCase();
    const parent = node.parentElement;
    let idx = 0;
    if (parent) {
      const siblings = Array.from(parent.children).filter(c => c.tagName === node.tagName);
      idx = siblings.indexOf(node);
    }
    parts.unshift(`${tag}[${idx}]`);
    node = parent;
    if (parts.length > 10) break;
  }
  return parts.join('>');
}

// ── Core snapshot ─────────────────────────────────────────────────────────────
function collectSnapshot() {
  const elements = Array.from(document.querySelectorAll('*')).slice(0, MAX_ELEMENTS);
  const snapshot = [];
  for (const el of elements) {
    if (SKIP_TAGS.has(el.tagName.toLowerCase())) continue;
    const attrs = {};
    for (const attr of TRACKED_ATTRIBUTES) {
      const val = el.getAttribute(attr);
      if (val !== null) attrs[attr] = val;
    }
    if (Object.keys(attrs).length > 0) {
      snapshot.push({ tag: el.tagName.toLowerCase(), fp: getFingerprint(el), attrs });
    }
  }
  return snapshot;
}

// ── Extension context guard ───────────────────────────────────────────────────
// After an extension reload/update, the content script's chrome.* APIs become
// invalid. Wrap every chrome.* call with this check to prevent uncaught errors.
function isContextValid() {
  try {
    return !!(chrome && chrome.runtime && chrome.runtime.id);
  } catch {
    return false;
  }
}

function getEffectiveHost(hostname, settings) {
  if (!settings.groupSubdomains) return hostname;
  const parts = hostname.split('.');
  // Keep last 2 parts (example.com), or full hostname if already short
  return parts.length > 2 ? parts.slice(-2).join('.') : hostname;
}

function sendSnapshot(reason, onDone) {
  if (!isContextValid()) { onDone?.(); return; }
  const rawHost = window.location.hostname;
  if (!rawHost || rawHost === 'newtab') { onDone?.(); return; }

  // Read settings to apply subdomain grouping and check if capture is allowed
  chrome.storage.local.get('art_settings', (r) => {
    if (!isContextValid()) { onDone?.(); return; }
    const settings = (r && r['art_settings']) || {};
    const host = getEffectiveHost(rawHost, settings);
    const now  = Date.now();
    lastSnapshotTime = now;
    const path = window.location.pathname || '/';
    const msg  = { type: 'SNAPSHOT', host, path, snapshot: collectSnapshot(), timestamp: now, reason };

    function trySend(left) {
      chrome.runtime.sendMessage(msg, (res) => {
        if (chrome.runtime.lastError && left > 0) {
          setTimeout(() => trySend(left - 1), 600);
        } else {
          onDone?.();
        }
      });
    }
    trySend(2);
  });
}

// ── Auto-refresh logic ────────────────────────────────────────────────────────
// Uses sessionStorage (always available in content scripts, cleared on tab close)
// Key: __art_N__ where N = hostname+pathname, value = reload count done so far

function getPageKey() {
  return '__art_' + window.location.hostname + window.location.pathname + '__';
}

function handleAutoRefresh(onComplete) {
  if (!isContextValid()) { onComplete(); return; }
  const rawHost = window.location.hostname;
  if (!rawHost || rawHost === 'newtab') { onComplete(); return; }

  // First check if a run is active for this host — if not, skip everything
  chrome.storage.local.get(['art_settings', 'runs_data'], (r) => {
    if (!isContextValid()) { onComplete(); return; }
    const settings = (r && r['art_settings']) || {};
    const host     = getEffectiveHost(rawHost, settings);
    const runsData = (r && r['runs_data']) || {};
    const hostData = runsData[host];
    const hasActiveRun = !!(hostData && hostData.activeRunId);

    if (!hasActiveRun) {
      // No active run — don't auto-refresh, just let the page load normally
      onComplete();
      return;
    }

    const key  = getPageKey();
    const done = parseInt(sessionStorage.getItem(key) || '0', 10);

    if (done >= AUTO_RELOAD_COUNT) {
      // All reloads done — capture final snapshot and let user browse freely
      sessionStorage.removeItem(key);
      sendSnapshot('page-load', () => onComplete());
      return;
    }

    // Active run exists — show overlay, capture, then reload
    showOverlay(done + 1, AUTO_RELOAD_COUNT);
    sendSnapshot('auto-refresh', () => {
      sessionStorage.setItem(key, String(done + 1));
      setTimeout(() => { location.reload(); }, 700);
    });
  });
}

// ── DOM idle detection ────────────────────────────────────────────────────────
const idleObserver = new MutationObserver(() => {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(firePageSnapshot, DOM_IDLE_MS);
});

function startIdleDetection() {
  if (!document.body) return;
  idleObserver.observe(document.body, { childList: true, subtree: true });
  clearTimeout(idleTimer);
  idleTimer = setTimeout(firePageSnapshot, DOM_IDLE_MS);
  clearTimeout(hardCapTimer);
  hardCapTimer = setTimeout(firePageSnapshot, DOM_MAX_WAIT_MS);
}

function firePageSnapshot() {
  if (snapshotSentForCurrentPage) return;
  snapshotSentForCurrentPage = true;
  clearTimeout(idleTimer);
  clearTimeout(hardCapTimer);
  idleObserver.disconnect();

  // handleAutoRefresh calls onComplete() when all reloads are done (no more reloads needed)
  // It does NOT call onComplete() when it's about to reload the page
  handleAutoRefresh(() => {
    // All reloads done — hide overlay, mark ready, start mutation observer
    hideOverlay();
    navigationReady = true;
    setTimeout(startMutationObserver, POST_SNAP_QUIET);
  });
}

// ── 1. Page load ──────────────────────────────────────────────────────────────
function initPageLoad() {
  snapshotSentForCurrentPage = false;
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => startIdleDetection());
  } else {
    startIdleDetection();
  }
}

initPageLoad();

// ── 2. SPA navigation ─────────────────────────────────────────────────────────
let lastUrl = location.href;

function onUrlChange() {
  const current = location.href;
  if (current === lastUrl) return;
  if (!navigationReady && current.split('?')[0] === lastUrl.split('?')[0]) return;

  lastUrl = current;
  snapshotSentForCurrentPage = false;
  navigationReady = false;

  mutObserver.disconnect();
  clearTimeout(mutDebounceTimer);
  idleObserver.disconnect();
  clearTimeout(idleTimer);
  clearTimeout(hardCapTimer);

  setTimeout(() => {
    if (document.body) startIdleDetection();
  }, 100);
}

const _push    = history.pushState.bind(history);
const _replace = history.replaceState.bind(history);
history.pushState    = function (...args) { _push(...args);    onUrlChange(); };
history.replaceState = function (...args) { _replace(...args); onUrlChange(); };
window.addEventListener('popstate',   onUrlChange);
window.addEventListener('hashchange', onUrlChange);

// ── 3. Post-load mutation observer ───────────────────────────────────────────
const mutObserver = new MutationObserver((mutations) => {
  if (Date.now() - lastSnapshotTime < POST_SNAP_QUIET) return;
  let added = 0;
  for (const m of mutations) added += m.addedNodes.length;
  mutCount += added;
  if (mutCount >= MUT_THRESHOLD) {
    mutCount = 0;
    clearTimeout(mutDebounceTimer);
    mutDebounceTimer = setTimeout(() => sendSnapshot('dom-mutation'), MUT_DEBOUNCE_MS);
  }
});

function startMutationObserver() {
  if (!document.body) return;
  mutObserver.disconnect();
  mutObserver.observe(document.body, { childList: true, subtree: true });
}