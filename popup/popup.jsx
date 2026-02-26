import React, { useState, useEffect, useCallback, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { MESSAGE_VARIATIONS } from '../messages.js';
import { applyMessage, spinText } from '../utils/spintax.js';
import './popup.css';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sendToSW(type, payload = {}) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type, ...payload }, response => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(response);
      }
    });
  });
}

function getFromStorage(keys) {
  return new Promise(resolve => chrome.storage.local.get(keys, resolve));
}

// ─── HBA Membership Matching ──────────────────────────────────────────────────
// Robust match: try full name, then first+last (strips middle names)
function isHbaMember(memberSet, fullName) {
  if (!fullName || memberSet.size === 0) return false;
  const nameLower = fullName.toLowerCase().trim();

  // 1. Exact full name match
  if (memberSet.has(nameLower)) return true;

  // 2. First + last only (strip middle names from both sides)
  const parts = nameLower.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    const firstLast = `${parts[0]} ${parts[parts.length - 1]}`;
    if (memberSet.has(firstLast)) return true;
  }

  // 3. Check if any member name starts with the friend's first name + last name
  // (handles cases where HBA has middle name but Facebook doesn't, or vice versa)
  if (parts.length >= 2) {
    const firstName = parts[0];
    const lastName = parts[parts.length - 1];
    for (const member of memberSet) {
      const mParts = member.split(/\s+/).filter(Boolean);
      if (mParts.length >= 2 && mParts[0] === firstName && mParts[mParts.length - 1] === lastName) {
        return true;
      }
    }
  }

  return false;
}

// ─── App Component ────────────────────────────────────────────────────────────

