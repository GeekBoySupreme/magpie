# Magpie: saves into plans

Collect X bookmarks and Instagram saves, index their images and video with Gemini, and chat with them in Chrome's side panel.

## Install
1. Unzip this folder.
2. Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, and pick the `magpie` folder.
3. Click the Magpie icon (or press Alt+M) to open the side panel and paste a Gemini API key (aistudio.google.com/apikey). An Exa key is optional.

## Collect
- **X:** open `x.com/i/bookmarks` and press **Crawl bookmarks** in the pill at the bottom.
- **Instagram:** open your profile, then Saved, then **All posts** (or a collection), and press **Crawl saved**.
- On Twitter, every tweet gets a Magpie save button in its header, right before the ellipsis. On Instagram, hover a post and tap the Magpie button. Shift-click also adds it to your basket.
- Right-click any page, link or image and choose **Stash in Magpie**.

Collecting works without a key. Saves wait as "Needs key" until you add one, then index in the background.

## Use
| Action | How |
| --- | --- |
| Switch spaces | Click the dock, two-finger swipe, or Alt+1 to 5 |
| Command bar | Cmd/Ctrl+K |
| Preview a save | Click a card (J/K to move, Esc to close, pop-out for a larger window) |
| Select mode | Select, then click circles or press S in preview; add to basket or ask |
| Add context | Type `@` for tabs, spaces, basket or saves |
| Skills | Type `/` for /plan, /compare, /links, /recipe, /shop, /summarize, /digest, or your own |
| Plans | "Save as plan" on any answer; checklists persist |

## Storage
Everything lives in IndexedDB (`unlimitedStorage`). Past the first limit in Settings, full-size media of the least-opened saves is removed (thumbnails and AI index stay). Past the second, the oldest saves are written to `Downloads/magpie-vault/archive-*.json` and kept as searchable stubs; import the file to restore. A JSON copy of the index (`magpie-vault/index-latest.json`) is refreshed every 50 indexed saves. Export and import are in Settings.

## Files
- `background.js` ingest, media capture, Gemini indexing queue, storage guard, context menu
- `content/` page tap (MAIN world), crawler dock, per-post buttons for X and Instagram
- `sidepanel/` the app: spaces, feed, peek, chat, command bar, settings
- `preview/` pop-out window
- `lib/` IndexedDB, Gemini and Exa clients, hybrid search, storage tiers

## Notes
- Model defaults to `gemini-3.1-pro-preview`; embeddings to `gemini-embedding-001`. Both are editable in Settings.
- X and Instagram change their markup and APIs often; selectors live in `content/twitter.js` and `content/instagram.js`.
- Instagram's fallback uses its unofficial post-info endpoint with your own session. Crawl your own account at a modest pace.
