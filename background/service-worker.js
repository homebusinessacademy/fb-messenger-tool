// Fast Start Inviter — Service Worker (Chrome MV3)
// All logic self-contained; no ES module imports needed

// ─── Message Variations (inlined) ──────────────────────────────────────────

const MESSAGE_VARIATIONS = [
  "Hey {{first_name}}, hope you're having a {great|wonderful|fantastic} day! Quick question. I recently {ran across|came across|found} a {project|business project|business model} that looks like it could be pretty {lucrative|profitable|great}. Would you be open to {taking a peek|checking it out|taking a look}? No worries {if not|if no}, just let me know.",

  "Hey {{first_name}}, hope you're doing well. This might not be for you, but you came to mind when I saw it, so {wanted to touch base|thought I'd reach out} just in case. It's an online {marketing|business} project, different from anything I've seen before, and looks like it could be a pretty {good money maker|income stream|great income generator}. Does that sound like something you'd be open to {taking a look at|checking out}?",

  "Hi {{first_name}}, hope {all is well in your world|everything's going great|life is treating you well}. \uD83D\uDE42 I just {found|came across} something that made me think of you. It's an online business that's pretty {unique|different|one of a kind}. Honestly, I've never seen anything quite like it. Anyway, it looks like it could have some pretty {good|solid|great} potential so I wanted to reach out to see if you'd be open to taking a look?",

  "Hey {{first_name}}, hope you're having an {awesome|amazing|great} day! I just {saw|came across|found} a very unique {business project|project|business model} that made me think of you. {Who knows, maybe I'm crazy|Maybe it's a long shot}, but wanted to reach out just in case. Are you open to {checking out|exploring|looking at} any ways to {generate income|make money|create income} outside of what you're currently doing?",

  "Hey {{first_name}}, hope {all is good|everything's great|you're doing well}! {Random question|Quick question}. I just saw something that I'm pretty {excited|pumped} about. It's a business {project|model} that's {quite|pretty} unique. Wondering if you might be open to taking a look? No worries if not, just let me know. {Love to hear what you've been up to these days too|Would love to catch up too}!"
];

// ─── Spintax Parser (inlined) ───────────────────────────────────────────────

function spinText(template) {
  const pattern = /\{([^{}]+\|[^{}]+)\}/g;
  return template.replace(pattern, (match, options) => {
    const choices = options.split('|');
    return choices[Math.floor(Math.random() * choices.length)].trim();
  });
}

function applyMessage(variationIndex, firstName) {
  const template = MESSAGE_VARIATIONS[variationIndex] || MESSAGE_VARIATIONS[0];
  const spun = spinText(template);
  return spun.replace(/\{\{first_name\}\}/g, firstName);
}

function getRandomVariationIndex(lastIndex = null) {
  const indices = [0, 1, 2, 3, 4];
  if (lastIndex !== null) {
    const filtered = indices.filter(i => i !== lastIndex);
    return filtered[Math.floor(Math.random() * filtered.length)];
  }
  return Math.floor(Math.random() * indices.length);
}

// ─── Constants ───────────────────────────────────────────────────────────────

const MAX_DAILY = 10;
const WINDOW_START_HOUR = 9;   // 9am
const WINDOW_END_HOUR = 20;    // 8pm

// ⚠️ TEST MODE — set TEST_MODE = false before going live
const TEST_MODE = true; // ⚠️ flip to false before going live
const MIN_GAP_MIN = TEST_MODE ? 1   : 30;
const MAX_GAP_MIN = TEST_MODE ? 2   : 60;
const DEFER_MIN   = TEST_MODE ? 1   : 15;

const ALARM_NAME = 'send-next-message';

// ─── Storage Helpers ─────────────────────────────────────────────────────────

async function getStorage(keys) {
  return new Promise(resolve => chrome.storage.local.get(keys, resolve));
}

async function setStorage(data) {
  return new Promise(resolve => chrome.storage.local.set(data, resolve));
}

// ─── Time Helpers ─────────────────────────────────────────────────────────────