function App() {
  // State machine: welcome | loading | review | campaign | complete
  const [screen, setScreen] = useState('welcome');
  const [friends, setFriends] = useState([]);
  const [hbaMembers, setHbaMembers] = useState(new Set());
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [loadProgress, setLoadProgress] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [showAllMessages, setShowAllMessages] = useState(false);
  const [campaignData, setCampaignData] = useState(null);
  const [isActivelyRescheduled, setIsActivelyRescheduled] = useState(false);
  const [previewMessage, setPreviewMessage] = useState('');
  const statusInterval = useRef(null);

  // Load state from storage on mount
  useEffect(() => {
    initFromStorage();

    // Listen for scrape progress
    const msgListener = (message) => {
      if (message.type === 'SCRAPE_PROGRESS') {
        setLoadProgress(message.count);
      }
    };
    chrome.runtime.onMessage.addListener(msgListener);

    return () => {
      chrome.runtime.onMessage.removeListener(msgListener);
      clearInterval(statusInterval.current);
    };
  }, []);

  // Poll campaign status when on campaign screen
  useEffect(() => {
    if (screen === 'campaign') {
      pollStatus();
      statusInterval.current = setInterval(pollStatus, 5000);
    } else {
      clearInterval(statusInterval.current);
    }
    return () => clearInterval(statusInterval.current);
  }, [screen]);

  // Generate preview message on mount
  useEffect(() => {
    const preview = spinText(MESSAGE_VARIATIONS[0]).replace(/\{\{first_name\}\}/g, 'Sarah');
    setPreviewMessage(preview);
  }, []);

  async function initFromStorage() {
    const data = await getFromStorage(['friends', 'hbaMembers', 'campaign']);

    // Check for active campaign first
    if (data.campaign) {
      if (data.campaign.status === 'complete') {
        setCampaignData(data.campaign);
        setScreen('complete');
        return;
      }
      if (data.campaign.status === 'active' || data.campaign.status === 'paused') {
        const status = await sendToSW('GET_STATUS');
        setCampaignData(status.campaign);
        setScreen('campaign');
        return;
      }
    }

    // Check for loaded friends
    if (data.friends && data.friends.length > 0) {
      const memberSet = new Set(data.hbaMembers || []);
      const friendsWithHba = data.friends.map(f => ({
        ...f,
        hbaMember: isHbaMember(memberSet, f.name)
      }));
      setFriends(friendsWithHba);
      setHbaMembers(memberSet);

      // Pre-select non-HBA members
      const nonHba = new Set(friendsWithHba.filter(f => !f.hbaMember).map(f => f.id));
      setSelectedIds(nonHba);
      setScreen('review');
      return;
    }

    setScreen('welcome');
  }

  async function pollStatus() {
    try {
      const status = await sendToSW('GET_STATUS');
      if (status?.campaign) {
        setCampaignData(status.campaign);
        if (status.campaign.status === 'complete') {
          setScreen('complete');
        }
      }
    } catch (e) {
      console.warn('Status poll failed:', e);
    }
  }

  // ─── Load Friends ──────────────────────────────────────────────────────────

  // Wait for a tab to finish loading
  function waitForTabLoad(tabId, timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve(); // timeout — try anyway
      }, timeoutMs);

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

  // Send message to tab with retries (content script may not be ready instantly)
  function sendToTabWithRetry(tabId, message, maxRetries = 8, delayMs = 2000) {
    return new Promise((resolve, reject) => {
      let attempts = 0;
      function attempt() {
        attempts++;
        chrome.tabs.sendMessage(tabId, message, response => {
          if (chrome.runtime.lastError) {
            if (attempts < maxRetries) {
              setTimeout(attempt, delayMs);
            } else {
              reject(new Error(chrome.runtime.lastError.message));
            }
          } else {
            resolve(response);
          }
        });
      }
      attempt();
    });
  }

  async function handleLoadFriends() {
    setScreen('loading');
    setLoadProgress(0);

    try {
      // Fetch HBA members in background
      const hbaResult = await sendToSW('FETCH_HBA_MEMBERS').catch(() => ({ members: [] }));
      const memberSet = new Set(hbaResult.members || []);
      setHbaMembers(memberSet);

      // Use existing Facebook tab if on friends page, else open new one
      const existingTabs = await new Promise(resolve =>
        chrome.tabs.query({ url: '*://*.facebook.com/friends*' }, resolve)
      );
      let fbTab;
      if (existingTabs.length > 0) {
        fbTab = existingTabs[0];
      } else {
        fbTab = await new Promise(resolve =>
          chrome.tabs.create({ url: 'https://www.facebook.com/friends/list', active: false }, resolve)
        );
        await waitForTabLoad(fbTab.id, 20000);
        await new Promise(resolve => setTimeout(resolve, 2000));
      }

      const tabId = fbTab.id;

      // SCROLL LOOP — direct executeScript, no content script needed
      const scrollOnce = () => {
        const el = Array.from(document.querySelectorAll('div')).find(e => {
          const s = getComputedStyle(e);
          return ['auto','scroll'].includes(s.overflowY) && e.scrollHeight > e.clientHeight + 200;
        });
        if (el) el.scrollTop += 1200;
        return document.querySelectorAll('[aria-label="All friends"] a[href*="facebook.com"]').length;
      };

      let lastCount = 0, stableRounds = 0;
      for (let i = 0; i < 80; i++) {
        const res = await chrome.scripting.executeScript({ target: { tabId }, func: scrollOnce });
        const count = res[0]?.result || 0;
        setLoadProgress(count);
        if (count === lastCount) { stableRounds++; } else { stableRounds = 0; }
        lastCount = count;
        if (stableRounds >= 10 && count > 0) break;
        await new Promise(resolve => setTimeout(resolve, 1200));
      }

      // EXTRACT — pull all friend data directly
      const extractFriends = () => {
        return Array.from(
          document.querySelectorAll('[aria-label="All friends"] a[href*="facebook.com"]')
        ).map(l => {
          const raw = l.textContent?.trim() || '';
          const name = raw.replace(/\d+\s+mutual.*$/i, '').trim();
          const href = l.href || '';
          const userId = href.includes('profile.php')
            ? href.match(/id=(\d+)/)?.[1]
            : href.split('facebook.com/')[1]?.split('?')[0]?.split('/')[0];
          const firstName = name.split(' ')[0] || '';
          const svgImg = l.querySelector('svg image');
          const profilePhotoUrl = svgImg?.href?.baseVal || svgImg?.getAttribute('xlink:href') || '';
          return { id: userId, name, firstName, profilePhotoUrl, hbaMember: false };
        }).filter(f => f.name && f.id && f.name.length > 1);
      };

      const extractRes = await chrome.scripting.executeScript({ target: { tabId }, func: extractFriends });
      const rawFriends = extractRes[0]?.result || [];

      // Close tab if we opened it
      if (existingTabs.length === 0) chrome.tabs.remove(tabId).catch(() => {});

      if (rawFriends.length === 0) throw new Error('No friends found — make sure you\'re on the friends page');

      // Mark HBA members
      const friendsWithHba = rawFriends.map(f => ({
        ...f,
        hbaMember: isHbaMember(memberSet, f.name)
      }));

      await chrome.storage.local.set({ friends: friendsWithHba });
      setFriends(friendsWithHba);
      const nonHba = new Set(friendsWithHba.filter(f => !f.hbaMember).map(f => f.id));
      setSelectedIds(nonHba);
      setScreen('review');

    } catch (err) {
      console.error('Load friends failed:', err);
      alert(`Failed to load friends: ${err.message}\n\nMake sure you're logged into Facebook and try again.`);
      setScreen('welcome');
    }
  }

  // ─── Campaign Actions ──────────────────────────────────────────────────────

  async function handleStartCampaign() {
    if (selectedIds.size === 0) {
      alert('Please select at least one friend to invite.');
      return;
    }

    const result = await sendToSW('START_CAMPAIGN', {
      payload: { selectedFriendIds: [...selectedIds] }
    });

    if (result?.success) {
      const status = await sendToSW('GET_STATUS');
      setCampaignData(status.campaign);
      setScreen('campaign');
    }
  }

  async function handlePause() {
    await sendToSW('PAUSE_CAMPAIGN');
    await pollStatus();
  }

  async function handleResume() {
    await sendToSW('RESUME_CAMPAIGN');
    await pollStatus();
  }

  async function handleCancel() {
    if (!confirm('Cancel this campaign? All progress will be lost.')) return;
    await sendToSW('CANCEL_CAMPAIGN');
    await chrome.storage.local.remove(['campaign']);
    setScreen('welcome');
    setCampaignData(null);
  }

  async function handleNewCampaign() {
    await chrome.storage.local.remove(['campaign']);
    setCampaignData(null);
    setScreen('welcome');
    setFriends([]);
    setSelectedIds(new Set());
  }

  // ─── Friend Selection ──────────────────────────────────────────────────────

  function toggleFriend(id) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAll() {
    setSelectedIds(new Set(friends.map(f => f.id)));
  }

  function deselectAll() {
    setSelectedIds(new Set());
  }

  const filteredFriends = friends.filter(f =>
    f.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const hbaCount = friends.filter(f => f.hbaMember).length;
  const estDays = selectedIds.size > 0 ? Math.ceil(selectedIds.size / 8) : 0;

  // ─── Render Screens ────────────────────────────────────────────────────────

  if (screen === 'welcome') return <WelcomeScreen onLoad={handleLoadFriends} />;

  if (screen === 'loading') return <LoadingScreen count={loadProgress} />;

  async function handleReloadFriends() {
    // Clear cached friends and re-scrape
    await chrome.storage.local.remove(['friends', 'hbaMembers']);
    setFriends([]);
    setSelectedIds(new Set());
    handleLoadFriends();
  }

  if (screen === 'review') return (
    <ReviewScreen
      friends={filteredFriends}
      allFriends={friends}
      selectedIds={selectedIds}
      hbaCount={hbaCount}
      estDays={estDays}
      searchQuery={searchQuery}
      showAllMessages={showAllMessages}
      previewMessage={previewMessage}
      onSearch={setSearchQuery}
      onToggleFriend={toggleFriend}
      onSelectAll={selectAll}
      onDeselectAll={deselectAll}
      onShowAllMessages={() => setShowAllMessages(v => !v)}
      onStart={handleStartCampaign}
      onReload={handleReloadFriends}
    />
  );

  if (screen === 'campaign') return (
    <CampaignScreen
      campaign={campaignData}
      onPause={handlePause}
      onResume={handleResume}
      onCancel={handleCancel}
    />
  );

  if (screen === 'complete') return (
    <CompleteScreen campaign={campaignData} onNewCampaign={handleNewCampaign} />
  );

  return null;
}

