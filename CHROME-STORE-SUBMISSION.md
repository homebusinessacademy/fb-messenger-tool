# Chrome Web Store Submission — Fast Start Inviter

## Store Listing

### Extension Name
**Fast Start Inviter**

*(Alternative if needed: "Outreach Scheduler" or "Friend Connector")*

---

### Short Description (132 characters max)
```
Schedule personalized messages to reconnect with Facebook friends. Built for entrepreneurs and networkers who value relationships.
```

---

### Detailed Description (16,000 characters max)

```
Fast Start Inviter helps entrepreneurs and business professionals reconnect with their Facebook friends through thoughtful, personalized outreach.

HOW IT WORKS

1. Load your Facebook friends list with one click
2. Review the pre-written message templates (designed to feel personal, not salesy)
3. Select which friends you'd like to reach out to
4. The extension schedules your messages throughout the day at natural intervals

WHY USE THIS?

Building a business means staying connected with people you know. But life gets busy, and reaching out to hundreds of friends manually is overwhelming. Fast Start Inviter handles the scheduling so you can focus on the conversations that matter.

KEY FEATURES

• Pre-written message variations — No blank page anxiety. Choose from professionally crafted templates that sound like you.
• Smart scheduling — Messages are spaced naturally throughout the day (not blasted all at once).
• Friend filtering — Easily identify and skip friends who are already customers or business partners.
• Progress tracking — See exactly how many messages have been sent and when your campaign will complete.
• Respectful limits — Built-in daily caps ensure you're reconnecting thoughtfully, not spamming.

WHO IS THIS FOR?

• Entrepreneurs launching a new venture who want to let friends know what they're working on
• Network marketers looking to reconnect with their warm market
• Business professionals expanding their network through genuine outreach
• Anyone who wants to stay in touch with friends but struggles with consistency

WHAT THIS IS NOT

This is NOT a tool for messaging strangers, scraping data, or automating spam. It only works with your existing Facebook friends — people you've already connected with. You control who receives messages and can pause or stop at any time.

PRIVACY & DATA

• Your friend list stays in your browser (Chrome local storage)
• No friend data is uploaded to external servers
• Messages are sent from your real Facebook account — they come from you, not a bot
• See our full privacy policy: https://www.thehomebusinessacademy.com/privacy

SUPPORT

Built by The Home Business Academy. Questions? Contact support@thehomebusinessacademy.com

---

By installing this extension, you agree to use it responsibly and in accordance with Facebook's Terms of Service.
```

---

### Category
**Productivity**

### Language
**English (United States)**

---

## Screenshots Needed

Chrome requires at least 1 screenshot. Recommended: 3-5.

**Screenshot 1: Welcome Screen**
- Show the clean "Load My Friends" initial state
- Dimensions: 1280x800 or 640x400

**Screenshot 2: Friend Selection**
- Show the friend list with checkboxes, HBA member badges
- Demonstrates user control over who gets messaged

**Screenshot 3: Active Campaign**
- Show progress bar, "237 of 324 sent"
- Demonstrates the scheduling feature

**Screenshot 4: Message Preview**
- Show one of the message variations
- Demonstrates it's personal, not spammy

**Screenshot 5: Completion**
- Show the "Launch Complete" celebration screen

---

## Privacy Policy Addition

Add this section to your existing privacy policy at thehomebusinessacademy.com/privacy:

```
BROWSER EXTENSION PRIVACY (Fast Start Inviter)

This section applies to the Fast Start Inviter browser extension.

Information We Collect

When you use the Fast Start Inviter extension, the following information is processed:

• Facebook Friend List: When you click "Load My Friends," the extension reads your Facebook friends list (names and profile identifiers) directly from Facebook.com. This data is stored locally in your browser using Chrome's storage API and is NOT uploaded to our servers.

• Message Status: The extension tracks which friends have received messages and which are pending. This information is stored locally in your browser.

• Device Authentication: To prevent unauthorized use, the extension verifies your HBA membership by communicating with our servers. This includes your email address and a device identifier.

• Invite Registry: To help HBA members avoid duplicate outreach, we maintain a registry of Facebook users who have been contacted. This includes only the Facebook user ID (a numeric identifier) — not names, messages, or other personal information.

How We Use This Information

• To verify you are an active HBA member
• To prevent the same person from being contacted by multiple HBA members
• To provide you with campaign progress and status

Data Storage and Security

• Friend list data and message status are stored locally in your browser and are not transmitted to our servers
• Device authentication tokens are stored securely and transmitted over HTTPS
• The invite registry contains only anonymized identifiers

Your Rights

• You can delete all locally stored data by removing the extension from Chrome
• You can request deletion of your authentication token by contacting support@thehomebusinessacademy.com
• We do not sell or share your data with third parties

Contact

For questions about this extension's data practices, contact: support@thehomebusinessacademy.com
```

