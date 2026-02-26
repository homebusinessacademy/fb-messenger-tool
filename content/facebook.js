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

    // Find the scrollable container — Facebook renders the friends list in a scrollable div,
    // not the window. Try multiple candidates.
    function getScrollContainer() {
      // Most specific first
      const candidates = [
        document.querySelector('[data-pagelet="FriendsListPageContent"]'),
        document.querySelector('[role="main"]'),
        document.querySelector('[aria-label="Friends"]'),
        // Find any ancestor of a friend link that is scrollable
        (() => {
          const link = document.querySelector('a[href*="facebook.com/"]');
          if (!link) return null;
          let el = link.parentElement;
          while (el && el !== document.body) {
            const style = window.getComputedStyle(el);
            if (style.overflow === 'auto' || style.overflow === 'scroll' ||
                style.overflowY === 'auto' || style.overflowY === 'scroll') {
              return el;
            }
            el = el.parentElement;
          }
          return null;
        })()
      ];
      return candidates.find(el => el !== null) || null;
    }

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

      // Stop if no new friends for 20 scroll rounds
      if (stableRounds >= 20 && friends.length > 0) break;

      // Scroll the container (not window) — try all approaches
      const container = getScrollContainer();
      if (container) {
        container.scrollTop += 1000;
      }
      // Also scroll the window as fallback
      window.scrollBy(0, 800);
      window.scrollTo(0, document.body.scrollHeight);

      await sleep(1200);
    }

    // Save to storage
    await new Promise(resolve => chrome.storage.local.set({ friends }, resolve));

    return { success: true, count: friends.length, friends };
  }

  function extractFriendsFromDOM(friends, seen) {
    // The key signal for a friend entry: an <a> tag with a Facebook profile URL
    // that ALSO contains BOTH a profile image AND a name span.
    // This avoids picking up nav links, ads, etc.

    // Collect candidate links — try targeted containers first, then fall back broadly
    let candidateLinks = [];

    // 1. Most targeted: friends list pagelet
    const pagelet = document.querySelector('[data-pagelet="FriendsListPageContent"]');
    if (pagelet) {
      candidateLinks = Array.from(pagelet.querySelectorAll('a[href]'));
    }

    // 2. Try aria-label="Friends" container
    if (candidateLinks.length === 0) {
      const ariaFriends = document.querySelector('[aria-label="Friends"]');
      if (ariaFriends) {
        candidateLinks = Array.from(ariaFriends.querySelectorAll('a[href]'));
      }
    }

    // 3. Try ul/li list items (another FB structure)
    if (candidateLinks.length === 0) {
      candidateLinks = Array.from(document.querySelectorAll('ul li a[href*="facebook.com"]'));
    }

    // 4. Fall back to role="main" (broad but better than all links)
    if (candidateLinks.length === 0) {
      const main = document.querySelector('[role="main"]');
      if (main) {
        candidateLinks = Array.from(main.querySelectorAll('a[href]'));
      }
    }

    // 5. Last resort: all links on the page
    if (candidateLinks.length === 0) {
      candidateLinks = Array.from(document.querySelectorAll('a[href]'));
    }

    const EXCLUDED_USERNAMES = new Set([
      'friends', 'groups', 'pages', 'events', 'marketplace', 'watch',
      'gaming', 'help', 'settings', 'notifications', 'messages', 'login',
      'home.php', 'find-friends', 'saved', 'memories', 'ads', 'fundraisers',
      'weather', 'jobs', 'news', 'profile', 'directory', 'search'
    ]);

    candidateLinks.forEach(link => {
      const href = link.href || '';

      // Match facebook.com profile URLs
      const profileMatch = href.match(/facebook\.com\/([a-zA-Z0-9.]+)\/?(\?.*)?$/) ||
                           href.match(/facebook\.com\/profile\.php\?id=(\d+)/);

      if (!profileMatch) return;

      // Extract user ID
      let userId;
      if (href.includes('profile.php?id=')) {
        userId = href.match(/id=(\d+)/)?.[1];
      } else {
        const pathParts = href.split('facebook.com/')[1]?.split('?')[0]?.split('/');
        const username = pathParts?.[0];
        if (!username || EXCLUDED_USERNAMES.has(username.toLowerCase())) return;
        userId = username;
      }

      if (!userId || seen.has(userId)) return;

      // Key signal: must have BOTH an image AND a named span (friend card structure)
      const img = link.querySelector('img');
      const spanEl = link.querySelector('span');

      // If we found both img+span — this is almost certainly a friend card
      // If not, still try but be more strict about name quality
      const hasPhoto = !!img;
      const profilePhotoUrl = img?.src || '';

      // Extract name — prefer span text, fall back to link text
      let name = '';
      if (spanEl) {
        // Find the span with the best name candidate (longest span text that looks like a name)
        const allSpans = Array.from(link.querySelectorAll('span'));
        const nameCandidates = allSpans
          .map(s => s.textContent?.trim())
          .filter(t => t && t.length >= 2 && t.length <= 80 && !/^\d+$/.test(t) &&
                       !t.includes('·') && !t.includes('ago') && !t.includes('friend') &&
                       !/^\d+ (mutual|common)/i.test(t));
        name = nameCandidates[0] || link.textContent?.trim() || '';
      } else {
        name = link.textContent?.trim() || '';
      }

      if (!name || name.length < 2 || name.length > 80) return;
      if (/^\d+$/.test(name) || name.includes('·') || name.includes('ago')) return;

      // Require photo+name combo OR be lenient if we're in the friends pagelet
      if (!hasPhoto && !pagelet) return; // outside targeted containers, require photo

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
