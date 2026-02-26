# 🚀 Fast Start Inviter — Chrome Extension

Automated Facebook friend invitations for HBA members. Set it up once, it runs quietly in the background.

---

## How to Build

```bash
npm install
npm run build
```

The `dist/` folder is your loadable Chrome extension.

---

## How to Install in Chrome

1. Open Chrome and go to: **chrome://extensions**
2. Enable **Developer mode** (toggle in top-right)
3. Click **Load unpacked**
4. Select the `dist/` folder
5. The 🚀 icon appears in your Chrome toolbar

---

## How to Use

1. **Load friends** — Click the toolbar icon, make sure you're logged into Facebook, hit "Load My Friends"
2. **Review & select** — Uncheck anyone you don't want to invite (HBA members are pre-unchecked)
3. **Start** — Hit "Start Inviting →" and close the popup. The extension runs quietly in the background sending up to 10 messages/day.

---

## Safety Settings (hardcoded)

| Setting | Value |
|---|---|
| Max messages/day | 10 |
| Send window | 9am–8pm (your local time) |
| Gap between sends | 30–60 min (randomized) |
| Message variations | 5 (Paul's templates, randomly rotated) |

---

## Notes

- You must be logged into Facebook in the same Chrome profile
- The extension runs in the background — you can close the popup
- Pause anytime from the popup; campaign resumes where it left off
- Campaign progress is saved — closing Chrome doesn't reset it
- If someone is already an HBA member, they're auto-unchecked (fuzzy name match)
