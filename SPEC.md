# HBA Facebook Inviter — Chrome Extension Spec
*Version 2.0 — Chrome Extension Rebuild*

---

## Vision

New HBA members have a traffic problem. They know they need to invite people, but the discipline to follow through daily breaks down. This tool eliminates that discipline problem entirely.

Member watches the Fast Start video → selects their Facebook friends → hits Start. Done. The extension runs quietly in the background, sending personalized invitations at a human pace over 2-3 weeks until every person on their list has been contacted. No daily action required. No forgetting. Just results.

---

## What We're Building

A Chrome browser extension. Members install it from a download link (`.crx` file or Chrome Web Store). It runs inside their real Chrome browser, using their already-logged-in Facebook session. No login required, no separate app to manage.

**Platform:** Chrome on Mac + Chrome on Windows (covers 95%+ of members)
**Install size:** ~1MB (vs 400MB Electron app)
**Dependencies:** None — runs in their existing Chrome + Facebook session

---

## User Flow (The Only Flow That Matters)

```
1. Member joins HBA
2. Watches Fast Start video (extension install link is ON this page)
3. Installs extension → Chrome prompts "Add to Chrome" → one click
4. Opens extension popup → sees welcome screen
5. Clicks "Load My Friends" → extension scrapes their FB friends list
6. Reviews friends list → sees message variations Paul wrote → clicks "Looks Good"
7. Unchecks anyone they don't want to invite (optional)
8. Clicks "Start Inviting"
9. Extension runs in the background — 20 invitations/day, randomized timing
10. Member gets on with their life
11. When someone responds → member handles it manually in Messenger
12. Extension shows progress: X of Y sent, estimated completion date
```

That's it. No lists to create. No messages to write. No settings to configure. Just load → review → start.

---

## The Invitation Messages

**Principle:** Paul writes all variations. Members see them upfront. No customization. Fewer choices = more action.

**How it works:**
- 5 message variations, all written by Paul
- Each uses `{{first_name}}` for personalization
- Pure text only — no links (links = spam signal to Facebook)
- The extension randomly assigns one variation per friend
- No two consecutive messages use the same variation

**Message variations (spintax format — {option1|option2|option3} = randomly pick one):**

```
Variation 1:
"Hey {{first_name}}, hope you're having a {great|wonderful|fantastic} day! 
Quick question. I recently {ran across|came across|found} a {project|business 
project|business model} that looks like it could be pretty {lucrative|
profitable|great}. Would you be open to {taking a peek|checking it out|taking 
a look}? No worries {if not|if no}, just let me know."

Variation 2:
"Hey {{first_name}}, hope you're doing well. This might not be for you, but 
you came to mind when I saw it, so {wanted to touch base|thought I'd reach out}
just in case. It's an online {marketing|business} project, different from 
anything I've seen before, and looks like it could be a pretty {good money 
maker|income stream|great income generator}. Does that sound like something 
you'd be open to {taking a look at|checking out}?"

Variation 3:
"Hi {{first_name}}, hope {all is well in your world|everything's going great|
life is treating you well}. 🙂 I just {found|came across} something that made 
me think of you. It's an online business that's pretty {unique|different|one of 
a kind}. Honestly, I've never seen anything quite like it. Anyway, it looks like 
it could have some pretty {good potential|solid potential|great potential} so I 
wanted to reach out to see if you'd be open to taking a look?"

Variation 4:
"Hey {{first_name}}, hope you're having an {awesome|amazing|great} day! I just 
{saw|came across|found} a very unique {business project|project|business 
model} that made me think of you. {Who knows, maybe I'm crazy|Maybe it's 
a long shot}, but wanted to reach out just in case. Are you open to {checking 
out|exploring|looking at} any ways to {generate income|make money|create income} 
outside of what you're currently doing?"

Variation 5:
"Hey {{first_name}}, hope {all is good|everything's great|you're doing well}! 
{Random question|Quick question}. I just saw something that I'm pretty {excited|
pumped} about. It's a business {project|model} that's {quite|pretty} 
unique. Wondering if you might be open to taking a look? No worries if not, just 
let me know. {Love to hear what you've been up to these days too|Would love to 
catch up too}!"
```

**Unique combinations per variation:** ~8-27 each
**Total unique messages across all 5:** 100+

---

## Safety Settings (Built-In, Not Configurable)

Research shows that for friend-to-friend messaging (existing connections, no links), safe automation stays well under detection when:

