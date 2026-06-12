/**
 * Background Service Worker — Attribute Reliability Tracker
 *
 * DATA MODEL:
 *   runs_data[host].runs[runId].pages[path].attributes[attr] = AttrStat
 *   runs_data[host].runs[runId].aggregated[attr] = AttrStat  (merged view)
 *
 * prev_snapshots[host][runId][path] = attrValueMap  (last snapshot per path)
 *
 * AttrStat: { seenCount, stableCount, changedCount, uniqueValueCount,
 *             uniqueValuesSet, firstSeenSnapshot, allDynamic, score }
 *
 * KEY DESIGN:
 *   - Stability compared per-path only (no cross-page pollution)
 *   - seenCount = number of snapshots where attr appeared (on this path)
 *   - presenceRatio = seenCount / snapshotCount for THIS path
 *   - Aggregation: weighted average of per-path scores (weighted by snapshotCount)
 */

const RUNS_KEY   = 'runs_data';
const PREV_KEY   = 'prev_snapshots';
const MAX_UNIQUE = 20;
const MIN_SNAPS  = 2;

// Serial queue per host — prevents race conditions on concurrent snapshots
const queue = {};
function enqueue(host, fn) {
  if (!queue[host]) queue[host] = Promise.resolve();
  queue[host] = queue[host].then(fn).catch(console.error);
}

// ── Keep-alive: prevent MV3 service worker from sleeping during active runs ───
// Chrome terminates idle service workers after ~30s. We ping storage every 20s
// to keep the worker alive as long as any run is active.
let keepAliveInterval = null;

function startKeepAlive() {
  if (keepAliveInterval) return;
  keepAliveInterval = setInterval(async () => {
    // Check if any host has an active run
    const r = await chrome.storage.local.get(RUNS_KEY);
    const all = r[RUNS_KEY] || {};
    const anyActive = Object.values(all).some(h => h.activeRunId);
    if (!anyActive) {
      stopKeepAlive();
    }
    // Reading storage is enough to keep the worker alive
  }, 20000);
}

function stopKeepAlive() {
  if (keepAliveInterval) {
    clearInterval(keepAliveInterval);
    keepAliveInterval = null;
  }
}

// Start keep-alive on service worker boot — check if runs are active
chrome.storage.local.get(RUNS_KEY, (r) => {
  const all = r[RUNS_KEY] || {};
  const anyActive = Object.values(all).some(h => h.activeRunId);
  if (anyActive) startKeepAlive();
});

// ── Dynamic-value detector ────────────────────────────────────────────────────
// Values matching these are auto-generated and excluded from stability comparison
const DYNAMIC_PATTERNS = [
  /^[a-z]+-[a-f0-9]{5,8}$/i,                                              // css-3f9a2b, btn-x7k2p
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i,    // UUID
  /^\d{10,}$/,                                                              // epoch timestamps
  /^[a-z0-9]{20,}$/i,                                                      // long random tokens
  /^react-[a-z0-9-]+$/i,                                                   // React internals
  /^__[a-z0-9_]+__$/i,                                                     // framework internals
];
function isDynamic(val) { return DYNAMIC_PATTERNS.some(re => re.test(val)); }

// For multi-token attributes like class ("css-3f9a2b card-base card-elevated"),
// check each space-separated token individually.
// A value is considered dynamic if ANY token matches a dynamic pattern.
function isValueDynamic(val) {
  if (!val) return false;
  const tokens = val.trim().split(/\s+/);
  return tokens.some(t => isDynamic(t));
}

function filterStable(values) {
  return values.filter(v => !isValueDynamic(v));
}

// ── Message router ────────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'SNAPSHOT') {
    enqueue(msg.host, () => processSnapshot(msg));
    sendResponse({ ok: true });
    return false;
  }
  if (msg.type === 'START_RUN') {
    enqueue(msg.host, () => startRun(msg.host, msg.name));
    sendResponse({ ok: true });
    return false;
  }
  if (msg.type === 'STOP_RUN') {
    enqueue(msg.host, () => stopRun(msg.host));
    sendResponse({ ok: true });
    return false;
  }
  if (msg.type === 'GET_RUNS') {
    chrome.storage.local.get(RUNS_KEY, (r) => {
      if (chrome.runtime.lastError) { sendResponse({ hostData: null }); return; }
      const all = r[RUNS_KEY] || {};
      sendResponse({ hostData: all[msg.host] || null });
    });
    return true;
  }
  if (msg.type === 'DELETE_RUN') {
    enqueue(msg.host, () => deleteRun(msg.host, msg.runId));
    sendResponse({ ok: true });
    return false;
  }
  if (msg.type === 'CLEAR_HOST') {
    enqueue(msg.host, () => clearHost(msg.host));
    sendResponse({ ok: true });
    return false;
  }
});