// ─── Screen: Welcome ─────────────────────────────────────────────────────────

function WelcomeScreen({ onLoad }) {
  return (
    <div className="flex flex-col items-center justify-center h-full" style={{ minHeight: 580, background: '#1a1a2e', padding: '32px 24px' }}>
      {/* Logo area */}
      <div style={{ fontSize: 56, marginBottom: 16 }}>🚀</div>
      <h1 style={{ fontSize: 22, fontWeight: 700, color: '#f1f5f9', textAlign: 'center', marginBottom: 8 }}>
        Fast Start Inviter
      </h1>
      <p style={{ fontSize: 14, color: '#94a3b8', textAlign: 'center', marginBottom: 32 }}>
        Ready to launch your business?
      </p>

      {/* Info card */}
      <div style={{
        background: '#0f0f23',
        border: '1px solid #2a2a4a',
        borderRadius: 12,
        padding: '16px 20px',
        marginBottom: 32,
        width: '100%'
      }}>
        <p style={{ fontSize: 13, color: '#94a3b8', textAlign: 'center', lineHeight: 1.6 }}>
          📋 Make sure you're logged into Facebook first, then click below to load your friends list.
        </p>
      </div>

      {/* How it works */}
      <div style={{ width: '100%', marginBottom: 32 }}>
        {[
          ['1', 'Load your Facebook friends list'],
          ['2', 'Review & select who to invite'],
          ['3', 'Hit Start — we handle the rest']
        ].map(([num, text]) => (
          <div key={num} style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
            <div style={{
              width: 28, height: 28, borderRadius: '50%',
              background: '#3b82f6', color: 'white',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 13, fontWeight: 700, flexShrink: 0
            }}>{num}</div>
            <span style={{ fontSize: 13, color: '#cbd5e1' }}>{text}</span>
          </div>
        ))}
      </div>

      <button
        onClick={onLoad}
        style={{
          width: '100%',
          padding: '14px 24px',
          background: '#3b82f6',
          color: 'white',
          border: 'none',
          borderRadius: 10,
          fontSize: 15,
          fontWeight: 600,
          cursor: 'pointer',
          transition: 'background 0.2s'
        }}
        onMouseOver={e => e.target.style.background = '#2563eb'}
        onMouseOut={e => e.target.style.background = '#3b82f6'}
      >
        Load My Friends
      </button>
    </div>
  );
}