function isInWindow(now = new Date()) {
  const h = now.getHours();
  return h >= WINDOW_START_HOUR && h < WINDOW_END_HOUR;
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function minutesUntilWindowOpen() {
  const now = new Date();
  const h = now.getHours();
  if (h < WINDOW_START_HOUR) {
    return (WINDOW_START_HOUR - h) * 60 - now.getMinutes();
  }
  // After window: schedule for 9am tomorrow
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(WINDOW_START_HOUR, 0, 0, 0);
  return Math.ceil((tomorrow - now) / 60000);
}

function randomGapMinutes() {
  return MIN_GAP_MIN + Math.floor(Math.random() * (MAX_GAP_MIN - MIN_GAP_MIN + 1));
}

// ─── Alarm Scheduling ────────────────────────────────────────────────────────

function scheduleAlarm(delayMinutes) {
  chrome.alarms.clear(ALARM_NAME, () => {
    chrome.alarms.create(ALARM_NAME, { delayInMinutes: delayMinutes });
    console.log(`[FSI] Next alarm in ${delayMinutes.toFixed(1)} min`);
  });
}

// ─── Campaign Logic ──────────────────────────────────────────────────────────

async function getNextPendingFriend(campaign) {
  const { selectedFriendIds, sendRecords } = campaign;
  for (const friendId of selectedFriendIds) {
    const rec = sendRecords[friendId];
    if (!rec || rec.status === 'pending') {
      return friendId;
    }
  }
  return null;
}

// Wait for a tab to finish loading
function waitForTabLoad(tabId, timeoutMs = 20000) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, timeoutMs);
    function listener(id, info) {
      if (id === tabId && info.status === 'complete') {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }
    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function sendToFriend(friendId, campaign) {
  const { friends = [] } = await getStorage(['friends']);
  const friend = friends.find(f => f.id === friendId);
  if (!friend) {
    console.warn(`[FSI] Friend not found: ${friendId}`);
    return false;
  }

  const lastVariation = campaign.lastVariationIndex ?? null;
  const variationIndex = getRandomVariationIndex(lastVariation);
  const message = applyMessage(variationIndex, friend.firstName || friend.name.split(' ')[0]);

  // Open facebook.com/messages — stays in Chrome (messenger.com triggers desktop app)
  const url = `https://www.facebook.com/messages/t/${friendId}`;
  console.log(`[FSI] Opening tab: ${url}`);
  const tab = await new Promise(resolve => chrome.tabs.create({ url, active: true }, resolve));

  // Wait for page to fully load, then give Messenger UI time to mount
  await waitForTabLoad(tab.id, 20000);
  await sleep(4000);
  console.log(`[FSI] Tab loaded, looking for input...`);

  try {
    const exec = (func, args) => chrome.scripting.executeScript({ target: { tabId: tab.id }, func, args });

    // Step 1: Poll for input (up to 12s, in SW — no async needed inside executeScript)
    const INPUT_SEL = '[role="textbox"][contenteditable="true"]';
    let inputFound = false;
    for (let i = 0; i < 24; i++) {
      const r = await exec(() => !!document.querySelector('[role="textbox"][contenteditable="true"]'));
      if (r[0]?.result) { inputFound = true; break; }
      await sleep(500);
    }
    if (!inputFound) throw new Error('Input not found after 12s — Messenger UI may not have loaded');
    console.log('[FSI] Input found, pasting message...');

    // Step 2: Check defer (user actively on this tab)
    const focusCheck = await exec(() => document.hasFocus());
    if (focusCheck[0]?.result) {
      console.log('[FSI] User is on Messenger — deferring.');
      chrome.tabs.remove(tab.id).catch(() => {});
      scheduleAlarm(DEFER_MIN);
      return 'deferred';
    }

    // Step 3: Paste message into input
    const pasteOk = await exec((msg) => {
      const input = document.querySelector('[role="textbox"][contenteditable="true"]');
      if (!input) return false;
      input.focus();
      const dt = new DataTransfer();
      dt.setData('text/plain', msg);
      input.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
      return (input.textContent || '').trim().length > 0;
    }, [message]);
    if (!pasteOk[0]?.result) throw new Error('Paste did not insert text into input');
    console.log('[FSI] Message pasted, pressing Enter...');

    await sleep(700);

    // Step 4: Press Enter to send
    await exec(() => {
      const input = document.querySelector('[role="textbox"][contenteditable="true"]');
      if (!input) return;
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }));
    });

    await sleep(1500);

    // Step 5: Verify sent (input should be empty)
    const cleared = await exec(() => (document.querySelector('[role="textbox"][contenteditable="true"]')?.textContent || '').trim() === '');
    const result = { success: !!cleared[0]?.result, error: cleared[0]?.result ? null : 'Input not cleared after Enter' };

    if (result?.success) {
      const now = new Date().toISOString();
      campaign.sendRecords[friendId] = {
        status: 'sent',
        messageVariation: variationIndex,
        scheduledAt: campaign.sendRecords[friendId]?.scheduledAt || now,
        sentAt: now,
        error: null
      };
      campaign.sentToday = (campaign.sentToday || 0) + 1;
      campaign.lastVariationIndex = variationIndex;
      console.log(`[FSI] ✅ Sent to ${friend.name}`);
      chrome.tabs.remove(tab.id).catch(() => {});
      return true;
    }

    throw new Error(result?.error || 'Unknown send failure');

  } catch (err) {
    console.error(`[FSI] Send failed for ${friend.name}:`, err.message);
    const now = new Date().toISOString();
    campaign.sendRecords[friendId] = {
      status: 'failed',
      messageVariation: variationIndex,
      scheduledAt: campaign.sendRecords[friendId]?.scheduledAt || now,
      sentAt: null,
      error: err.message
    };
    // Store last error for popup debugging
    await setStorage({ lastSendError: { name: friend.name, error: err.message, at: now } });
    chrome.tabs.remove(tab.id).catch(() => {});
    return false;
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Check if campaign is complete
function isCampaignComplete(campaign) {
  const { selectedFriendIds, sendRecords } = campaign;
  return selectedFriendIds.every(id => {
    const rec = sendRecords[id];
    return rec && (rec.status === 'sent' || rec.status === 'failed');
  });
}

// ─── Main Alarm Handler ──────────────────────────────────────────────────────

async function handleSendAlarm() {
  const data = await getStorage(['campaign']);
  let campaign = data.campaign;

  if (!campaign || campaign.status === 'paused' || campaign.status === 'complete' || campaign.status === null) {
    console.log('[FSI] Campaign not active, skipping alarm.');
    return;
  }

  // Daily reset
  const today = todayStr();
  if (campaign.lastSendDate !== today) {
    campaign.sentToday = 0;
    campaign.lastSendDate = today;
  }

  // Check daily limit
  if ((campaign.sentToday || 0) >= MAX_DAILY) {
    console.log('[FSI] Daily limit hit. Rescheduling for tomorrow.');
    const minUntilOpen = minutesUntilWindowOpen();
    scheduleAlarm(minUntilOpen);
    await setStorage({ campaign });
    return;
  }

  // Check time window
  if (!isInWindow()) {
    console.log('[FSI] Outside send window. Rescheduling.');
    const minUntilOpen = minutesUntilWindowOpen();
    scheduleAlarm(minUntilOpen);
    await setStorage({ campaign });
    return;
  }

  // Get next friend
  const friendId = await getNextPendingFriend(campaign);
  if (!friendId) {
    // All done
    campaign.status = 'complete';
    await setStorage({ campaign });
    console.log('[FSI] Campaign complete!');
    return;
  }

  // Mark as in-flight
  if (!campaign.sendRecords[friendId]) {
    campaign.sendRecords[friendId] = {
      status: 'pending',
      messageVariation: null,
      scheduledAt: new Date().toISOString(),
      sentAt: null,
      error: null
    };
  }
  await setStorage({ campaign });

  // Send
  const result = await sendToFriend(friendId, campaign);

  if (result === 'deferred') {
    // Already rescheduled
    return;
  }

  // Check if campaign complete
  if (isCampaignComplete(campaign)) {
    campaign.status = 'complete';
    await setStorage({ campaign });
    console.log('[FSI] Campaign complete!');
    return;
  }

  // Save and schedule next
  await setStorage({ campaign });

  if (isInWindow() && (campaign.sentToday || 0) < MAX_DAILY) {
    scheduleAlarm(randomGapMinutes());
  } else if (!isInWindow()) {
    scheduleAlarm(minutesUntilWindowOpen());
  }
  // If daily limit reached, do nothing — next alarm will fire when reset happens
}

// ─── Chrome Event Listeners ──────────────────────────────────────────────────

// ─── Alarm Recovery ──────────────────────────────────────────────────────────
// Called on every SW startup — reschedules alarm if campaign is active but alarm is missing

async function recoverAlarmIfNeeded() {
  const { campaign } = await getStorage(['campaign']);
  if (!campaign || campaign.status !== 'active') return;

  const alarms = await new Promise(resolve => chrome.alarms.getAll(resolve));
  const hasAlarm = alarms.some(a => a.name === ALARM_NAME);
  if (hasAlarm) return;

  console.log('[FSI] Recovery: active campaign found but no alarm — rescheduling.');
  if (isInWindow() && (campaign.sentToday || 0) < MAX_DAILY) {
    scheduleAlarm(1);
  } else {
    scheduleAlarm(minutesUntilWindowOpen());
  }
}

// Run recovery on every SW wake (install, update, Chrome start, SW restart)
chrome.runtime.onInstalled.addListener(() => recoverAlarmIfNeeded());
chrome.runtime.onStartup.addListener(() => recoverAlarmIfNeeded());
recoverAlarmIfNeeded(); // also runs immediately when SW first loads

chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === ALARM_NAME) {
    handleSendAlarm();
  }
});