// ── Run management ────────────────────────────────────────────────────────────
async function startRun(host, name) {
  const r   = await chrome.storage.local.get(RUNS_KEY);
  const all = r[RUNS_KEY] || {};
  if (!all[host]) all[host] = { activeRunId: null, runs: {} };

  // Stop any currently active run
  if (all[host].activeRunId) {
    const active = all[host].runs[all[host].activeRunId];
    if (active && !active.endedAt) active.endedAt = Date.now();
    all[host].activeRunId = null;
  }

  const runId = `run_${Date.now()}`;
  const runNum = Object.keys(all[host].runs).length + 1;
  all[host].runs[runId] = {
    id: runId,
    name: name || `Run ${runNum}`,
    startedAt: Date.now(),
    endedAt: null,
    snapshotCount: 0,
    pages: {},
    aggregated: {}
  };
  all[host].activeRunId = runId;
  await chrome.storage.local.set({ [RUNS_KEY]: all });
  startKeepAlive();  // keep worker alive while run is recording
}

async function stopRun(host) {
  const [r, p] = await Promise.all([
    chrome.storage.local.get(RUNS_KEY),
    chrome.storage.local.get(PREV_KEY)
  ]);
  const all  = r[RUNS_KEY] || {};
  const prev = p[PREV_KEY] || {};
  if (!all[host]?.activeRunId) return;
  const stoppedRunId = all[host].activeRunId;
  const run = all[host].runs[stoppedRunId];
  if (run && !run.endedAt) run.endedAt = Date.now();
  all[host].activeRunId = null;
  // Clean up prev_snapshots for this run — no longer needed for comparison
  if (prev[host]) delete prev[host][stoppedRunId];
  await Promise.all([
    chrome.storage.local.set({ [RUNS_KEY]: all }),
    chrome.storage.local.set({ [PREV_KEY]: prev })
  ]);
  // Stop keep-alive if no other hosts have active runs
  const anyActive = Object.values(all).some(h => h.activeRunId);
  if (!anyActive) stopKeepAlive();
}

async function deleteRun(host, runId) {
  const [r, p] = await Promise.all([
    chrome.storage.local.get(RUNS_KEY),
    chrome.storage.local.get(PREV_KEY)
  ]);
  const all  = r[RUNS_KEY] || {};
  const prev = p[PREV_KEY] || {};
  if (all[host]) {
    delete all[host].runs[runId];
    if (all[host].activeRunId === runId) all[host].activeRunId = null;
  }
  if (prev[host]) delete prev[host][runId];
  await Promise.all([
    chrome.storage.local.set({ [RUNS_KEY]: all }),
    chrome.storage.local.set({ [PREV_KEY]: prev })
  ]);
}

async function clearHost(host) {
  const [r, p] = await Promise.all([
    chrome.storage.local.get(RUNS_KEY),
    chrome.storage.local.get(PREV_KEY)
  ]);
  const all  = r[RUNS_KEY] || {};
  const prev = p[PREV_KEY] || {};
  delete all[host];
  delete prev[host];
  await Promise.all([
    chrome.storage.local.set({ [RUNS_KEY]: all }),
    chrome.storage.local.set({ [PREV_KEY]: prev })
  ]);
}