// ─── Screen: Loading ─────────────────────────────────────────────────────────

function LoadingScreen({ count }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 580, background: '#1a1a2e', padding: '32px 24px' }}>
      <div style={{ fontSize: 48, marginBottom: 24 }}>👥</div>
      <h2 style={{ fontSize: 18, fontWeight: 600, color: '#f1f5f9', marginBottom: 8 }}>
        Loading your friends...
      </h2>
      <p style={{ fontSize: 13, color: '#64748b', marginBottom: 32 }}>
        This takes about 30 seconds
      </p>

      {/* Progress bar */}
      <div style={{ width: '100%', background: '#0f0f23', borderRadius: 8, height: 8, marginBottom: 16, overflow: 'hidden' }}>
        <div className="progress-bar-animated" style={{
          height: '100%',
          background: 'linear-gradient(90deg, #3b82f6, #60a5fa)',
          borderRadius: 8,
          width: count > 0 ? `${Math.min(95, (count / 500) * 100)}%` : '15%',
          transition: 'width 0.5s ease'
        }} />
      </div>

      <p style={{ fontSize: 14, color: '#94a3b8' }}>
        {count > 0 ? `${count} friends found so far...` : 'Connecting to Facebook...'}
      </p>
    </div>
  );
}

// ─── Screen: Review & Select ──────────────────────────────────────────────────