// ─── Friend Scraping (runs in SW so popup stays open) ────────────────────────

function isHbaMemberSW(memberSet, fullName) {
  if (!fullName || memberSet.size === 0) return false;
  const n = fullName.toLowerCase().trim();
  if (memberSet.has(n)) return true;
  const parts = n.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    const fl = `${parts[0]} ${parts[parts.length - 1]}`;
    if (memberSet.has(fl)) return true;
    for (const m of memberSet) {
      const mp = m.split(/\s+/).filter(Boolean);
      if (mp.length >= 2 && mp[0] === parts[0] && mp[mp.length - 1] === parts[parts.length - 1]) return true;
    }
  }
  return false;
}

async function handleScrapeFriends() {
  try {
    await setStorage({ scrapeProgress: 0, scrapeStatus: 'running', scrapeError: null });

    // Find existing friends tab or open a new one
    const existingTabs = await new Promise(resolve =>
      chrome.tabs.query({ url: '*://*.facebook.com/friends*' }, resolve)
    );
    let tabId, createdTab = false;
    if (existingTabs.length > 0) {
      tabId = existingTabs[0].id;
    } else {
      const tab = await new Promise(resolve =>
        chrome.tabs.create({ url: 'https://www.facebook.com/friends/list', active: true }, resolve)
      );
      tabId = tab.id;
      createdTab = true;
      await waitForTabLoad(tabId, 20000);
      await sleep(2000);
    }

    // Scroll loop — inline func, no outer scope refs
    let lastCount = 0, stableRounds = 0;
    for (let i = 0; i < 80; i++) {
      const res = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => {
          const el = Array.from(document.querySelectorAll('div')).find(e => {
            const s = getComputedStyle(e);
            return ['auto','scroll'].includes(s.overflowY) && e.scrollHeight > e.clientHeight + 200;
          });
          if (el) el.scrollTop += 1200;
          return document.querySelectorAll('[aria-label="All friends"] a[href*="facebook.com"]').length;
        }
      });
      const count = res[0]?.result || 0;
      await setStorage({ scrapeProgress: count });
      if (count !== lastCount) { stableRounds = 0; lastCount = count; } else { stableRounds++; }
      if (stableRounds >= 10 && count > 0) break;
      await sleep(1200);
    }

    // Extract all friend data
    const extractRes = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => Array.from(
        document.querySelectorAll('[aria-label="All friends"] a[href*="facebook.com"]')
      ).map(l => {
        const name = (l.textContent || '').trim().replace(/\d+\s+mutual.*$/i, '').trim();
        const href = l.href || '';
        const userId = href.includes('profile.php')
          ? href.match(/id=(\d+)/)?.[1]
          : href.split('facebook.com/')[1]?.split('?')[0]?.split('/')[0];
        const svgImg = l.querySelector('svg image');
        const profilePhotoUrl = svgImg?.href?.baseVal || svgImg?.getAttribute('xlink:href') || '';
        return { id: userId, name, firstName: name.split(' ')[0] || '', profilePhotoUrl, hbaMember: false };
      }).filter(f => f.name && f.id && f.name.length > 1)
    });

    const rawFriends = extractRes[0]?.result || [];
    if (createdTab) chrome.tabs.remove(tabId).catch(() => {});
    if (rawFriends.length === 0) throw new Error("No friends found — make sure you're logged into Facebook");

    // Fetch HBA members and mark
    const hbaResult = await fetchHbaMembers();
    const memberSet = new Set(hbaResult.members || []);
    const friendsWithHba = rawFriends.map(f => ({ ...f, hbaMember: isHbaMemberSW(memberSet, f.name) }));

    await setStorage({ friends: friendsWithHba, hbaMembers: [...memberSet], scrapeStatus: 'done' });
    console.log(`[FSI] Scrape done: ${friendsWithHba.length} friends`);
    return { success: true };
  } catch (err) {
    console.error('[FSI] Scrape failed:', err.message);
    await setStorage({ scrapeStatus: 'error', scrapeError: err.message });
    return { success: false, error: err.message };
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'START_SCRAPE') {
    handleScrapeFriends().then(sendResponse);
    return true;
  }
  if (message.type === 'START_CAMPAIGN') {
    handleStartCampaign(message.payload).then(sendResponse);
    return true;
  }
  if (message.type === 'PAUSE_CAMPAIGN') {
    handlePauseCampaign().then(sendResponse);
    return true;
  }
  if (message.type === 'RESUME_CAMPAIGN') {
    handleResumeCampaign().then(sendResponse);
    return true;
  }
  if (message.type === 'CANCEL_CAMPAIGN') {
    handleCancelCampaign().then(sendResponse);
    return true;
  }
  if (message.type === 'GET_STATUS') {
    getStatus().then(sendResponse);
    return true;
  }
  if (message.type === 'FETCH_HBA_MEMBERS') {
    fetchHbaMembers().then(sendResponse);
    return true;
  }
});