// ── Snapshot processing ───────────────────────────────────────────────────────
async function processSnapshot(msg) {
  const { host, path, snapshot, timestamp } = msg;

  const [r, p] = await Promise.all([
    chrome.storage.local.get(RUNS_KEY),
    chrome.storage.local.get(PREV_KEY)
  ]);
  const all  = r[RUNS_KEY] || {};
  const prev = p[PREV_KEY] || {};

  if (!all[host]) all[host] = { activeRunId: null, runs: {} };

  // Auto-start a default run if none is active
  if (!all[host].activeRunId) {
    const runId  = `run_${Date.now()}`;
    const runNum = Object.keys(all[host].runs).length + 1;
    all[host].runs[runId] = {
      id: runId, name: `Default Run ${runNum}`,
      startedAt: timestamp, endedAt: null,
      snapshotCount: 0, pages: {}, aggregated: {}
    };
    all[host].activeRunId = runId;
    startKeepAlive();
  }

  const runId = all[host].activeRunId;
  const run   = all[host].runs[runId];

  // Update lastUpdated on every snapshot so popup shows accurate "last seen" time
  run.lastUpdated = timestamp;

  // Per-path page data
  if (!run.pages[path]) run.pages[path] = { snapshotCount: 0, attributes: {} };
  const page = run.pages[path];

  // Prev snapshot for this specific path
  if (!prev[host])        prev[host]        = {};
  if (!prev[host][runId]) prev[host][runId] = {};
  const prevMap = prev[host][runId][path] || null;
  const isFirst = prevMap === null;  // BUG FIX: use null check, not snapshotCount

  page.snapshotCount += 1;
  run.snapshotCount  += 1;

  // Build per-element fingerprint map: { fp -> { attr -> value } }
  const currentFpMap = buildFingerprintMap(snapshot);

  // ── Per-element, per-attribute comparison ────────────────────────────────
  // For each element (identified by fingerprint) present in BOTH current and
  // previous snapshot of THIS path, compare each attribute value individually.
  // Only count a change if the SAME element's attribute value changed.

  // Track which attrs were seen this snapshot (for absence detection)
  const attrsSeenThisSnapshot = new Set();

  for (const [fp, attrMap] of Object.entries(currentFpMap)) {
    const prevAttrMap = (prevMap && prevMap[fp]) ? prevMap[fp] : null;

    for (const [attr, rawVal] of Object.entries(attrMap)) {
      attrsSeenThisSnapshot.add(attr);
      const effectiveVal = isValueDynamic(rawVal) ? null : rawVal;  // null = dynamic
      const allDynamic   = effectiveVal === null;

      if (!page.attributes[attr]) {
        page.attributes[attr] = {
          seenCount: 0, stableCount: 0, changedCount: 0,
          uniqueValueCount: 0, uniqueValuesSet: [],
          firstSeenSnapshot: page.snapshotCount,
          dynamicObservations: 0, stableObservations: 0,  // for allDynamic calculation
          score: 50
        };
      }
      const stat = page.attributes[attr];
      // seenCount tracks element-level occurrences (consistent with stableCount/changedCount)
      stat.seenCount += 1;
      if (allDynamic) stat.dynamicObservations += 1;
      else stat.stableObservations += 1;

      // Track unique stable values
      if (!allDynamic) {
        const existingSet = new Set(stat.uniqueValuesSet);
        if (!existingSet.has(rawVal) && existingSet.size < MAX_UNIQUE) {
          existingSet.add(rawVal);
          stat.uniqueValuesSet  = Array.from(existingSet);
          stat.uniqueValueCount = stat.uniqueValuesSet.length;
        }
      }

      // Stability: compare THIS element's attr value against same element's
      // attr value in the previous snapshot of THIS path.
      // If the element didn't exist in prev snapshot, skip (no comparison possible).
      if (!isFirst && prevAttrMap !== null && prevAttrMap[attr] !== undefined) {
        const prevVal     = prevAttrMap[attr];
        const prevDynamic = isValueDynamic(prevVal);

        if (allDynamic && prevDynamic) {
          // Both dynamic — count as changed (dynamic values are unreliable)
          stat.changedCount += 1;
        } else if (!allDynamic && !prevDynamic) {
          // Both stable — compare actual values
          if (rawVal === prevVal) {
            stat.stableCount += 1;
          } else {
            stat.changedCount += 1;
          }
        } else {
          // One dynamic, one stable — changed
          stat.changedCount += 1;
        }
      }
      // If element is new (not in prevMap), we don't count stable or changed —
      // we just record it. It will start being compared from the next snapshot.
    }
  }

  // Recalculate scores for all attrs seen this snapshot
  for (const attr of attrsSeenThisSnapshot) {
    if (page.attributes[attr]) {
      const stat = page.attributes[attr];
      // allDynamic: true only if EVERY observation was dynamic (no stable values ever seen)
      stat.allDynamic = stat.dynamicObservations > 0 && stat.stableObservations === 0;
      stat.score = calculateScore(stat, page.snapshotCount);
    }
  }

  // Attributes completely absent this snapshot (element removed from page)
  // Only penalise if we've seen them before and this isn't the first snapshot
  if (!isFirst) {
    for (const attr of Object.keys(page.attributes)) {
      if (!attrsSeenThisSnapshot.has(attr)) {
        page.attributes[attr].changedCount += 1;
        page.attributes[attr].score = calculateScore(page.attributes[attr], page.snapshotCount);
      }
    }
  }

  // Aggregate across all pages (weighted by each page's snapshotCount)
  run.aggregated = aggregatePages(run.pages);

  // Store current fingerprint map as prev for next comparison on this path
  prev[host][runId][path] = currentFpMap;

  await Promise.all([
    chrome.storage.local.set({ [RUNS_KEY]: all }),
    chrome.storage.local.set({ [PREV_KEY]: prev })
  ]);
}