function ReviewScreen({ friends, allFriends, selectedIds, hbaCount, estDays, searchQuery, showAllMessages, previewMessage, onSearch, onToggleFriend, onSelectAll, onDeselectAll, onShowAllMessages, onStart, onReload }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 580, background: '#1a1a2e', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: '16px 16px 0', flexShrink: 0 }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, color: '#f1f5f9', marginBottom: 4 }}>
          🚀 Fast Start Inviter
        </h2>
        <p style={{ fontSize: 12, color: '#64748b' }}>
          {allFriends.length} friends loaded • {hbaCount} already HBA members
        </p>
      </div>

      {/* Message Preview */}
      <div style={{ margin: '12px 16px 0', background: '#0f0f23', border: '1px solid #2a2a4a', borderRadius: 10, padding: '12px 14px', flexShrink: 0 }}>
        <p style={{ fontSize: 11, fontWeight: 600, color: '#60a5fa', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Your Invitation Messages
        </p>
        <p style={{ fontSize: 12, color: '#94a3b8', lineHeight: 1.5 }}>
          {previewMessage}
        </p>
        <button
          onClick={onShowAllMessages}
          style={{ fontSize: 11, color: '#60a5fa', background: 'none', border: 'none', cursor: 'pointer', marginTop: 6, padding: 0 }}
        >
          {showAllMessages ? '▲ Hide messages' : '▼ See all 5 variations'}
        </button>

        {showAllMessages && (
          <div style={{ marginTop: 10, borderTop: '1px solid #2a2a4a', paddingTop: 10 }}>
            {MESSAGE_VARIATIONS.map((v, i) => (
              <div key={i} style={{ marginBottom: 10 }}>
                <p style={{ fontSize: 10, color: '#475569', marginBottom: 3 }}>Variation {i + 1}</p>
                <p style={{ fontSize: 11, color: '#94a3b8', lineHeight: 1.5 }}>{v.replace(/\{\{first_name\}\}/g, 'Sarah')}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Controls */}
      <div style={{ padding: '10px 16px 0', flexShrink: 0 }}>
        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
          <button onClick={onSelectAll} style={btnStyleSmall('#1e3a5f', '#60a5fa')}>
            Select All
          </button>
          <button onClick={onDeselectAll} style={btnStyleSmall('#1e2a1e', '#94a3b8')}>
            Deselect All
          </button>
        </div>

        <input
          type="text"
          placeholder="🔍 Search friends..."
          value={searchQuery}
          onChange={e => onSearch(e.target.value)}
          style={{
            width: '100%',
            padding: '8px 12px',
            background: '#0f0f23',
            border: '1px solid #2a2a4a',
            borderRadius: 8,
            color: '#e2e8f0',
            fontSize: 13
          }}
        />
      </div>

      {/* Friend List */}
      <div className="friend-list" style={{ flex: 1, padding: '6px 16px', overflow: 'auto', minHeight: 0 }}>
        {friends.length === 0 && (
          <p style={{ textAlign: 'center', color: '#475569', padding: '20px 0', fontSize: 13 }}>
            No friends match your search
          </p>
        )}
        {friends.map(friend => (
          <FriendRow
            key={friend.id}
            friend={friend}
            checked={selectedIds.has(friend.id)}
            onToggle={() => onToggleFriend(friend.id)}
          />
        ))}
      </div>

      {/* Footer */}
      <div style={{ padding: '10px 16px 12px', background: '#0f0f23', borderTop: '1px solid #2a2a4a', flexShrink: 0 }}>
        <p style={{ fontSize: 12, color: '#64748b', marginBottom: 10 }}>
          <span style={{ color: '#e2e8f0', fontWeight: 600 }}>{selectedIds.size}</span> selected
          {estDays > 0 && <span> • Est. <span style={{ color: '#60a5fa' }}>~{estDays} days</span> to complete</span>}
        </p>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={onReload}
            title="Reload friends list from Facebook"
            style={{
              padding: '12px 14px',
              background: '#1e1e38',
              color: '#94a3b8',
              border: '1px solid #2a2a4a',
              borderRadius: 8,
              fontSize: 16,
              cursor: 'pointer',
              flexShrink: 0
            }}
          >
            🔄
          </button>
          <button
            onClick={onStart}
            disabled={selectedIds.size === 0}
            style={{
              flex: 1,
              padding: '12px',
              background: selectedIds.size > 0 ? '#3b82f6' : '#2a2a4a',
              color: selectedIds.size > 0 ? 'white' : '#4a4a6a',
              border: 'none',
              borderRadius: 8,
              fontSize: 14,
              fontWeight: 600,
              cursor: selectedIds.size > 0 ? 'pointer' : 'not-allowed'
            }}
          >
            Start Inviting →
          </button>
        </div>
      </div>
    </div>
  );
}

function FriendRow({ friend, checked, onToggle }) {
  return (
    <div
      onClick={onToggle}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '7px 0',
        borderBottom: '1px solid #1e1e38',
        cursor: 'pointer'
      }}
    >
      {/* Avatar */}
      <div style={{ width: 32, height: 32, borderRadius: '50%', overflow: 'hidden', flexShrink: 0, background: '#2a2a4a' }}>
        {friend.profilePhotoUrl ? (
          <img src={friend.profilePhotoUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, color: '#60a5fa' }}>
            {friend.firstName?.[0] || '?'}
          </div>
        )}
      </div>

      {/* Name */}
      <span style={{ flex: 1, fontSize: 13, color: '#e2e8f0', userSelect: 'none' }}>
        {friend.name}
      </span>

      {/* HBA badge */}
      {friend.hbaMember && (
        <span style={{
          fontSize: 10, color: '#34d399', background: '#0a2a1e',
          border: '1px solid #065f46', borderRadius: 4,
          padding: '2px 6px', flexShrink: 0
        }}>
          Already In HBA
        </span>
      )}

      {/* Checkbox */}
      <input
        type="checkbox"
        checked={checked}
        onChange={onToggle}
        onClick={e => e.stopPropagation()}
        style={{ flexShrink: 0 }}
      />
    </div>
  );
}

// ─── Screen: Active Campaign ──────────────────────────────────────────────────

function CampaignScreen({ campaign, onPause, onResume, onCancel }) {
  if (!campaign) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 580, background: '#1a1a2e' }}>
        <p style={{ color: '#64748b' }}>Loading...</p>
      </div>
    );
  }

  const { status, sent = 0, total = 0, sentToday = 0, nextAlarmMinutes, estComplete, daysElapsed = 1 } = campaign;
  const pct = total > 0 ? Math.round((sent / total) * 100) : 0;
  const isPaused = status === 'paused';
  const isActive = status === 'active';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 580, background: '#1a1a2e', padding: '24px 20px' }}>
      {/* Status header */}
      <div style={{ textAlign: 'center', marginBottom: 24 }}>
        <div style={{ fontSize: 13, color: isPaused ? '#f59e0b' : '#34d399', fontWeight: 600, marginBottom: 4 }}>
          {isPaused ? '🟡 Paused' : '🟢 Inviting in Progress'}
        </div>
        <h2 style={{ fontSize: 20, fontWeight: 700, color: '#f1f5f9' }}>
          {sent} <span style={{ color: '#64748b', fontSize: 14, fontWeight: 400 }}>of</span> {total} sent
        </h2>
      </div>

      {/* Progress bar */}
      <div style={{ background: '#0f0f23', borderRadius: 8, height: 10, marginBottom: 8, overflow: 'hidden' }}>
        <div style={{
          height: '100%',
          background: isPaused ? 'linear-gradient(90deg, #f59e0b, #fbbf24)' : 'linear-gradient(90deg, #3b82f6, #60a5fa)',
          borderRadius: 8,
          width: `${pct}%`,
          transition: 'width 1s ease'
        }} />
      </div>
      <p style={{ textAlign: 'right', fontSize: 11, color: '#64748b', marginBottom: 24 }}>{pct}%</p>

      {/* Stats grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 24 }}>
        <StatCard label="Today" value={`${sentToday}/10 sent`} />
        <StatCard
          label="Next send"
          value={isPaused ? 'Paused' : (nextAlarmMinutes != null ? `~${nextAlarmMinutes}m` : 'Scheduling...')}
        />
        <StatCard label="Est. complete" value={estComplete || 'Calculating...'} />
        <StatCard label="Days running" value={`${daysElapsed} day${daysElapsed !== 1 ? 's' : ''}`} />
      </div>

      {/* Warning banner — only show when actively sending (not paused) */}
      {isActive && (
        <div className="warn-blink" style={{
          background: '#1a0f00',
          border: '1px solid #92400e',
          borderRadius: 8,
          padding: '10px 14px',
          marginBottom: 20,
          display: 'flex',
          alignItems: 'center',
          gap: 8
        }}>
          <span style={{ fontSize: 16 }}>⚠️</span>
          <p style={{ fontSize: 12, color: '#fbbf24', lineHeight: 1.4 }}>
            Sending in progress — avoid using Messenger right now
          </p>
        </div>
      )}

      <div style={{ flex: 1 }} />

      {/* Action buttons */}
      <div style={{ display: 'flex', gap: 10 }}>
        <button
          onClick={isPaused ? onResume : onPause}
          style={{
            flex: 1,
            padding: '12px',
            background: isPaused ? '#166534' : '#92400e',
            color: 'white',
            border: 'none',
            borderRadius: 8,
            fontSize: 13,
            fontWeight: 600,
            cursor: 'pointer'
          }}
        >
          {isPaused ? '▶ Resume' : '⏸ Pause'}
        </button>
        <button
          onClick={onCancel}
          style={{
            flex: 1,
            padding: '12px',
            background: '#1e1e38',
            color: '#ef4444',
            border: '1px solid #3a1a1a',
            borderRadius: 8,
            fontSize: 13,
            fontWeight: 600,
            cursor: 'pointer'
          }}
        >
          ✕ Cancel
        </button>
      </div>
    </div>
  );
}