async function handleStartCampaign({ selectedFriendIds }) {
  const today = todayStr();

  // Build send records
  const sendRecords = {};
  for (const id of selectedFriendIds) {
    sendRecords[id] = {
      status: 'pending',
      messageVariation: null,
      scheduledAt: null,
      sentAt: null,
      error: null
    };
  }

  const campaign = {
    status: 'active',
    selectedFriendIds,
    sendRecords,
    startedAt: new Date().toISOString(),
    sentToday: 0,
    lastSendDate: today,
    lastVariationIndex: null
  };

  await setStorage({ campaign });

  // Schedule first send — within 1 min if in window, else wait for window
  if (isInWindow()) {
    scheduleAlarm(1);
  } else {
    scheduleAlarm(minutesUntilWindowOpen());
  }

  return { success: true };
}

async function handlePauseCampaign() {
  const { campaign } = await getStorage(['campaign']);
  if (campaign) {
    campaign.status = 'paused';
    await setStorage({ campaign });
    chrome.alarms.clear(ALARM_NAME);
  }
  return { success: true };
}

async function handleResumeCampaign() {
  const { campaign } = await getStorage(['campaign']);
  if (campaign) {
    campaign.status = 'active';
    await setStorage({ campaign });
    if (isInWindow() && (campaign.sentToday || 0) < MAX_DAILY) {
      scheduleAlarm(1);
    } else {
      scheduleAlarm(minutesUntilWindowOpen());
    }
  }
  return { success: true };
}

