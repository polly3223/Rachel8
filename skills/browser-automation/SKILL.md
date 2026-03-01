---
name: browser-automation
description: Browse the web, read authenticated pages, scrape data, and interact with websites using PinchTab. Use when a task requires reading web pages, extracting data from websites, interacting with social media feeds, downloading content behind logins, or any web automation.
---

# Browser Automation (PinchTab)

Automate web browsing via PinchTab — a lightweight HTTP API that controls Chrome. Token-efficient: you get exactly the data you ask for, nothing more.

## Architecture

- **PinchTab** (`/usr/local/bin/pinchtab`) — 12MB Go binary, wraps Chrome DevTools Protocol into HTTP API
- **Google Chrome** (`/usr/bin/google-chrome-stable`) — installed via apt
- **Xvfb** — virtual display for headed mode on a headless VPS
- **Chrome wrapper** (`~/.pinchtab/chrome-wrapper.sh`) — adds `--no-sandbox` for VPS

PinchTab runs Chrome with persistent profiles. Once a user logs into a site, the session persists across restarts.

## Starting PinchTab

### Dashboard Mode (manages multiple profiles)

```bash
# Ensure Xvfb is running
pgrep Xvfb || (Xvfb :99 -screen 0 1920x1080x24 &>/dev/null &)

# Start PinchTab dashboard
DISPLAY=:99 \
CHROME_BINARY=~/.pinchtab/chrome-wrapper.sh \
CHROME_FLAGS="--no-sandbox --disable-gpu" \
nohup pinchtab dashboard > /tmp/pinchtab-dash.log 2>&1 &

# Dashboard is at http://localhost:9867
```

### Launch a Profile

```bash
# Via API
curl -s -X POST http://localhost:9867/instances/launch \
  -H "Content-Type: application/json" \
  -d '{"name":"social Lore","port":"9868","headless":false}'
```

Each profile runs on its own port (9868, 9869, etc). The API for that profile is at `http://localhost:<port>`.

### Quick Start (no dashboard, single profile)

```bash
pgrep Xvfb || (Xvfb :99 -screen 0 1920x1080x24 &>/dev/null &)

DISPLAY=:99 \
CHROME_BINARY=~/.pinchtab/chrome-wrapper.sh \
BRIDGE_PORT=9868 \
BRIDGE_PROFILE=~/.pinchtab/profiles/default \
BRIDGE_HEADLESS=false \
BRIDGE_NO_RESTORE=true \
nohup pinchtab > /tmp/pinchtab.log 2>&1 &
```

## Authentication — Cookie Import

PinchTab doesn't need noVNC or screen sharing for login. Instead, use the **Cookie-Editor** browser extension to export cookies from the user's own browser.

### What the User Needs

The user must install this Chrome extension on their personal browser (Mac/PC/phone):

**Cookie-Editor**
https://chromewebstore.google.com/detail/hlkenndednhfkekhgcdicdfddnkalmdm

It's a free, open-source extension with 700K+ users that lets you view and export cookies from any website.

### How to Ask the User

When a task requires accessing an authenticated website (social media, dashboards, etc.), send this message:

