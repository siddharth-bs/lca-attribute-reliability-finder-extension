/**
 * Popup Script — Attribute Reliability Tracker (Runs Edition)
 */

const RELIABLE_THRESHOLD   = 70;
const UNRELIABLE_THRESHOLD = 40;

let currentHost    = '';
let allAttributes  = [];
let hostData       = null;   // { activeRunId, runs: {} }
let viewingRunId   = null;   // which run is shown in the UI


function loadData() {
  chrome.runtime.sendMessage({ type: 'GET_RUNS', host: currentHost }, (res) => {
    if (chrome.runtime.lastError) return showNoData();
    hostData = res?.hostData || null;
    renderAll();
  });
}

// ── Render ────────────────────────────────────────────────────────────────────
function renderAll() {
  if (!hostData || !Object.keys(hostData.runs || {}).length) {
    showNoData();
    updateRunBar(null);
    document.getElementById('run-selector').style.display = 'none';
    return;
  }

  document.getElementById('no-data').style.display = 'none';
  updateRunBar(hostData.activeRunId);
  populateRunSelector();

  // Default: show active run, or most recent completed run
  if (!viewingRunId || !hostData.runs[viewingRunId]) {
    viewingRunId = hostData.activeRunId
      || Object.keys(hostData.runs).sort().reverse()[0];
  }
  document.getElementById('run-select').value = viewingRunId;
  renderRun(viewingRunId);
}

function renderRun(runId) {
  const run = hostData?.runs?.[runId];
  if (!run) return showNoData();

  document.getElementById('no-data').style.display = 'none';
  document.getElementById('session-count').textContent = run.snapshotCount || 0;

  // Use aggregated (cross-page merged) scores for display
  const source = run.aggregated && Object.keys(run.aggregated).length > 0
    ? run.aggregated
    : run.attributes || {};

  const attrs = Object.entries(source).map(([name, stat]) => ({ name, ...stat }));
  allAttributes = attrs.sort((a, b) => b.score - a.score);

  const reliable   = allAttributes.filter(a => a.score >= RELIABLE_THRESHOLD);
  const unreliable = allAttributes.filter(a => a.score < UNRELIABLE_THRESHOLD);

  document.getElementById('reliable-count').textContent   = reliable.length;
  document.getElementById('unreliable-count').textContent = unreliable.length;
  // Use lastUpdated (set on every snapshot) for accurate "last seen" time.
  // Fall back to endedAt, then startedAt if lastUpdated isn't present.
  const lastTs = run.lastUpdated || run.endedAt || run.startedAt;
  document.getElementById('last-updated').textContent = lastTs ? formatTime(lastTs) : '—';

  renderList('reliable-list',   reliable);
  renderList('unreliable-list', unreliable);
  renderList('all-list',        allAttributes);
}

function renderList(containerId, attrs) {
  const container = document.getElementById(containerId);
  container.innerHTML = '';
  if (!attrs.length) {
    container.innerHTML = '<div style="padding:18px;text-align:center;color:#4a5568;font-size:12px;">No attributes in this category yet.</div>';
    return;
  }
  for (const attr of attrs) container.appendChild(buildAttrItem(attr));
}

function buildAttrItem(attr) {
  const score = attr.score;
  const colorClass = score >= RELIABLE_THRESHOLD ? 'badge-reliable'
    : score < UNRELIABLE_THRESHOLD ? 'badge-unreliable' : 'badge-moderate';
  const barColor = score >= RELIABLE_THRESHOLD ? '#48bb78'
    : score < UNRELIABLE_THRESHOLD ? '#fc8181' : '#ecc94b';

  const item = document.createElement('div');
  item.className = 'attr-item';
  item.dataset.name = attr.name;
  item.title = 'Click to copy attribute name';
  item.style.cursor = 'pointer';

  // Tap-to-copy: clicking anywhere on the row copies the attribute name
  item.addEventListener('click', () => {
    navigator.clipboard.writeText(attr.name).then(() => {
      showToast(`Copied: ${attr.name}`);
    });
  });

  item.innerHTML = `
    <div class="attr-name">${escHtml(attr.name)}</div>
    <div class="score-bar-wrap">
      <div class="score-bar-bg"><div class="score-bar-fill" style="width:${score}%;background:${barColor}"></div></div>
      <div class="score-label">${attr.seenCount}× seen · ${attr.changedCount}× changed</div>
    </div>
    <div class="score-badge ${colorClass}">${score}</div>`;
  return item;
}