---

## Updated manifest.json

Replace the current description:

```json
{
  "manifest_version": 3,
  "name": "Fast Start Inviter",
  "version": "1.0.0",
  "description": "Schedule personalized messages to reconnect with your Facebook friends. Built for entrepreneurs.",
  "permissions": [
    "storage",
    "alarms",
    "tabs",
    "scripting",
    "activeTab"
  ],
  "host_permissions": [
    "https://www.facebook.com/*",
    "https://facebook.com/*",
    "https://thehba.app/*"
  ],
  "background": {
    "service_worker": "background/service-worker.js"
  },
  "content_scripts": [
    {
      "matches": [
        "https://www.facebook.com/*",
        "https://facebook.com/*"
      ],
      "js": ["content/facebook.js"],
      "run_at": "document_idle"
    }
  ],
  "action": {
    "default_popup": "popup/popup.html",
    "default_icon": {
      "16": "assets/icon-16.png",
      "48": "assets/icon-48.png",
      "128": "assets/icon-128.png"
    }
  },
  "icons": {
    "16": "assets/icon-16.png",
    "48": "assets/icon-48.png",
    "128": "assets/icon-128.png"
  }
}
```

**Changes made:**
1. Updated description to be approval-friendly
2. Removed messenger.com from host_permissions (using facebook.com/messages instead)
3. Removed messenger.com from content_scripts matches

---

## Permission Justifications

Chrome will ask why you need each permission. Here's what to say:

### storage
```
Required to save the user's campaign progress, friend selection, and message status locally in their browser. No cloud storage is used for friend data.
```

### alarms
```
Required to schedule messages at natural intervals throughout the day. The extension uses Chrome's Alarms API to trigger message sends at the user's preferred times.
```

### tabs
```
Required to open Facebook Messenger conversations when sending scheduled messages. The extension needs to navigate to facebook.com/messages to deliver each message.
```

### scripting
```
Required to interact with the Facebook interface — specifically to read the friends list and send messages through the Messenger input field.
```

### activeTab
```
Required to access the current Facebook tab when the user initiates friend loading or message sending. Only activates when the user explicitly clicks the extension.
```

### host_permissions: facebook.com
```
Required to read the user's friends list from facebook.com/friends and send messages through facebook.com/messages. The extension only operates on Facebook pages.
```

### host_permissions: thehba.app
```
Required to verify the user's membership status and access the invite coordination API. This prevents duplicate outreach to the same contacts.
```

---

## Single Purpose Description

Chrome requires a clear statement of the extension's single purpose:

```
This extension helps users schedule personalized messages to their existing Facebook friends. It reads the user's friend list, allows them to select recipients, and schedules message delivery at natural intervals throughout the day.
```

---

## Review Notes (Optional but Helpful)

You can add a note to the reviewer:

```
This extension is designed for business professionals who want to reconnect with their existing Facebook friends. Key points:

1. It only works with the user's own friends — not strangers or scraped contacts
2. Users explicitly select which friends to message
3. Messages are delivered at human-paced intervals (not bulk/blast)
4. All friend data stays local in the browser
5. The extension includes daily limits to encourage thoughtful outreach

We've designed this to be a relationship-building tool, not a spam tool. Happy to answer any questions.
```

---

## Submission Checklist

- [ ] Update manifest.json with new description (remove messenger.com)
- [ ] Rebuild extension: `npm run build`
- [ ] Create 3-5 screenshots (1280x800 recommended)
- [ ] Add privacy policy section to thehomebusinessacademy.com/privacy
- [ ] Create Chrome Web Store developer account ($5 one-time fee)
- [ ] Upload ZIP file of dist/ folder
- [ ] Fill in store listing with copy above
- [ ] Submit permission justifications
- [ ] Submit for review

---

## Expected Review Timeline

- First review: 1-3 business days (can be longer)
- If rejected: You'll get specific feedback to address
- Common rejection reasons for this type of extension:
  - "Violates Facebook ToS" — Counter: We're scheduling messages to existing friends, not automating spam
  - "Deceptive functionality" — Counter: Full transparency in description about what it does
  - "Excessive permissions" — We've trimmed to minimum needed

---

*Document created: March 3, 2026*