async function handleCancelCampaign() {
  await setStorage({ campaign: null });
  chrome.alarms.clear(ALARM_NAME);
  return { success: true };
}

async function getStatus() {
  const data = await getStorage(['campaign', 'friends', 'lastSendError']);
  const campaign = data.campaign;
  if (!campaign) return { campaign: null };

  const total = campaign.selectedFriendIds?.length || 0;
  const sent = Object.values(campaign.sendRecords || {}).filter(r => r.status === 'sent').length;
  const failed = Object.values(campaign.sendRecords || {}).filter(r => r.status === 'failed').length;

  // Get next alarm
  let nextAlarmMinutes = null;
  const alarms = await new Promise(resolve => chrome.alarms.getAll(resolve));
  const alarm = alarms.find(a => a.name === ALARM_NAME);
  if (alarm) {
    nextAlarmMinutes = Math.max(0, Math.round((alarm.scheduledTime - Date.now()) / 60000));
  }

  // Estimate completion date
  const remaining = total - sent - failed;
  const avgPerDay = 8; // conservative estimate
  const daysRemaining = remaining > 0 ? Math.ceil(remaining / avgPerDay) : 0;
  const estComplete = new Date();
  estComplete.setDate(estComplete.getDate() + daysRemaining);
  const estCompleteStr = estComplete.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

  // Days elapsed
  const startedAt = campaign.startedAt ? new Date(campaign.startedAt) : new Date();
  const daysElapsed = Math.max(1, Math.ceil((Date.now() - startedAt.getTime()) / 86400000));

  return {
    campaign: {
      ...campaign,
      sent,
      total,
      failed,
      nextAlarmMinutes,
      estComplete: estCompleteStr,
      daysElapsed
    },
    lastSendError: data.lastSendError || null
  };
}