function StatCard({ label, value }) {
  return (
    <div style={{
      background: '#0f0f23',
      border: '1px solid #2a2a4a',
      borderRadius: 8,
      padding: '10px 14px'
    }}>
      <p style={{ fontSize: 11, color: '#475569', marginBottom: 4 }}>{label}</p>
      <p style={{ fontSize: 14, fontWeight: 600, color: '#e2e8f0' }}>{value}</p>
    </div>
  );
}

// ─── Screen: Complete ─────────────────────────────────────────────────────────

function CompleteScreen({ campaign, onNewCampaign }) {
  const sent = campaign?.sent || 0;
  const daysElapsed = campaign?.daysElapsed || 1;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 580, background: '#1a1a2e', padding: '32px 24px', textAlign: 'center' }}>
      <div style={{ fontSize: 64, marginBottom: 16 }}>🎉</div>
      <h1 style={{ fontSize: 22, fontWeight: 700, color: '#f1f5f9', marginBottom: 8 }}>
        Launch Complete!
      </h1>
      <p style={{ fontSize: 14, color: '#94a3b8', marginBottom: 8 }}>
        <span style={{ color: '#60a5fa', fontWeight: 600 }}>{sent} invitations</span> sent over {daysElapsed} day{daysElapsed !== 1 ? 's' : ''}
      </p>

      <div style={{
        background: '#0f0f23',
        border: '1px solid #2a2a4a',
        borderRadius: 12,
        padding: '20px',
        marginTop: 24,
        marginBottom: 32,
        width: '100%'
      }}>
        <p style={{ fontSize: 14, color: '#94a3b8', lineHeight: 1.6 }}>
          💬 Check your Messenger inbox — people are responding!
        </p>
      </div>

      <button
        onClick={onNewCampaign}
        style={{
          width: '100%',
          padding: '14px',
          background: '#3b82f6',
          color: 'white',
          border: 'none',
          borderRadius: 10,
          fontSize: 14,
          fontWeight: 600,
          cursor: 'pointer'
        }}
      >
        Start a New Campaign
      </button>
    </div>
  );
}

// ─── Small button style helper ────────────────────────────────────────────────

function btnStyleSmall(bg, color) {
  return {
    padding: '6px 12px',
    background: bg,
    color,
    border: 'none',
    borderRadius: 6,
    fontSize: 12,
    fontWeight: 500,
    cursor: 'pointer'
  };
}

// ─── Mount ────────────────────────────────────────────────────────────────────

const root = createRoot(document.getElementById('root'));
root.render(<App />);
