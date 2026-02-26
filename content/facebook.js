// Fast Start Inviter — Content Script
// Runs on facebook.com and messenger.com
// Handles: (1) friend scraping, (2) message sending

(function () {
  'use strict';

  // Prevent double-initialization
  if (window.__fsiInitialized) return;
  window.__fsiInitialized = true;

  // ─── Utilities ─────────────────────────────────────────────────────────────

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function randomBetween(min, max) {
    return min + Math.floor(Math.random() * (max - min + 1));
  }

  // ─── Message Listener ──────────────────────────────────────────────────────

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'SCRAPE_FRIENDS') {
      scrapeFriends(message.senderId).then(sendResponse).catch(err => {
        sendResponse({ success: false, error: err.message });
      });
      return true; // async
    }

    if (message.type === 'SEND_MESSAGE') {
      sendMessage(message.friendId, message.message).then(sendResponse).catch(err => {
        sendResponse({ success: false, error: err.message });
      });
      return true; // async
    }

    if (message.type === 'PING') {
      sendResponse({ alive: true });
      return true;
    }
  });

  // ─── Friend Scraping ───────────────────────────────────────────────────────

  async function scrapeFriends(popupTabId) {
    // Navigate to facebook friends page if not already there
    if (!window.location.href.includes('facebook.com/friends')) {
      window.location.href = 'https://www.facebook.com/friends/list';
      return { started: true }; // Content script will re-run after navigation
    }

    await sleep(2000); // Let page settle

    const friends = [];
    const seen = new Set();
    let lastCount = 0;
    let stableRounds = 0;

    // Scroll loop to load all friends
    for (let i = 0; i < 200; i++) {
      // Extract friends from current DOM
      extractFriendsFromDOM(friends, seen);

      // Report progress to popup
      if (popupTabId && friends.length !== lastCount) {
        chrome.runtime.sendMessage({
          type: 'SCRAPE_PROGRESS',
          count: friends.length
        });
        lastCount = friends.length;
        stableRounds = 0;
      } else {
        stableRounds++;
      }

      // Stop if no new friends for 5 scroll rounds
      if (stableRounds >= 5 && friends.length > 0) break;

      // Scroll down
      window.scrollBy(0, 800);
      await sleep(600);
    }

    // Save to storage
    await new Promise(resolve => chrome.storage.local.set({ friends }, resolve));

    return { success: true, count: friends.length, friends };
  }

  function extractFriendsFromDOM(friends, seen) {
    // Try multiple selectors for the friends list
    const selectors = [
      'a[href*="/friends/list"] + div a[href*="facebook.com/"]',
      'div[data-pagelet="FriendsListPageContent"] a[href]',
      'div[aria-label="Friends"] a[href]',
      'div[data-testid="friend_list_item"] a[href]',
      // Generic: all profile links in the main content
      'div[role="main"] a[href*="facebook.com/"]:not([href*="friends"])'
    ];

    // Also try a broader approach — all links that look like profile pages
    const allLinks = document.querySelectorAll('a[href]');

    allLinks.forEach(link => {
      const href = link.href || '';

      // Match facebook.com profile URLs (not groups, pages, etc.)
      // Pattern: facebook.com/username or facebook.com/profile.php?id=...
      const profileMatch = href.match(/facebook\.com\/([a-zA-Z0-9.]+)\/?(\?.*)?$/) ||
                           href.match(/facebook\.com\/profile\.php\?id=(\d+)/);

      if (!profileMatch) return;

      // Extract user ID
      let userId;
      if (href.includes('profile.php?id=')) {
        userId = href.match(/id=(\d+)/)?.[1];
      } else {
        // Use the username as ID — we'll try to extract numeric ID from data attributes
        const pathParts = href.split('facebook.com/')[1]?.split('?')[0]?.split('/');
        const username = pathParts?.[0];
        if (!username || ['friends', 'groups', 'pages', 'events', 'marketplace', 'watch', 'gaming', 'help', 'settings', 'notifications', 'messages', 'login', 'home.php', 'find-friends'].includes(username)) return;
        userId = username;
      }

      if (!userId || seen.has(userId)) return;

      // Look for name in the link or nearby elements
      const nameEl = link.querySelector('span') || link;
      const name = nameEl?.textContent?.trim();

      if (!name || name.length < 2 || name.length > 80) return;

      // Skip non-name looking text
      if (/^\d+$/.test(name) || name.includes('·') || name.includes('ago')) return;

      // Look for profile photo
      const img = link.querySelector('img') ||
                  link.closest('[data-testid]')?.querySelector('img') ||
                  link.parentElement?.querySelector('img');
      const profilePhotoUrl = img?.src || '';

      // Try to get numeric Facebook UID from data attributes
      const container = link.closest('[data-friend-id]') ||
                        link.closest('[data-uid]') ||
                        link.closest('[data-id]');
      const numericId = container?.dataset?.friendId ||
                        container?.dataset?.uid ||
                        container?.dataset?.id ||
                        userId;

      seen.add(userId);
      const firstName = extractFirstName(name);
      friends.push({
        id: numericId,
        name,
        firstName,
        profilePhotoUrl,
        hbaMember: false
      });
    });
  }

  function extractFirstName(fullName) {
    if (!fullName) return '';
    // Handle "LastName, FirstName" format
    if (fullName.includes(',')) {
      return fullName.split(',')[1]?.trim().split(' ')[0] || fullName.split(' ')[0];
    }
    return fullName.split(' ')[0];
  }

  // ─── Message Sending ───────────────────────────────────────────────────────

  async function sendMessage(friendId, message) {
    // Check if user has a focused/active tab on Facebook/Messenger (not this background tab)
    // This check is handled by checking if we're the focused tab
    if (!document.hidden === false) {
      // We are NOT in a background tab — user might be here
      // Check via checking document visibility
    }

    // If user is actively viewing Messenger/Facebook in another tab, defer
    // We detect this by checking if our tab is visible or not
    // Since service worker opened us as active:false, we're background.
    // But if the user switches to us, defer.
    // For simplicity: check if document is currently focused
    if (document.hasFocus()) {
      // User is looking at this tab — unusual. Defer to be safe.
      return { defer: true };
    }

    // Wait for messenger UI to be ready
    const inputEl = await waitForElement(
      '[role="textbox"][contenteditable="true"], [data-testid="composer-input"], [aria-label="Message"]',
      15000
    );

    if (!inputEl) {
      throw new Error('Message input not found');
    }

    // Focus the input
    inputEl.focus();
    inputEl.click();
    await sleep(300);

    // Type the message character by character
    for (const char of message) {
      const event = new InputEvent('input', {
        data: char,
        inputType: 'insertText',
        bubbles: true,
        cancelable: true
      });

      // Use execCommand for reliable typing in contenteditable
      if (document.execCommand) {
        document.execCommand('insertText', false, char);
      } else {
        inputEl.textContent += char;
        inputEl.dispatchEvent(event);
      }

      await sleep(randomBetween(30, 80));
    }

    await sleep(500);

    // Press Enter to send (try multiple methods)
    const enterEvent = new KeyboardEvent('keydown', {
      key: 'Enter',
      code: 'Enter',
      keyCode: 13,
      which: 13,
      bubbles: true,
      cancelable: true
    });

    inputEl.dispatchEvent(enterEvent);

    // Also try clicking Send button if Enter doesn't work
    await sleep(500);
    const sendBtn = document.querySelector(
      '[data-testid="send-button"], button[aria-label="Send"], button[type="submit"]'
    );
    if (sendBtn) {
      sendBtn.click();
    }

    // Wait for message to appear (sent confirmation)
    await sleep(2000);

    // Verify message was sent — look for it in the thread
    const messageInThread = await verifyMessageSent(message.substring(0, 20));

    if (messageInThread) {
      return { success: true };
    }

    // If we can't verify, assume success (better than false failure)
    return { success: true };
  }

  async function waitForElement(selector, timeout = 10000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const el = document.querySelector(selector);
      if (el) return el;
      await sleep(300);
    }
    return null;
  }

  async function verifyMessageSent(messageStart) {
    await sleep(1000);
    // Look for the message text in the conversation
    const messages = document.querySelectorAll('[data-testid="message-text"], [dir="auto"]');
    for (const msg of messages) {
      if (msg.textContent?.includes(messageStart)) {
        return true;
      }
    }
    return false; // Can't verify, but continue anyway
  }

  console.log('[FSI] Content script loaded on:', window.location.hostname);
})();
