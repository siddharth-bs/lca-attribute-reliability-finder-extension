/**
 * Content Script — Attribute Reliability Tracker
 *
 * Capture triggers:
 *   1. Page load (full reload or new tab) — fires when DOM settles (idle detection)
 *   2. SPA navigation (pushState / replaceState / popstate / hashchange)
 *   3. Significant DOM mutations after initial load (lazy content, modals, AJAX)
 *
 * Key design decisions:
 *   - "DOM idle" detection: snapshot fires when DOM stops mutating for 800ms
 *     (handles slow sites, SSR hydration, lazy loading)
 *   - Hard cap at 6s: if DOM never settles, snapshot anyway
 *   - replaceState during initial load is ignored (common in Next.js/React Router)
 *   - Per-element structural fingerprint sent with each snapshot
 */

const TRACKED_ATTRIBUTES = [
  'id', 'class', 'name', 'type', 'role', 'aria-label', 'aria-labelledby',
  'aria-describedby', 'data-testid', 'data-cy', 'data-qa', 'data-id',
  'data-automation', 'data-test', 'placeholder', 'href', 'src',
  'alt', 'title', 'value', 'for', 'action', 'method', 'tabindex',
  'autocomplete', 'required', 'disabled', 'readonly', 'checked',
  'selected', 'multiple', 'pattern', 'min', 'max', 'step', 'maxlength'
];

const MAX_ELEMENTS = 500;

const SKIP_TAGS = new Set([
  'script', 'style', 'head', 'meta', 'link', 'noscript',
  'template', 'svg', 'path', 'defs', 'symbol', 'use',
  'br', 'hr', 'wbr'
]);

// DOM idle: snapshot fires after DOM is quiet for this long
const DOM_IDLE_MS      = 800;
// Hard cap: snapshot fires at most this long after DOMContentLoaded
const DOM_MAX_WAIT_MS  = 6000;
// After a snapshot, suppress mutation observer for this long
const POST_SNAP_QUIET  = 3000;
// Mutation observer debounce
const MUT_DEBOUNCE_MS  = 2000;
// Min nodes added to trigger a mutation snapshot
const MUT_THRESHOLD    = 5;

// ── State ─────────────────────────────────────────────────────────────────────
let snapshotSentForCurrentPage = false;
let lastSnapshotTime           = 0;
let idleTimer                  = null;
let hardCapTimer               = null;
let mutDebounceTimer           = null;
let mutCount                   = 0;
let navigationReady = false;  // true after first page snapshot fires

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
    if (parts.length > 10) break;  // increased from 6 to reduce fingerprint collisions on deep DOMs
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

function sendSnapshot(reason) {
  const host = window.location.hostname;
  if (!host || host === 'newtab') return;

  const now  = Date.now();
  lastSnapshotTime = now;
  const path = window.location.pathname || '/';
  const msg  = { type: 'SNAPSHOT', host, path, snapshot: collectSnapshot(), timestamp: now, reason };

  function trySend(left) {
    chrome.runtime.sendMessage(msg, () => {
      if (chrome.runtime.lastError && left > 0) setTimeout(() => trySend(left - 1), 600);
    });
  }
  trySend(2);
}

// ── DOM idle detection ────────────────────────────────────────────────────────
// Watches DOM mutations and fires snapshot once DOM is quiet for DOM_IDLE_MS.
// Hard cap ensures snapshot fires even on infinitely-loading pages.
const idleObserver = new MutationObserver(() => {
  // Reset idle timer on every mutation
  clearTimeout(idleTimer);
  idleTimer = setTimeout(firePageSnapshot, DOM_IDLE_MS);
});

function startIdleDetection() {
  if (!document.body) return;
  // attributes: false — we only need structural settlement, not attribute changes.
  // Observing attributes causes CSS animations/hover states to reset the idle timer.
  idleObserver.observe(document.body, { childList: true, subtree: true });
  // Idle timer: fires if DOM is already quiet
  clearTimeout(idleTimer);
  idleTimer = setTimeout(firePageSnapshot, DOM_IDLE_MS);
  // Hard cap: fire no matter what after DOM_MAX_WAIT_MS
  clearTimeout(hardCapTimer);
  hardCapTimer = setTimeout(firePageSnapshot, DOM_MAX_WAIT_MS);
}

function firePageSnapshot() {
  if (snapshotSentForCurrentPage) return;
  snapshotSentForCurrentPage = true;
  clearTimeout(idleTimer);
  clearTimeout(hardCapTimer);
  idleObserver.disconnect();
  sendSnapshot('page-load');
  navigationReady = true;
  // Start mutation observer for post-load dynamic content after quiet period
  setTimeout(startMutationObserver, POST_SNAP_QUIET);
}

// ── 1. Page load ──────────────────────────────────────────────────────────────
function initPageLoad() {
  snapshotSentForCurrentPage = false;
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => startIdleDetection());
  } else {
    // DOM already ready (script injected late, or readyState is interactive/complete)
    startIdleDetection();
  }
}

initPageLoad();

// ── 2. SPA navigation ─────────────────────────────────────────────────────────
let lastUrl = location.href;

function onUrlChange() {
  const current = location.href;
  if (current === lastUrl) return;

  // Ignore replaceState calls that happen during initial page load
  // (common in Next.js, React Router, Vue Router during hydration)
  if (!navigationReady && current.split('?')[0] === lastUrl.split('?')[0]) return;

  lastUrl = current;
  snapshotSentForCurrentPage = false;
  navigationReady = false;

  // Stop post-load mutation observer during navigation
  mutObserver.disconnect();
  clearTimeout(mutDebounceTimer);

  // Use idle detection for the new route too (handles slow SPA route renders)
  idleObserver.disconnect();
  clearTimeout(idleTimer);
  clearTimeout(hardCapTimer);

  // Wait a tick for the router to update the DOM, then start idle detection
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
// Only active after the initial page snapshot has fired.
// Captures lazy-loaded content, modals, AJAX updates.
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