// Call HBA MCP API — handles SSE response format
async function callHbaMcp(toolName, args = {}) {
  const res = await fetch('https://thehba.app/api/mcp', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer hba_f894f9b4071a7934e6e1c1e68297a9935731e70b8f20729741ffe8bfa8c35c02',
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream'  // API requires BOTH
    },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'tools/call',
      params: { name: toolName, arguments: args }
    })
  });
  // Response is SSE format: "event: message\ndata: {...}\n\n"
  const text = await res.text();
  const dataLine = text.split('\n').find(l => l.startsWith('data: '));
  if (!dataLine) throw new Error('No data line in SSE response');
  const envelope = JSON.parse(dataLine.substring(6));
  const textContent = envelope?.result?.content?.find?.(c => c.type === 'text')?.text;
  if (!textContent) throw new Error('No text content in MCP response');
  return JSON.parse(textContent);
}

async function fetchHbaMembers() {
  try {
    // get_active_customers returns ALL HBA customers (1463+), paginated
    // Fetch all pages with limit=500 (3 requests max)
    const allMembers = [];
    let offset = 0;
    const limit = 500;

    while (true) {
      const data = await callHbaMcp('get_active_customers', { limit, offset });
      const customers = data.customers || [];
      const total = parseInt(data.totalCount || '0');

      for (const c of customers) {
        const name = `${c.firstName || ''} ${c.lastName || ''}`.trim().toLowerCase();
        if (name) allMembers.push(name);
      }

      offset += customers.length;
      console.log(`[FSI] HBA members loaded: ${allMembers.length} / ${total}`);

      if (customers.length === 0 || allMembers.length >= total) break;
    }

    console.log('[FSI] Total HBA members:', allMembers.length, '| Sample:', allMembers.slice(0, 5));
    await setStorage({ hbaMembers: allMembers });
    return { success: true, members: allMembers };
  } catch (err) {
    console.error('[FSI] Failed to fetch HBA members:', err);
    return { success: false, error: err.message, members: [] };
  }
}