> To access [website name] on your behalf, I need your login cookies. Here's what to do:
>
> 1. Install the Cookie-Editor extension if you haven't already:
>    https://chromewebstore.google.com/detail/hlkenndednhfkekhgcdicdfddnkalmdm
>
> 2. Go to [website URL] in your browser (make sure you're logged in)
>
> 3. Click the Cookie-Editor icon (🍪) in your toolbar
>
> 4. Click "Export" (the download icon) — this copies all cookies as JSON
>
> 5. Paste the JSON here
>
> That's it! I'll import your session and can then browse [website] as you. Your cookies are stored securely in a persistent Chrome profile on my server.

### Importing Cookies

Once the user sends the JSON, inject them into PinchTab:

```bash
# Navigate to the target domain first
curl -s -X POST http://localhost:9868/navigate \
  -H "Content-Type: application/json" \
  -d '{"url":"https://x.com"}'

# Then inject cookies
curl -s -X POST http://localhost:9868/cookies \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://x.com",
    "cookies": [
      {"name":"auth_token","value":"...","domain":".x.com","path":"/","secure":true,"httpOnly":true,"sameSite":"None","expires":1786701753},
      {"name":"ct0","value":"...","domain":".x.com","path":"/","secure":true,"httpOnly":false,"sameSite":"Lax","expires":1786701754}
    ]
  }'

# Reload the page — should now be authenticated
curl -s -X POST http://localhost:9868/navigate \
  -H "Content-Type: application/json" \
  -d '{"url":"https://x.com/home"}'
```

**Cookie format mapping** (Cookie-Editor → PinchTab):
- `name`, `value`, `domain`, `path` → same
- `secure` → same (boolean)
- `httpOnly` → same (boolean)
- `expirationDate` → `expires` (rename, same value — Unix timestamp)
- `sameSite` → capitalize: `"no_restriction"` → `"None"`, `"lax"` → `"Lax"`, `"strict"` → `"Strict"`
- Ignore: `hostOnly`, `storeId`, `session`, `id`

### Cookie Persistence

Cookies are stored in the Chrome profile directory (`~/.pinchtab/profiles/<name>/`). They persist across PinchTab restarts. The user only needs to export cookies once per site — unless the session expires (typically weeks to months).

If a session expires, you'll notice the site shows a login page instead of the feed. Ask the user to re-export cookies.

## PinchTab HTTP API

All calls are to the instance port (e.g., `http://localhost:9868`).

### Reading Content

```bash
# Get readable text from the page (most token-efficient)
curl -s http://localhost:9868/text
# Returns: {"text":"...", "title":"...", "url":"..."}

# Get interactive element snapshot (compact format)
curl -s "http://localhost:9868/snapshot?filter=interactive&format=compact"

# Get full element snapshot
curl -s http://localhost:9868/snapshot

# Take a screenshot
curl -s http://localhost:9868/screenshot -o /tmp/page.png

# Get all cookies for a URL
curl -s "http://localhost:9868/cookies?url=https://x.com"
```

### Navigation

```bash
# Go to a URL
curl -s -X POST http://localhost:9868/navigate \
  -H "Content-Type: application/json" \
  -d '{"url":"https://example.com"}'

# Get open tabs
curl -s http://localhost:9868/tabs
```

### Interaction

```bash
# Click an element by reference (from snapshot)
curl -s -X POST http://localhost:9868/action \
  -H "Content-Type: application/json" \
  -d '{"actions":[{"kind":"click","ref":"e5"}]}'

# Type into an element
curl -s -X POST http://localhost:9868/action \
  -H "Content-Type: application/json" \
  -d '{"actions":[{"kind":"type","ref":"e3","text":"hello world"}]}'

# Scroll down
curl -s -X POST http://localhost:9868/evaluate \
  -H "Content-Type: application/json" \
  -d '{"expression":"window.scrollBy(0, 1500)"}'

# Run arbitrary JavaScript
curl -s -X POST http://localhost:9868/evaluate \
  -H "Content-Type: application/json" \
  -d '{"expression":"document.title"}'
```

### Health & Status

```bash
curl -s http://localhost:9868/health
# Returns: {"cdp":"","status":"ok","tabs":1}
```

## Common Patterns

### Scrape a Social Media Feed (e.g. X/Twitter)

```python
import json, time, urllib.request

BASE = "http://localhost:9868"

def post(path, data):
    req = urllib.request.Request(f"{BASE}{path}")
    req.add_header("Content-Type", "application/json")
    req.method = "POST"
    req.data = json.dumps(data).encode()
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.loads(r.read())

def get_json(path):
    with urllib.request.urlopen(f"{BASE}{path}", timeout=15) as r:
        return json.loads(r.read())

# Navigate to feed
post("/navigate", {"url": "https://x.com/home"})
time.sleep(5)

# Scroll and collect tweets
all_tweets = {}
for i in range(30):
    result = post("/evaluate", {
        "expression": """JSON.stringify(Array.from(document.querySelectorAll('article')).map(a => {
            let timeEl = a.querySelector('time');
            return {
                raw: a.innerText.substring(0, 800),
                datetime: timeEl ? timeEl.getAttribute('datetime') : '',
                link: timeEl && timeEl.closest('a') ? timeEl.closest('a').href : ''
            };
        }))"""
    })
    articles = json.loads(result.get("result", "[]"))
    for a in articles:
        key = a.get("raw", "")[:150]
        if key and key not in all_tweets:
            all_tweets[key] = a

    if len(all_tweets) >= 100:
        break

    post("/evaluate", {"expression": "window.scrollBy(0, 1500)"})
    time.sleep(2)

tweets = list(all_tweets.values())
```

### Read a Specific Webpage

```bash
# Navigate
curl -s -X POST http://localhost:9868/navigate \
  -H "Content-Type: application/json" \
  -d '{"url":"https://example.com/article"}'
sleep 3

# Extract text
curl -s http://localhost:9868/text
```

### Take a Screenshot and Send to User

```bash
curl -s http://localhost:9868/screenshot -o /tmp/page.png
bun run ~/rachel8/src/telegram/send-file.ts /tmp/page.png "Here's the screenshot"
```

### Check if Session is Still Valid

```bash
# Navigate to the authenticated page
curl -s -X POST http://localhost:9868/navigate \
  -H "Content-Type: application/json" \
  -d '{"url":"https://x.com/home"}'
sleep 4

# Check if we got the feed or a login page
TITLE=$(curl -s http://localhost:9868/text | python3 -c "import json,sys; print(json.load(sys.stdin).get('title',''))")

if echo "$TITLE" | grep -qi "log in\|sign in\|join"; then
    echo "Session expired — need fresh cookies from user"
else
    echo "Session valid — authenticated"
fi
```

## Existing Profiles

- **social Lore** — Lorenzo's social media (X/Twitter authenticated)
  - Port: 9868
  - Path: `~/.pinchtab/profiles/social Lore/`

## Dashboard API (port 9867)

```bash
# List profiles
curl -s http://localhost:9867/profiles

# List running instances
curl -s http://localhost:9867/instances

# Launch a profile
curl -s -X POST http://localhost:9867/instances/launch \
  -H "Content-Type: application/json" \
  -d '{"name":"profile-name","port":"9868","headless":false}'

# Stop an instance
curl -s -X POST http://localhost:9867/instances/<id>/stop

# View instance logs
curl -s http://localhost:9867/instances/<id>/logs
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `CHROME_BINARY` | Path to Chrome or wrapper script | auto-detect |
| `CHROME_FLAGS` | Extra Chrome flags | — |
| `BRIDGE_PORT` | PinchTab API port | 9867 |
| `BRIDGE_PROFILE` | Chrome profile directory | — |
| `BRIDGE_HEADLESS` | Run Chrome headless | true |
| `BRIDGE_TOKEN` | Auth token for PinchTab API | — (disabled) |
| `BRIDGE_STEALTH` | Fingerprint stealth level | light |
| `BRIDGE_NO_RESTORE` | Don't restore previous tabs | false |
| `BRIDGE_NO_DASHBOARD` | Run without dashboard | false |
| `BRIDGE_BLOCK_MEDIA` | Block media loading | false |
| `BRIDGE_BLOCK_IMAGES` | Block image loading | false |
| `BRIDGE_NAV_TIMEOUT` | Navigation timeout | 30s |
| `BRIDGE_MAX_TABS` | Max concurrent tabs | — |
| `BRIDGE_TIMEZONE` | Override timezone | — |
| `BRIDGE_USER_AGENT` | Override user agent | — |

## Critical Notes

- **Always use `CHROME_BINARY=~/.pinchtab/chrome-wrapper.sh`** on VPS — Chrome needs `--no-sandbox`
- **PinchTab dashboard + instances survive restarts** if launched with `nohup`
- **Cookie sessions persist** in the profile directory across restarts
- **`/text` is the most token-efficient** way to read pages — use it by default
- **`/evaluate` is the endpoint for JavaScript** (not `/eval`)
- **Scrolling**: use `evaluate` with `window.scrollBy(0, pixels)`
- **The user only needs Cookie-Editor once** — after importing cookies, sessions persist until they expire
- **Never store cookie JSON in memory files** — it contains auth tokens. Import it and discard.
- **Check session validity** before starting a scraping task — navigate and verify the page title isn't a login screen
