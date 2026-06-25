# Attribute Reliability Tracker

> A Chrome extension that automatically tracks DOM attribute stability across page loads and navigations, then surfaces which attributes are **reliable** (safe for test selectors) and which are **unreliable** (dynamic, avoid using) — per site, per workflow run.

Built for QA engineers and developers who configure **BrowserStack Low Code Automation** tools and need to know which selectors will hold up in production.

---

## Table of Contents

- [Why This Exists](#why-this-exists)
- [How It Works](#how-it-works)
  - [Capture Engine](#capture-engine)
  - [Scoring Algorithm](#scoring-algorithm)
  - [Data Model](#data-model)
- [Installation](#installation)
- [Usage Guide](#usage-guide)
  - [Basic Workflow](#basic-workflow)
  - [Named Runs](#named-runs)
  - [Exporting Results](#exporting-results)
  - [Settings](#settings)
- [Architecture](#architecture)
- [File Reference](#file-reference)
- [Known Limitations](#known-limitations)
- [Contributing](#contributing)

---

## Why This Exists

When writing automated tests or configuring Low Code Automation tools, you pick selectors like `id="submit-btn"` or `class="btn-primary-3x9f2"`. The problem:

- Some attributes are **stable** — same value every page load, every session
- Some are **dynamic** — change on every render (CSS-in-JS hashes, auto-generated IDs, session tokens)

Using a dynamic attribute as a selector breaks your tests silently. This extension **automatically figures out which is which** by watching the site over time, without any manual annotation.

---

## How It Works

### Capture Engine

The content script (`content.js`) runs on every page and captures DOM snapshots automatically.

#### Auto-Refresh (New in v1.1)
When you start a run and visit a new page, the extension automatically reloads it **4 times** with a progress overlay ("Snapshot 2 of 4 — please wait"). This ensures enough data is collected per page without manual reloading. Auto-refresh only triggers when a run is active — pages load normally otherwise.

#### 1. Page Load
Uses **DOM idle detection** instead of a fixed timeout:
- A `MutationObserver` watches `document.body` after `DOMContentLoaded`
- Snapshot fires when the DOM has been quiet for **800ms**
- Hard cap at **6 seconds** — snapshot fires regardless, even on infinitely-loading pages
- Handles slow sites, SSR hydration, lazy loading, and heavy JS frameworks

#### 2. SPA Navigation
Intercepts `history.pushState`, `history.replaceState`, `popstate`, and `hashchange`:
- `replaceState` calls during initial page hydration are **ignored** (Next.js, React Router, Vue Router all call `replaceState` during boot)
- Real navigations reset the idle detection cycle for the new route

#### 3. Post-Load DOM Mutations
After the initial snapshot settles (3s quiet period), a second `MutationObserver` watches for significant DOM changes:
- Fires when **5+ nodes** are added (lazy-loaded sections, modals, AJAX content)
- Debounced by **2 seconds** to avoid flooding

#### Service Worker Keep-Alive
Chrome MV3 service workers terminate after ~30s of inactivity. The extension handles this with:
- **Retry logic**: if `sendMessage` fails, retries up to 3 times with 600ms gaps
- **Keep-alive ping**: background worker reads `chrome.storage` every 20s while any run is active
- **Context guard**: if the extension is reloaded while a page is open, all `chrome.*` calls are safely no-oped

---

### Scoring Algorithm

Each attribute on each page path gets a **confidence score from 0–100**.

#### Per-Element Fingerprinting
Each DOM element gets a **structural fingerprint** — a path built from tag names and sibling indices, walking up the DOM tree (up to 10 levels):

```
body[0] > div[2] > form[0] > input[1]
```

This fingerprint is stable across page refreshes and does NOT use `id` or `class` (the attributes being measured).

#### Per-Element, Per-Path Comparison
For each snapshot, the engine:
1. Matches elements by fingerprint between current and previous snapshot **of the same URL path**
2. For each matched element, compares each attribute value individually
3. Counts `stableCount++` if value unchanged, `changedCount++` if changed
4. New elements (not in previous snapshot) are recorded but not compared yet

**Cross-page isolation**: `/home`'s `data-testid="logo"` is **never** compared against `/about`'s `data-testid="hero"`.

#### Score Formula

```
stabilityRatio = stableCount / (stableCount + changedCount)
presenceRatio  = seenCount / snapshotsOnThisPage          [capped at 1.0]
uniquePenalty  = min(uniqueValueCount / 10, 0.5)
dynamicPenalty = 0.4 if all values matched dynamic patterns, else 0

raw = (stabilityRatio × 0.6) + (presenceRatio × 0.4)
      − (uniquePenalty × 0.3) − dynamicPenalty

score = clamp(round(raw × 100), 0, 100)
```

#### Dynamic Value Detection
Values matching these patterns are excluded from stability comparison:

| Pattern | Example | Reason |
|---|---|---|
| `[tag]-[hex5-8]` | `css-3f9a2b`, `btn-x7k2p` | CSS-in-JS hashes |
| UUID v4 | `550e8400-e29b-41d4-a716-...` | Auto-generated IDs |
| 10+ digit number | `1718000000000` | Epoch timestamps |
| 20+ alphanumeric | `aB3kR9mNpQ2xZ7wL4vY8` | Session tokens |
| `react-*` | `react-select-3-option-0` | React internals |

Token-level detection for `class`: `"css-3f9a2b btn-primary"` — each space-separated token is checked individually. If ANY token is dynamic, the whole value is treated as dynamic.

#### Cross-Page Aggregation
After scoring each path independently, scores are **weighted-averaged** across all paths (pages visited more often have more influence). Pages with fewer than 2 snapshots are excluded from aggregation.

---

### Data Model

```
chrome.storage.local:

runs_data: {
  "example.com": {
    activeRunId: "run_1718000000000" | null,
    runs: {
      "run_1718000000000": {
        id, name, startedAt, endedAt, snapshotCount,
        lastUpdated,
        pages: {
          "/checkout": {
            snapshotCount: 4,
            attributes: {
              "id": { seenCount, stableCount, changedCount, score, ... }
            }
          }
        },
        aggregated: { "id": { score: 88, ... } }
      }
    }
  }
}
```

---

## Installation

### Prerequisites
- Google Chrome (version 102+)
- Developer mode enabled in Chrome extensions

### Steps

1. **Clone or download this repository**
   ```bash
   git clone https://github.com/siddharth-bs/lca-attribute-reliability-finder-extension.git
   cd lca-attribute-reliability-finder-extension
   ```

2. **Open Chrome Extensions**
   ```
   chrome://extensions
   ```

3. **Enable Developer Mode** — toggle in the top-right corner.

4. **Load the extension** — click **Load unpacked** → select the folder containing `manifest.json`.

5. **Verify installation** — the 🎯 icon appears in your Chrome toolbar. Pin it for easy access.

---

## Usage Guide

### Basic Workflow

1. **Open the popup** — click the 🎯 icon in the toolbar
2. **Start a run** — click **▶ Start Run** → name it (e.g. "Login flow")
3. **Browse your website** — navigate through the key user flows. On each new page, the extension auto-reloads it 4 times (progress overlay shown). Wait for it to finish, then navigate to the next page.
4. **Stop the run** — click **⏹ Stop Run** when done
5. **Read the scores**:
   - **✅ Reliable (≥ 70)** — safe to use as selectors in LCA
   - **⚠️ Unreliable (< 40)** — avoid; values change too often
   - **🟡 Moderate (40–69)** — use with caution
6. **Click any attribute row** to copy its name to clipboard

### Named Runs

Runs let you capture attribute data for specific workflows and compare them.

1. Click **▶ Start Run** → name it (e.g. `"Checkout flow"`, `"Login happy path"`)
2. Browse the workflow — every page load and navigation is recorded
3. Click **⏹ Stop Run** when done
4. The run is saved to history — use the dropdown to switch between runs
5. Start a new run for a different workflow

**Tips:**
- Each run is scoped to a single domain but tracks all paths within it
- Delete individual runs with the 🗑 button next to the dropdown

### Exporting Results

Click **📋 Copy JSON** to copy the current run's results to clipboard:

```json
{
  "host": "example.com",
  "run": { "name": "Checkout flow", "snapshots": 16 },
  "generatedAt": "2024-06-10T12:00:00.000Z",
  "summary": { "reliable": 8, "moderate": 3, "unreliable": 2 },
  "reliable": [
    {
      "attribute": "aria-label",
      "overallScore": 94,
      "pageBreakdown": {
        "/login":    { "score": 96, "snapshots": 4, "seenCount": 8,  "changedCount": 0 },
        "/checkout": { "score": 91, "snapshots": 4, "seenCount": 6,  "changedCount": 1 }
      }
    }
  ],
  "unreliable": [
    {
      "attribute": "class",
      "overallScore": 12,
      "pageBreakdown": {
        "/login":    { "score": 8,  "snapshots": 4, "seenCount": 20, "changedCount": 19 },
        "/checkout": { "score": 15, "snapshots": 4, "seenCount": 16, "changedCount": 14 }
      }
    }
  ]
}
```

The `pageBreakdown` field shows per-page scores — useful for identifying which specific pages cause an attribute to score low. Paste the `reliable` list into your LCA project's selector preference configuration.

### Settings

Click the settings bar at the bottom of the popup:

- **Group subdomains** — when ON, `blog.example.com` and `app.example.com` are both tracked under `example.com`. When OFF (default), each subdomain is tracked separately. The site label shows `blog.example.com → example.com` when grouping is active.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Browser Tab                                                 │
│  content.js                                                  │
│  ├── Context validity guard (handles extension reloads)      │
│  ├── DOM idle detection (MutationObserver + hard cap)        │
│  ├── Auto-refresh: 4× reloads per new page (with overlay)   │
│  ├── SPA navigation hooks (pushState/replaceState/popstate)  │
│  ├── Post-load mutation observer (lazy content)              │
│  ├── Element fingerprinting (structural path, depth 10)      │
│  ├── Subdomain normalization (reads art_settings)            │
│  └── sendSnapshot() → retry on service worker sleep         │
└──────────────────────┬──────────────────────────────────────┘
                       │ chrome.runtime.sendMessage (SNAPSHOT)
                       ▼
┌─────────────────────────────────────────────────────────────┐
│  background.js (MV3 Service Worker)                          │
│  ├── Serial queue per host (prevents race conditions)        │
│  ├── Keep-alive ping (prevents worker termination)           │
│  ├── Only captures when a run is active (no auto-start)      │
│  ├── processSnapshot()                                       │
│  │   ├── Per-path, per-element fingerprint comparison        │
│  │   ├── Dynamic value filtering (token-level for class)     │
│  │   ├── AttrStat scoring (stability + presence + penalty)   │
│  │   └── aggregatePages() → weighted cross-path scores       │
│  └── chrome.storage.local (runs_data + prev_snapshots)       │
└──────────────────────┬──────────────────────────────────────┘
                       │ chrome.runtime.sendMessage (GET_RUNS)
                       ▼
┌─────────────────────────────────────────────────────────────┐
│  popup.js + popup.html + popup.css                           │
│  ├── Run controls (Start / Stop / Delete)                    │
│  ├── Run history dropdown                                    │
│  ├── Stats bar (snapshots, reliable count, unreliable count) │
│  ├── Three tabs: Reliable / Unreliable / All Scores          │
│  ├── Tap-to-copy: click any attribute row to copy name       │
│  ├── Search filter                                           │
│  ├── Settings: subdomain grouping toggle                     │
│  └── Export JSON with per-page score breakdown               │
└─────────────────────────────────────────────────────────────┘
```

---

## File Reference

| File | Purpose |
|---|---|
| `manifest.json` | Chrome extension config (MV3), permissions, content script declaration |
| `content.js` | DOM scanner, fingerprinting, idle detection, auto-refresh, SPA navigation hooks |
| `background.js` | Service worker, scoring engine, run management, storage |
| `popup.html` | Extension popup markup |
| `popup.css` | Popup styles (dark theme) |
| `popup.js` | Popup logic — run controls, rendering, export, settings |
| `icons/` | Extension icons (16, 32, 48, 128px) |

---

## Known Limitations

| Limitation | Detail |
|---|---|
| **Structural fingerprint fragility** | If the DOM structure changes significantly between versions (e.g. a wrapper div is added), fingerprints won't match and elements will be treated as new. Scores reset for those elements. |
| **500-element cap** | Only the first 500 DOM elements are scanned per snapshot. Very large pages may miss elements below the fold. |
| **iframes not scanned** | Content inside cross-origin iframes is not accessible to the content script. |
| **Chrome only** | Uses Chrome-specific APIs (`chrome.storage`, `chrome.runtime`). Firefox support would require minor changes. |
| **MV3 service worker** | Despite keep-alive, Chrome may still terminate the worker in low-memory situations. The retry logic in `content.js` handles most cases. |
| **Auto-refresh and SPAs** | Auto-refresh uses `location.reload()` which works for full-page sites. For SPAs, navigating to a new route triggers idle detection but does not auto-reload (SPA routes don't benefit from full reloads). |

---

## Contributing

```bash
# Clone
git clone https://github.com/siddharth-bs/lca-attribute-reliability-finder-extension.git
cd lca-attribute-reliability-finder-extension

# Make changes to extension files
# Reload the extension in chrome://extensions after each change
```

---

## License

MIT — see [LICENSE](LICENSE) for details.