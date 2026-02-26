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

  // Use facebook.com/messages (same session as friends scraping, more reliable than messenger.com)
  const url = `https://www.facebook.com/messages/t/${friendId}`;
  const tab = await new Promise(resolve => chrome.tabs.create({ url, active: false }, resolve));

  // Wait for page to fully load, then give React UI time to mount
  await waitForTabLoad(tab.id, 20000);
  await sleep(3500);

  try {
    // Inject message sending directly — no content script dependency
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: async (msg) => {
        function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

        // Wait for Messenger input to appear (up to 12s)
        let input = null;
        for (let i = 0; i < 24; i++) {
          input = document.querySelector('[role="textbox"][contenteditable="true"]') ||
                  document.querySelector('div[contenteditable="true"][data-lexical-editor="true"]') ||
                  document.querySelector('div[aria-label][contenteditable="true"]');
          if (input) break;
          await sleep(500);
        }

        if (!input) return { success: false, error: 'Message input not found after 12s' };

        // Check if user is actively using this tab (defer if focused)
        if (document.hasFocus()) return { defer: true };

        // Focus and type the message
        input.focus();
        await sleep(300);

        // Clear any existing text then insert
        document.execCommand('selectAll', false, null);
        document.execCommand('delete', false, null);
        document.execCommand('insertText', false, msg);
        await sleep(600);

        // Verify text was inserted
        const typed = (input.textContent || '').trim();
        if (!typed) return { success: false, error: 'Text did not insert into input' };

        // Send with Enter
        input.dispatchEvent(new KeyboardEvent('keydown', {
          key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true
        }));
        await sleep(1500);

        // Confirm sent: input should be empty now
        const cleared = (input.textContent || '').trim() === '';
        return { success: cleared, error: cleared ? null : 'Input still has text after Enter — may not have sent' };
      },
      args: [message]
    });

    const result = results?.[0]?.result;

    if (result?.defer) {
      console.log('[FSI] User is on Messenger — deferring 15min.');
      chrome.tabs.remove(tab.id).catch(() => {});
      scheduleAlarm(DEFER_MIN);
      return 'deferred';
    }

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

chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === ALARM_NAME) {
    handleSendAlarm();
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
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
  const data = await getStorage(['campaign', 'friends']);
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
    }
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