// ── Run bar ───────────────────────────────────────────────────────────────────
function updateRunBar(activeRunId) {
  const dot   = document.getElementById('run-dot');
  const label = document.getElementById('run-label');
  const startBtn = document.getElementById('start-run-btn');
  const stopBtn  = document.getElementById('stop-run-btn');

  if (activeRunId && hostData?.runs?.[activeRunId]) {
    const run = hostData.runs[activeRunId];
    dot.className   = 'run-dot active';
    label.textContent = `Recording: ${run.name}`;
    startBtn.style.display = 'none';
    stopBtn.style.display  = '';
  } else {
    dot.className   = 'run-dot inactive';
    label.textContent = 'No active run';
    startBtn.style.display = '';
    stopBtn.style.display  = 'none';
  }
}

// ── Run selector ──────────────────────────────────────────────────────────────
function populateRunSelector() {
  const sel = document.getElementById('run-select');
  const runs = hostData?.runs || {};
  const ids  = Object.keys(runs).sort().reverse();

  if (ids.length === 0) {
    document.getElementById('run-selector').style.display = 'none';
    return;
  }
  document.getElementById('run-selector').style.display = 'flex';

  sel.innerHTML = '';
  for (const id of ids) {
    const run = runs[id];
    const opt = document.createElement('option');
    opt.value = id;
    const status = id === hostData.activeRunId ? '🔴 ' : '✅ ';
    const snaps  = run.snapshotCount || 0;
    opt.textContent = `${status}${run.name} (${snaps} snap${snaps !== 1 ? 's' : ''})`;
    sel.appendChild(opt);
  }
}

document.getElementById('run-select').addEventListener('change', (e) => {
  viewingRunId = e.target.value;
  renderRun(viewingRunId);
});

// ── Start run (modal) ─────────────────────────────────────────────────────────
document.getElementById('start-run-btn').addEventListener('click', () => {
  document.getElementById('run-name-input').value = '';
  document.getElementById('modal-overlay').style.display = 'flex';
  setTimeout(() => document.getElementById('run-name-input').focus(), 50);
});

document.getElementById('modal-cancel').addEventListener('click', () => {
  document.getElementById('modal-overlay').style.display = 'none';
});

document.getElementById('modal-confirm').addEventListener('click', confirmStartRun);
document.getElementById('run-name-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') confirmStartRun();
  if (e.key === 'Escape') document.getElementById('modal-overlay').style.display = 'none';
});

function confirmStartRun() {
  const name = document.getElementById('run-name-input').value.trim() || 'Unnamed Run';
  document.getElementById('modal-overlay').style.display = 'none';
  chrome.runtime.sendMessage({ type: 'START_RUN', host: currentHost, name }, () => {
    showToast(`Started run: ${name}`);
    viewingRunId = null;
    setTimeout(loadData, 300);
  });
}

// ── Stop run ──────────────────────────────────────────────────────────────────
document.getElementById('stop-run-btn').addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'STOP_RUN', host: currentHost }, () => {
    showToast('Run stopped and saved');
    setTimeout(loadData, 300);
  });
});

// ── Delete run ────────────────────────────────────────────────────────────────
document.getElementById('delete-run-btn').addEventListener('click', () => {
  if (!viewingRunId) return;
  const run = hostData?.runs?.[viewingRunId];
  if (!run) return;
  if (!confirm(`Delete run "${run.name}"?`)) return;
  chrome.runtime.sendMessage({ type: 'DELETE_RUN', host: currentHost, runId: viewingRunId }, () => {
    viewingRunId = null;
    showToast('Run deleted');
    setTimeout(loadData, 300);
  });
});

// ── Tabs ──────────────────────────────────────────────────────────────────────
document.querySelectorAll('.tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
  });
});

// ── Search ────────────────────────────────────────────────────────────────────
document.getElementById('search-input').addEventListener('input', (e) => {
  const q = e.target.value.toLowerCase().trim();
  document.querySelectorAll('.attr-item').forEach(item => {
    item.style.display = (!q || item.dataset.name.includes(q)) ? '' : 'none';
  });
});

