# Attribute Reliability Tracker

> A Chrome extension that automatically tracks DOM attribute stability across page loads and navigations, then surfaces which attributes are **reliable** (safe for test selectors) and which are **unreliable** (dynamic, avoid using) — per site, per workflow run.

Built for QA engineers and developers who configure **Low Code Automation** tools and need to know which selectors will hold up in production.

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
- [Architecture](#architecture)
- [File Reference](#file-reference)
- [Known Limitations](#known-limitations)
- [Contributing](#contributing)
- [Pushing to GitHub](#pushing-to-github)

---

## Why This Exists

When writing automated tests or configuring Low Code Automation tools, you pick selectors like `id="submit-btn"` or `class="btn-primary-3x9f2"`. The problem:

- Some attributes are **stable** — same value every page load, every session
- Some are **dynamic** — change on every render (CSS-in-JS hashes, auto-generated IDs, session tokens)

Using a dynamic attribute as a selector breaks your tests silently. This extension **automatically figures out which is which** by watching the site over time, without any manual annotation.

---

## How It Works

### Capture Engine

The content script (`content.js`) runs on every page and captures DOM snapshots automatically on three triggers:

#### 1. Page Load (Full Reload or New Tab)
Uses **DOM idle detection** instead of a fixed timeout:
- A `MutationObserver` watches `document.body` after `DOMContentLoaded`
- Snapshot fires when the DOM has been quiet for **800ms** (no mutations)
- Hard cap at **6 seconds** — snapshot fires regardless, even on infinitely-loading pages
- This correctly handles slow sites, SSR hydration, lazy loading, and heavy JS frameworks

#### 2. SPA Navigation
Intercepts `history.pushState`, `history.replaceState`, `popstate`, and `hashchange`:
- `replaceState` calls during initial page hydration are **ignored** (Next.js, React Router, Vue Router all call `replaceState` during boot — these are not real navigations)
- Real navigations reset the idle detection cycle for the new route
- Works for React Router, Vue Router, Next.js App Router, Angular Router, etc.

#### 3. Post-Load DOM Mutations
After the initial snapshot settles (3s quiet period), a second `MutationObserver` watches for significant DOM changes:
- Fires when **5+ nodes** are added (lazy-loaded sections, modals, AJAX content)
- Debounced by **2 seconds** to avoid flooding on rapid updates

#### Service Worker Keep-Alive
Chrome MV3 service workers terminate after ~30s of inactivity. The extension handles this with:
- **Retry logic** in the content script: if `sendMessage` fails, retries up to 3 times with 600ms gaps
- **Keep-alive ping**: background worker reads `chrome.storage` every 20s while any run is active, preventing termination

---

### Scoring Algorithm

Each attribute on each page path gets a **confidence score from 0–100**.

#### Per-Element Fingerprinting
Each DOM element gets a **structural fingerprint** — a path built from tag names and sibling indices, walking up the DOM tree:

```
body[0] > div[2] > form[0] > input[1]
```

This fingerprint is:
- **Stable** across page refreshes (doesn't use `id` or `class`)
- **Unique** enough to identify the same element across snapshots
- **Bounded** to 6 levels deep to keep storage lean

#### Per-Element, Per-Path Comparison
For each snapshot, the engine:
1. Matches elements by fingerprint between current and previous snapshot **of the same URL path**
2. For each matched element, compares each attribute value individually
3. Counts `stableCount++` if value unchanged, `changedCount++` if changed
4. New elements (not in previous snapshot) are recorded but not compared yet

**Cross-page isolation**: `/home`'s `data-testid="logo"` is **never** compared against `/about`'s `data-testid="hero"`. Each path maintains its own snapshot history.

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

| Factor | Weight | Rationale |
|---|---|---|
| Stability ratio | 60% | Primary signal — did the value change? |
| Presence ratio | 40% | Was the attribute consistently present? |
| Unique value penalty | −30% max | Many distinct values = likely dynamic |
| All-dynamic penalty | −40% | All values matched auto-generated patterns |

#### Dynamic Value Detection
Values matching these patterns are excluded from stability comparison and penalised:

| Pattern | Example | Reason |
|---|---|---|
| `[tag]-[hex5-8]` | `css-3f9a2b`, `btn-x7k2p` | CSS-in-JS hashes |
| UUID v4 | `550e8400-e29b-41d4-a716-...` | Auto-generated IDs |
| 10+ digit number | `1718000000000` | Epoch timestamps |
| 20+ alphanumeric | `aB3kR9mNpQ2xZ7wL4vY8` | Session tokens |
| `react-*` | `react-select-3-option-0` | React internals |
| `__*__` | `__next_data__` | Framework internals |

#### Cross-Page Aggregation
After scoring each path independently, scores are **weighted-averaged** across all paths:
- Each path's score is weighted by its snapshot count
- A path with 10 snapshots has more influence than one with 2
- This gives a single host-level reliability score per attribute

---

### Data Model

```
chrome.storage.local:

runs_data: {
  "example.com": {
    activeRunId: "run_1718000000000" | null,
    runs: {
      "run_1718000000000": {
        id:            "run_1718000000000",
        name:          "Checkout workflow",
        startedAt:     1718000000000,
        endedAt:       1718000060000 | null,
        snapshotCount: 12,
        pages: {
          "/checkout": {
            snapshotCount: 5,
            attributes: {
              "id": {
                seenCount:        5,
                stableCount:      4,
                changedCount:     0,
                uniqueValueCount: 3,
                uniqueValuesSet:  ["submit-btn", "card-num", "expiry"],
                firstSeenSnapshot: 1,
                allDynamic:       false,
                score:            88
              }
            }
          }
        },
        aggregated: { ... }   // weighted average across all pages
      }
    }
  }
}

prev_snapshots: {
  "example.com": {
    "run_1718000000000": {
      "/checkout": {
        "body[0]>div[2]>form[0]>input[0]": { id: "card-num", type: "text", ... },
        "body[0]>div[2]>form[0]>button[0]": { id: "submit-btn", type: "submit", ... }
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
   git clone https://github.com/YOUR_USERNAME/attribute-reliability-tracker.git
   cd attribute-reliability-tracker
   ```

2. **Open Chrome Extensions**
   ```
   chrome://extensions
   ```

3. **Enable Developer Mode**
   Toggle the **Developer mode** switch in the top-right corner.

4. **Load the extension**
   Click **Load unpacked** → select the `extension/` folder (the one containing `manifest.json`).

5. **Verify installation**
   The 🎯 icon should appear in your Chrome toolbar. Pin it for easy access.

---

## Usage Guide

### Basic Workflow

1. **Navigate to any website** — the extension starts capturing automatically. No setup needed.

2. **Browse normally** — reload pages, click links, navigate between routes. Every page load and navigation is captured in the background.

3. **Open the popup** — click the 🎯 icon in the toolbar to see live results.

4. **Read the scores** after 5+ snapshots:
   - **✅ Reliable (≥ 70)** — safe to use as selectors in your automation tool
   - **⚠️ Unreliable (< 40)** — avoid; values change too often
   - **🟡 Moderate (40–69)** — use with caution; may be stable enough depending on context

### Named Runs

Runs let you capture attribute data for specific workflows and compare them.

1. Click **▶ Start Run** in the popup
2. Name your run (e.g. `"Checkout flow"`, `"Login happy path"`)
3. Browse the workflow — every page load and navigation is recorded
4. Click **⏹ Stop Run** when done
5. The run is saved to history — use the dropdown to switch between runs
6. Start a new run for a different workflow

**Tips:**
- Each run is scoped to a single domain but tracks all paths within it
- Runs accumulate independently — a "Login" run and a "Checkout" run have separate scores
- Delete individual runs with the 🗑 button next to the dropdown

### Exporting Results

Click **📋 Copy JSON** to copy the current run's results to clipboard:

```json
{
  "host": "example.com",
  "run": { "name": "Checkout flow", "snapshots": 12 },
  "generatedAt": "2024-06-10T12:00:00.000Z",
  "summary": { "reliable": 8, "moderate": 3, "unreliable": 2 },
  "reliable": [
    { "attribute": "data-testid", "score": 94 },
    { "attribute": "id",          "score": 88 },
    { "attribute": "name",        "score": 85 }
  ],
  "moderate": [
    { "attribute": "href", "score": 55 }
  ],
  "unreliable": [
    { "attribute": "class",   "score": 18 },
    { "attribute": "data-id", "score": 12 }
  ]
}
```

Paste this directly into your Low Code Automation tool's selector preference configuration.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Browser Tab                                                 │
│                                                              │
│  content.js                                                  │
│  ├── DOM idle detection (MutationObserver + hard cap)        │
│  ├── SPA navigation hooks (pushState/replaceState/popstate)  │
│  ├── Post-load mutation observer (lazy content)              │
│  ├── Element fingerprinting (structural path)                │
│  └── sendSnapshot() → retry on service worker sleep         │
└──────────────────────┬──────────────────────────────────────┘
                       │ chrome.runtime.sendMessage (SNAPSHOT)
                       ▼
┌─────────────────────────────────────────────────────────────┐
│  background.js (MV3 Service Worker)                          │
│                                                              │
│  ├── Serial queue per host (prevents race conditions)        │
│  ├── Keep-alive ping (prevents worker termination)           │
│  ├── processSnapshot()                                       │
│  │   ├── Auto-start Default Run if none active              │
│  │   ├── Per-path, per-element fingerprint comparison        │
│  │   ├── Dynamic value filtering                             │
│  │   ├── AttrStat scoring (stability + presence + penalty)   │
│  │   └── aggregatePages() → weighted cross-path scores       │
│  └── chrome.storage.local (runs_data + prev_snapshots)       │
└──────────────────────┬──────────────────────────────────────┘
                       │ chrome.runtime.sendMessage (GET_RUNS)
                       ▼
┌─────────────────────────────────────────────────────────────┐
│  popup.js + popup.html + popup.css                           │
│                                                              │
│  ├── Run controls (Start / Stop / Delete)                    │
│  ├── Run history dropdown                                    │
│  ├── Stats bar (snapshots, reliable count, unreliable count) │
│  ├── Three tabs: Reliable / Unreliable / All Scores          │
│  ├── Search filter                                           │
│  └── Export to JSON                                          │
└─────────────────────────────────────────────────────────────┘
```

---

## File Reference

| File | Purpose |
|---|---|
| `manifest.json` | Chrome extension config (MV3), permissions, content script declaration |
| `content.js` | DOM scanner, fingerprinting, idle detection, SPA navigation hooks |
| `background.js` | Service worker, scoring engine, run management, storage |
| `popup.html` | Extension popup markup |
| `popup.css` | Popup styles (dark theme) |
| `popup.js` | Popup logic — run controls, rendering, export |
| `icons/` | Extension icons (16, 32, 48, 128px) |
| `make_icons.py` | Script to regenerate icons |

---

## Known Limitations

| Limitation | Detail |
|---|---|
| **Structural fingerprint fragility** | If the DOM structure changes significantly between versions (e.g. a wrapper div is added), fingerprints won't match and elements will be treated as new. Scores reset for those elements. |
| **500-element cap** | Only the first 500 DOM elements are scanned per snapshot. Very large pages may miss elements below the fold. |
| **iframes not scanned** | Content inside cross-origin iframes is not accessible to the content script. |
| **Chrome only** | Uses Chrome-specific APIs (`chrome.storage`, `chrome.runtime`). Firefox support would require minor changes. |
| **MV3 service worker** | Despite keep-alive, Chrome may still terminate the worker in low-memory situations. The retry logic in `content.js` handles most cases. |

---

## Contributing

```bash
# Clone
git clone https://github.com/YOUR_USERNAME/attribute-reliability-tracker.git
cd attribute-reliability-tracker

# Make changes to extension files
# Reload the extension in chrome://extensions after each change

# Regenerate icons if needed
python3 make_icons.py
```

---

## Pushing to GitHub

### First-time setup

```bash
# 1. Initialize git (if not already done)
cd /Users/siddharthsukhmoychakravarty/Desktop/extension
git init

# 2. Create a .gitignore
cat > .gitignore << 'EOF'
.DS_Store
icons/.DS_Store
*.pyc
__pycache__/
EOF

# 3. Stage all files
git add .

# 4. Initial commit
git commit -m "feat: initial release of Attribute Reliability Tracker extension"

# 5. Create a new repo on GitHub (via CLI or browser)
# Option A — GitHub CLI (recommended):
gh repo create attribute-reliability-tracker --public --description "Chrome extension that tracks DOM attribute stability to identify reliable vs unreliable selectors for test automation"

# Option B — Browser:
# Go to https://github.com/new, create repo named "attribute-reliability-tracker"

# 6. Add remote and push
git remote add origin https://github.com/YOUR_USERNAME/attribute-reliability-tracker.git
git branch -M main
git push -u origin main
```

### Subsequent pushes

```bash
git add .
git commit -m "fix: describe what you changed"
git push
```

### Recommended branch strategy

```bash
# Feature work
git checkout -b feat/element-level-scoring
# ... make changes ...
git add .
git commit -m "feat: per-element fingerprint comparison"
git push -u origin feat/element-level-scoring
gh pr create --title "Per-element fingerprint comparison" --body "Replaces set-based comparison with per-element structural fingerprinting"

# Merge via GitHub PR, then clean up
git checkout main
git pull
git branch -d feat/element-level-scoring
```

### Suggested tags for releases

```bash
git tag -a v1.0.0 -m "v1.0.0 — initial release"
git push origin v1.0.0
```

---

## License

MIT — see [LICENSE](LICENSE) for details.