// ── Aggregation ───────────────────────────────────────────────────────────────
// Merges per-path scores into a single host-level view.
// Uses weighted average: pages with more snapshots have more influence.
// presenceRatio is computed per-page (seenCount / page.snapshotCount),
// then averaged — avoids the cross-page denominator bug.
function aggregatePages(pages) {
  // Step 1: collect per-page scores for each attribute
  const attrPageScores = {};  // attr -> [{ score, weight }]

  for (const page of Object.values(pages)) {
    const w = page.snapshotCount;
    // Skip pages with insufficient data — their score is 50 (neutral) and
    // would dilute the weighted average without contributing real signal.
    if (w < MIN_SNAPS) continue;
    for (const [attr, stat] of Object.entries(page.attributes)) {
      if (!attrPageScores[attr]) attrPageScores[attr] = [];
      attrPageScores[attr].push({ score: stat.score, weight: w, stat });
    }
  }

  // Step 2: weighted average score per attribute
  const merged = {};
  for (const [attr, entries] of Object.entries(attrPageScores)) {
    const totalWeight = entries.reduce((s, e) => s + e.weight, 0);
    const weightedScore = entries.reduce((s, e) => s + e.score * e.weight, 0) / totalWeight;

    // Merge raw stats for display (seenCount, changedCount, etc.)
    const combined = {
      seenCount: 0, stableCount: 0, changedCount: 0,
      uniqueValueCount: 0, uniqueValuesSet: [],
      allDynamic: false, pageCount: entries.length,
      score: Math.round(weightedScore)
    };
    const existingSet = new Set();
    for (const { stat } of entries) {
      combined.seenCount    += stat.seenCount;
      combined.stableCount  += stat.stableCount;
      combined.changedCount += stat.changedCount;
      if (stat.allDynamic) combined.allDynamic = true;
      for (const v of stat.uniqueValuesSet) {
        if (!existingSet.has(v) && existingSet.size < MAX_UNIQUE) existingSet.add(v);
      }
    }
    combined.uniqueValuesSet  = Array.from(existingSet);
    combined.uniqueValueCount = combined.uniqueValuesSet.length;
    merged[attr] = combined;
  }

  return merged;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

// Build a map keyed by element fingerprint: { fp -> { attr -> value } }
// This allows per-element comparison across snapshots.
// If two elements share the same fingerprint (rare DOM collision), last one wins —
// acceptable trade-off for structural stability.
function buildFingerprintMap(snapshot) {
  const map = {};
  for (const el of snapshot) {
    if (!el.fp) continue;  // skip elements without fingerprint (old format)
    map[el.fp] = el.attrs;
  }
  return map;
}

function calculateScore(stat, pageSnapshotCount) {
  if (pageSnapshotCount < MIN_SNAPS) return 50;  // not enough data
  const comparisons = stat.stableCount + stat.changedCount;
  if (comparisons === 0) return 50;

  // stabilityRatio: how often values stayed the same between consecutive snapshots
  const stabilityRatio = stat.stableCount / comparisons;

  // presenceRatio: how consistently this attr appeared across snapshots on this page
  // firstSeenSnapshot is 1-indexed; eligible = snapshots since first appearance
  const eligible = pageSnapshotCount - (stat.firstSeenSnapshot || 1) + 1;
  const presenceRatio = eligible > 0 ? Math.min(stat.seenCount / eligible, 1) : 1;

  // uniquePenalty: many distinct values = likely dynamic
  const uniquePenalty = Math.min((stat.uniqueValueCount || 0) / 10, 0.5);

  // dynamicPenalty: all observed values matched dynamic patterns
  const dynamicPenalty = stat.allDynamic ? 0.4 : 0;

  const raw = (stabilityRatio * 0.6 + presenceRatio * 0.4)
              - (uniquePenalty * 0.3)
              - dynamicPenalty;

  return Math.round(Math.max(0, Math.min(100, raw * 100)));
}