| Setting | Value | Reason |
|---|---|---|
| Messages per day | **10** | Ultra-conservative — indistinguishable from normal human behavior |
| Send window | **9am–8pm** (member's local time) | Matches normal human activity hours |
| Min gap between messages | **30 minutes** | Naturally spaced throughout the day |
| Max gap between messages | **60 minutes** | Keeps spread human and unpredictable |
| Message variation | **5 variations, random assignment** | Prevents identical message pattern detection |
| Completion time (300 friends) | **~30 days** | Consistent month-long launch window |

These are hardcoded. Members don't see or change them. Less to explain, less to break.

**"Don't use Facebook while sending" notice:** When a campaign is actively sending (a message is mid-send), show a subtle status indicator. In the extension popup, display: *"Sending in progress — avoid using Messenger right now."* This is informational only, not a hard block.

---

## HBA Member Filter

When loading friends, the extension checks each friend against the HBA active member list to avoid inviting people who are already paying customers.

**How it works:**
1. Extension calls the HBA MCP API (`get_active_customers` or commission list)
2. Builds a name lookup: `{ "John Smith": true, "Jane Doe": true, ... }`
3. For each scraped Facebook friend, checks first name + last name match (case-insensitive)
4. Matches get tagged with a "✓ HBA Member" badge and are **unchecked by default**
5. Member can still manually check them if they want (e.g., tell an HBA friend about a new product)

**API endpoint:** Use HBA MCP `get_team` or `get_active_customers` to pull the name list
**Note:** This is fuzzy — common names will have false positives. That's fine. Better to skip a few extra people than to awkwardly invite someone who's already a member.

---

## Architecture

### Extension Structure
```
hba-fb-inviter/
├── manifest.json          — Extension manifest (MV3)
├── popup/
│   ├── popup.html         — Extension popup UI
│   ├── popup.js           — Popup logic (React or vanilla JS)
│   └── popup.css          — Styles
├── background/
│   └── service-worker.js  — Background logic: scheduler, alarms, storage
├── content/
│   └── facebook.js        — Content script: runs on facebook.com, scrapes friends, sends messages
├── assets/
│   ├── icon-16.png
│   ├── icon-48.png
│   └── icon-128.png
└── messages.js            — Paul's invitation variations (hardcoded)
```

### Data Storage (Chrome Storage API — replaces SQLite)

```javascript
// chrome.storage.local — persists across browser restarts
{
  friends: [...],           // Scraped FB friends with id, name, firstName, profilePhotoUrl
  hbaMembers: [...],        // Name list from HBA API for filtering
  campaign: {
    status: "active|paused|complete|null",
    selectedFriendIds: [...],
    sendRecords: {
      [friendId]: {
        status: "pending|sent|failed",
        messageVariation: 0-4,
        scheduledAt: ISO string,
        sentAt: ISO string,
        error: string|null
      }
    },
    startedAt: ISO string,
    sentToday: 0,
    lastSendDate: "YYYY-MM-DD"
  }
}
```

### Component Responsibilities

| Component | What It Does |
|---|---|
| **Content Script** (`facebook.js`) | Runs on `facebook.com`. Scrapes friends list. Sends individual messages via DOM manipulation. Reports back to service worker. |
| **Service Worker** (`service-worker.js`) | Manages campaign state. Sets Chrome Alarms for scheduled sends. Receives "send this message" triggers from alarms. Coordinates with content script. |
| **Popup** (`popup.js`) | Shows current status, friends list, progress. Handles user interactions (load friends, start/pause/cancel). Communicates with service worker via `chrome.runtime.sendMessage`. |
| **messages.js** | Exports Paul's 5 message variations. Single file to update when Paul edits messages. |

---

## Screens / UI States

The extension popup is the entire UI. Simple, focused. No sidebar navigation.

### State 1: Welcome (First Install)
```
┌─────────────────────────────────┐
│  🚀 HBA Facebook Inviter        │
│                                 │
│  Ready to launch your business? │
│                                 │
│  Step 1: Make sure you're       │
│  logged into Facebook           │
│                                 │
│  [Load My Friends]              │
└─────────────────────────────────┘
```

### State 2: Loading Friends
```
┌─────────────────────────────────┐
│  Loading your friends...        │
│                                 │
│  ████████░░░░░░░  247 found     │
│                                 │
│  This takes about 30 seconds    │
└─────────────────────────────────┘
```

### State 3: Review & Select
```
┌─────────────────────────────────┐
│  Your Invitation Messages       │
│  ─────────────────────────────  │
│  We'll rotate between 5         │
│  personal messages. Here's one: │
│  "Hey {{first}}, I've been      │
│  working on something..."       │
│  [See all 5 variations]         │
│  ─────────────────────────────  │
│  427 friends loaded             │
│  3 already HBA members ✓        │
│                                 │
│  [✓] Select All  [Deselect HBA] │
│  ─────────────────────────────  │
│  [Search friends...]            │
│                                 │
│  ☑ John Smith                   │
│  ☑ Sarah Johnson                │
│  ☐ Mike Davis  ✓ HBA Member     │
│  ☑ Lisa Chen                    │
│  ...                            │
│  ─────────────────────────────  │
│  324 selected                   │
│  Est. completion: ~32 days      │
│                                 │
│  [Start Inviting →]             │
└─────────────────────────────────┘
```

### State 4: Active Campaign
```
┌─────────────────────────────────┐
│  🟢 Inviting in progress        │
│                                 │
│  ████████████░░░░  73%          │
│  237 of 324 sent                │
│                                 │
│  Today: 8/10 sent              │
│  Next send: ~12 minutes         │
│  Est. complete: Feb 28          │
│                                 │
│  ⚠️ Avoid using Messenger now   │
│     (sending in progress)       │
│                                 │
│  [Pause]  [Cancel Campaign]     │
└─────────────────────────────────┘
```
*(⚠️ notice only shows when a send is actively mid-flight)*

### State 5: Complete 🎉
```
┌─────────────────────────────────┐
│  🎉 Launch Complete!            │
│                                 │
│  324 invitations sent           │
│  over 32 days                   │
│                                 │
│  Check your Messenger inbox —   │
│  people are responding!         │
│                                 │
│  [Start a New Campaign]         │
└─────────────────────────────────┘
```

---

## Content Script: How Sending Works

No Playwright. No bundled browser. The content script runs directly in their real Chrome on `facebook.com`.

**Friend scraping:**
1. Navigate to `facebook.com/friends` (or friends list endpoint)
2. Scroll to load all friends
3. Extract: Facebook UID, full name, first name, profile photo URL
4. Send to storage

**Sending a message:**
1. Service worker fires alarm → tells content script "send to friendId X with message Y"
2. Content script opens `facebook.com/messages/t/{friendId}` in a background tab (or existing tab if open)
3. Waits for message input to be ready
4. Types message character by character with random 30-80ms delays
5. Presses Enter to send
6. Reports success/failure back to service worker
7. Closes the background tab

**Key advantage over Playwright:** This is their real Chrome, their real cookies, their real fingerprint. To Facebook it looks exactly like a person opening Messenger and typing a message.

---

## What We Reuse From the Existing Electron App

| Existing Code | Reuse? | Notes |
|---|---|---|
| `electron/scheduler.js` | ✅ Port logic | Replace node-cron + setTimeout with Chrome Alarms API |
| `electron/facebook.js` (message sending) | ✅ Port DOM logic | Remove Playwright, keep the message-typing approach |
| `electron/facebook.js` (friend scraping) | ✅ Port logic | Same DOM approach, no Playwright needed |
| `electron/database.js` | ❌ Replace | Chrome Storage API instead of SQLite |
| `src/screens/Campaign.jsx` | ✅ Port UI | Adapt for popup dimensions |
| `src/screens/Friends.jsx` | ✅ Port UI | Simplified (no manual lists needed) |
| `electron/main.js` | ❌ Remove | Electron-specific, not needed |
| `electron/preload.js` | ❌ Remove | Electron-specific |
| React + Tailwind setup | ✅ Keep | Works great in extension popup |

---

## Things We're Removing (Simplification)

The original app had:
- **Manual list creation** — not needed. One-campaign-per-launch model, just select and go
- **Multiple message templates** — replaced with Paul's 5 hardcoded variations
- **"Send Now" manual override** — removed. Let it run automatically
- **Test mode / production mode toggle** — gone. One mode: scheduled production
- **Campaign history** — out of scope for v1

---

## Build / Packaging

- **Development:** React + Vite builds to `dist/` → Chrome loads as unpacked extension
- **Distribution:** Package as `.crx` → host on HBA servers → members click a download link
- **Install flow:** Download `.crx` → Chrome opens install dialog → "Add to Chrome" → done
- **Alternative (future):** Submit to Chrome Web Store for even easier install

---

## Open Questions Before Build

1. **Message variations:** Paul needs to write the final 5 invitation messages
2. **HBA API auth:** Extension needs an API key/token to call the HBA member list — use the existing HBA external API key from TOOLS.md? Or build a public endpoint that just returns active member names (no sensitive data)?
3. **Friends list scraping endpoint:** Facebook has changed their friends page over time — need to confirm the current DOM structure during build
4. **Extension name + icon:** "HBA Facebook Inviter"? Or something more neutral like "Fast Start Inviter"?

---

## Success Criteria

- Member with zero tech skills can install and launch in under 5 minutes
- Zero configuration required beyond selecting friends
- Runs completely in the background — member can close the popup and it keeps going
- Member never gets a Facebook warning or temporary block
- When someone responds, member sees it naturally in their Messenger inbox (no tool needed)

---

*Spec written: Feb 26, 2026*
*Status: Ready for coding agent*