// ── Clear all ─────────────────────────────────────────────────────────────────
document.getElementById('clear-btn').addEventListener('click', () => {
  if (!currentHost || !confirm(`Clear ALL data for ${currentHost}?`)) return;
  chrome.runtime.sendMessage({ type: 'CLEAR_HOST', host: currentHost }, () => {
    hostData = null; allAttributes = []; viewingRunId = null;
    showNoData();
    updateRunBar(null);
    document.getElementById('run-selector').style.display = 'none';
    showToast('All data cleared');
  });
});

// ── Export ────────────────────────────────────────────────────────────────────
document.getElementById('export-btn').addEventListener('click', () => {
  const run = hostData?.runs?.[viewingRunId];

  // Build per-page breakdown for each attribute from run.pages
  function getPageBreakdown(attrName) {
    if (!run?.pages) return {};
    const breakdown = {};
    for (const [path, page] of Object.entries(run.pages)) {
      const stat = page.attributes?.[attrName];
      if (stat) {
        breakdown[path] = {
          score: stat.score,
          snapshots: page.snapshotCount,
          seenCount: stat.seenCount,
          changedCount: stat.changedCount
        };
      }
    }
    return breakdown;
  }

  function buildEntry(a) {
    return {
      attribute: a.name,
      overallScore: a.score,
      pageBreakdown: getPageBreakdown(a.name)
    };
  }

  const reliable   = allAttributes.filter(a => a.score >= RELIABLE_THRESHOLD).map(buildEntry);
  const unreliable = allAttributes.filter(a => a.score < UNRELIABLE_THRESHOLD).map(buildEntry);
  const moderate   = allAttributes.filter(a => a.score >= UNRELIABLE_THRESHOLD && a.score < RELIABLE_THRESHOLD).map(buildEntry);

  const payload = JSON.stringify({
    host: currentHost,
    run: run ? { name: run.name, snapshots: run.snapshotCount } : null,
    generatedAt: new Date().toISOString(),
    summary: { reliable: reliable.length, moderate: moderate.length, unreliable: unreliable.length },
    reliable, moderate, unreliable
  }, null, 2);
  navigator.clipboard.writeText(payload).then(() => showToast('Copied to clipboard!'));
});

// ── Helpers ───────────────────────────────────────────────────────────────────
function showNoData() {
  document.getElementById('no-data').style.display = 'block';
  ['session-count','reliable-count','unreliable-count'].forEach(id => {
    document.getElementById(id).textContent = '0';
  });
  document.getElementById('last-updated').textContent = '—';
}

function escHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function formatTime(ts) {
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 60)    return diff + 's ago';
  if (diff < 3600)  return Math.floor(diff / 60) + 'm ago';
  if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
  return Math.floor(diff / 86400) + 'd ago';
}

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2000);
}

// ── Settings ──────────────────────────────────────────────────────────────────
const SETTINGS_KEY = 'art_settings';

function loadSettings(cb) {
  chrome.storage.local.get(SETTINGS_KEY, (r) => {
    cb(r[SETTINGS_KEY] || { groupSubdomains: false });
  });
}

function saveSettings(settings) {
  chrome.storage.local.set({ [SETTINGS_KEY]: settings });
  chrome.runtime.sendMessage({ type: 'SETTINGS_CHANGED', settings });
}

function initSettings() {
  loadSettings((settings) => {
    const subEl = document.getElementById('subdomain-toggle');
    if (subEl) subEl.checked = !!settings.groupSubdomains;

    subEl?.addEventListener('change', () => {
      loadSettings((s) => {
        s.groupSubdomains = subEl.checked;
        saveSettings(s);
        showToast(subEl.checked ? 'Subdomains grouped' : 'Subdomains separated');
        setTimeout(() => init(), 300);
      });
    });

  });
}

// ── Init (overridden to apply subdomain grouping) ─────────────────────────────
async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url) return showNoData();
  try {
    const parsed = new URL(tab.url);
    if (['chrome:', 'chrome-extension:', 'about:', 'edge:'].includes(parsed.protocol)) {
      document.getElementById('site-label').textContent = 'Not available on this page';
      return showNoData();
    }
    loadSettings((settings) => {
      let hostname = parsed.hostname;
      if (settings.groupSubdomains) {
        const parts = hostname.split('.');
        hostname = parts.length > 2 ? parts.slice(-2).join('.') : hostname;
      }
      currentHost = hostname;
      document.getElementById('site-label').textContent =
        parsed.hostname + (settings.groupSubdomains && hostname !== parsed.hostname ? ` → ${hostname}` : '');
      loadData();
    });
  } catch { return showNoData(); }
}

initSettings();
init();