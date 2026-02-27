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

// ─── Date Helpers ─────────────────────────────────────────────────────────────

function isInvitedWithin90Days(invitedDate) {
  if (!invitedDate) return false;
  const invited = new Date(invitedDate);
  const now = new Date();
  const diffDays = (now - invited) / (1000 * 60 * 60 * 24);
  return diffDays < 90;
}

// ─── HBA Membership Matching ──────────────────────────────────────────────────
// Robust match with suffix stripping and flexible last name matching

const NAME_SUFFIXES = new Set(['jr', 'jr.', 'sr', 'sr.', 'ii', 'iii', 'iv', 'v', '2nd', '3rd', '4th', 'esq', 'phd', 'md']);

function stripSuffixes(parts) {
  // Remove common name suffixes from the end
  while (parts.length > 1 && NAME_SUFFIXES.has(parts[parts.length - 1])) {
    parts = parts.slice(0, -1);
  }
  return parts;
}

function isHbaMember(memberSet, fullName) {
  if (!fullName || memberSet.size === 0) return false;
  const nameLower = fullName.toLowerCase().trim();

  // 1. Exact full name match
  if (memberSet.has(nameLower)) return true;

  // 2. Parse and clean the Facebook name
  let fbParts = nameLower.split(/\s+/).filter(Boolean);
  fbParts = stripSuffixes(fbParts);
  
  if (fbParts.length < 2) return false;
  
  const fbFirst = fbParts[0];
  const fbLast = fbParts[fbParts.length - 1];

  // 3. First + last only match
  const firstLast = `${fbFirst} ${fbLast}`;
  if (memberSet.has(firstLast)) return true;

  // 4. Check against each HBA member with flexible matching
  for (const member of memberSet) {
    let mParts = member.split(/\s+/).filter(Boolean);
    mParts = stripSuffixes(mParts);
    
    if (mParts.length < 2) continue;
    
    const mFirst = mParts[0];
    const mLast = mParts[mParts.length - 1];
    
    // First names must match, last names must match (after stripping suffixes)
    if (mFirst === fbFirst && mLast === fbLast) return true;
    
    // Also check if FB last name appears anywhere in HBA name (handles middle names as last names)
    if (mFirst === fbFirst && mParts.includes(fbLast)) return true;
    
    // And vice versa - if HBA last name appears anywhere in FB name
    if (mFirst === fbFirst && fbParts.includes(mLast)) return true;
  }

  return false;
}

// ─── App Component ────────────────────────────────────────────────────────────

function App() {
  // State machine: login | welcome | loading | review | campaign | complete
  const [screen, setScreen] = useState('login');
  const [memberEmail, setMemberEmail] = useState('');
  const [loginError, setLoginError] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);
  const [friends, setFriends] = useState([]);
  const [hbaMembers, setHbaMembers] = useState(new Set());
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [loadProgress, setLoadProgress] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [showAllMessages, setShowAllMessages] = useState(false);
  const [campaignData, setCampaignData] = useState(null);
  const [lastSendError, setLastSendError] = useState(null);
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
    const data = await getFromStorage(['friends', 'hbaMembers', 'campaign', 'scrapeStatus', 'scrapeProgress', 'memberEmail', 'authToken']);
    
    // Clear the badge when popup opens (user has seen the notification)
    sendToSW('CLEAR_BADGE').catch(() => {});

    // Check if user is logged in (has auth token)
    if (!data.authToken || !data.memberEmail) {
      setScreen('login');
      return;
    }
    setMemberEmail(data.memberEmail);

    // Resume scrape progress display if SW is mid-scrape
    if (data.scrapeStatus === 'running') {
      setScreen('loading');
      setLoadProgress(data.scrapeProgress || 0);
      startScrapePoller();
      return;
    }

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

      // Pre-select non-HBA members who haven't been invited in the last 90 days
      const eligible = new Set(friendsWithHba.filter(f => 
        !f.hbaMember && !isInvitedWithin90Days(f.invitedDate)
      ).map(f => f.id));
      setSelectedIds(eligible);
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
      if (status?.lastSendError) setLastSendError(status.lastSendError);
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

  // Poll storage until SW scrape completes
  function startScrapePoller() {
    const poll = setInterval(async () => {
      try {
        const data = await getFromStorage(['scrapeProgress', 'scrapeStatus', 'scrapeError', 'friends', 'hbaMembers', 'hasSeenIntro']);
        if (data.scrapeProgress) setLoadProgress(data.scrapeProgress);

        if (data.scrapeStatus === 'done') {
          clearInterval(poll);
          const memberSet = new Set(data.hbaMembers || []);
          const friendsWithHba = (data.friends || []).map(f => ({ ...f, hbaMember: isHbaMember(memberSet, f.name) }));
          setFriends(friendsWithHba);
          setHbaMembers(memberSet);
          const eligible = new Set(friendsWithHba.filter(f => 
            !f.hbaMember && !isInvitedWithin90Days(f.invitedDate)
          ).map(f => f.id));
          setSelectedIds(eligible);
          setScreen(data.hasSeenIntro ? 'review' : 'intro');
        }

        if (data.scrapeStatus === 'error') {
          clearInterval(poll);
          alert(`Failed to load friends: ${data.scrapeError}\n\nMake sure you're logged into Facebook and try again.`);
          setScreen('welcome');
        }
      } catch (e) { console.warn('Scrape poll error:', e); }
    }, 800);
  }

  async function handleLogin(email) {
    setLoginError('');
    setLoginLoading(true);
    try {
      const result = await sendToSW('AUTHENTICATE', { email });
      if (result?.success) {
        // Token is stored by service worker, just update UI
        setMemberEmail(email);
        setScreen('welcome');
      } else if (result?.error === 'device_mismatch') {
        setLoginError('This email is already registered on another device. Contact support if you need to reset.');
      } else if (result?.error === 'not_active') {
        setLoginError('This email is not associated with an active HBA membership.');
      } else {
        setLoginError(result?.message || 'Unable to verify membership. Please try again.');
      }
    } catch (err) {
      setLoginError('Unable to connect. Please try again.');
    }
    setLoginLoading(false);
  }

  async function handleLogout() {
    await new Promise(resolve => chrome.storage.local.remove(['memberEmail', 'authToken'], resolve));
    setMemberEmail('');
    setScreen('login');
  }

  async function handleLoadFriends() {
    setScreen('loading');
    setLoadProgress(0);
    // Trigger scraping in SW — it runs independently, popup can close/reopen freely
    sendToSW('START_SCRAPE').catch(() => {});
    startScrapePoller();
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
    // Only select friends who are eligible (not HBA members, not recently invited)
    const eligible = friends.filter(f => !f.hbaMember && !isInvitedWithin90Days(f.invitedDate));
    setSelectedIds(new Set(eligible.map(f => f.id)));
  }

  function deselectAll() {
    setSelectedIds(new Set());
  }

  const filteredFriends = friends
    .filter(f => f.name.toLowerCase().includes(searchQuery.toLowerCase()))
    .sort((a, b) => {
      // Eligible friends first, disabled (HBA or recently invited) at bottom
      const aDisabled = a.hbaMember || isInvitedWithin90Days(a.invitedDate);
      const bDisabled = b.hbaMember || isInvitedWithin90Days(b.invitedDate);
      if (aDisabled && !bDisabled) return 1;  // a goes after b
      if (!aDisabled && bDisabled) return -1; // a goes before b
      return 0; // keep original order
    });

  const hbaCount = friends.filter(f => f.hbaMember).length;
  const estDays = selectedIds.size > 0 ? Math.ceil(selectedIds.size / 8) : 0;

  // ─── Render Screens ────────────────────────────────────────────────────────

  if (screen === 'login') return <LoginScreen onLogin={handleLogin} error={loginError} loading={loginLoading} />;

  if (screen === 'welcome') return <WelcomeScreen onLoad={handleLoadFriends} />;

  if (screen === 'loading') return <LoadingScreen count={loadProgress} />;

  async function handleIntroComplete() {
    await chrome.storage.local.set({ hasSeenIntro: true });
    setScreen('review');
  }

  if (screen === 'intro') return <IntroScreen onContinue={handleIntroComplete} />;

  async function handleReloadFriends() {
    await chrome.storage.local.remove(['friends', 'hbaMembers', 'scrapeStatus', 'scrapeProgress', 'scrapeError']);
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
      lastSendError={lastSendError}
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

// ─── Screen: Login ───────────────────────────────────────────────────────────

function LoginScreen({ onLogin, error, loading }) {
  const [email, setEmail] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    if (email.trim()) {
      onLogin(email.trim().toLowerCase());
    }
  };

  return (
    <div className="flex flex-col items-center justify-center h-full" style={{ minHeight: 580, background: '#1a1a2e', padding: '32px 24px' }}>
      <div style={{ fontSize: 56, marginBottom: 16 }}>🔐</div>
      <h1 style={{ fontSize: 22, fontWeight: 700, color: '#f1f5f9', textAlign: 'center', marginBottom: 8 }}>
        Members Only
      </h1>
      <p style={{ fontSize: 14, color: '#94a3b8', textAlign: 'center', marginBottom: 24 }}>
        Enter your HBA email to get started
      </p>

      <form onSubmit={handleSubmit} style={{ width: '100%', maxWidth: 280 }}>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="your@email.com"
          disabled={loading}
          style={{
            width: '100%',
            padding: '12px 16px',
            fontSize: 14,
            background: '#0f0f23',
            border: '1px solid #2a2a4a',
            borderRadius: 8,
            color: '#f1f5f9',
            marginBottom: 12,
            outline: 'none'
          }}
        />
        
        {error && (
          <div style={{
            background: 'rgba(239, 68, 68, 0.1)',
            border: '1px solid rgba(239, 68, 68, 0.3)',
            borderRadius: 8,
            padding: '10px 12px',
            marginBottom: 12
          }}>
            <p style={{ fontSize: 12, color: '#f87171', margin: 0 }}>{error}</p>
          </div>
        )}

        <button
          type="submit"
          disabled={loading || !email.trim()}
          style={{
            width: '100%',
            padding: '12px 24px',
            fontSize: 15,
            fontWeight: 600,
            background: loading ? '#4a4a6a' : 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
            color: 'white',
            border: 'none',
            borderRadius: 8,
            cursor: loading ? 'not-allowed' : 'pointer',
            opacity: (!email.trim() || loading) ? 0.6 : 1
          }}
        >
          {loading ? 'Verifying...' : 'Continue'}
        </button>
      </form>

      <p style={{ fontSize: 12, color: '#64748b', textAlign: 'center', marginTop: 24 }}>
        Not a member yet?{' '}
        <a href="https://thehba.app/go" target="_blank" rel="noopener noreferrer" style={{ color: '#818cf8' }}>
          Learn more →
        </a>
      </p>
    </div>
  );
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

// ─── Screen: How It Works (Intro) ────────────────────────────────────────────

function IntroScreen({ onContinue }) {
  const items = [
    { icon: '⏰', title: 'Runs automatically in the background', body: 'After you hit Start, the extension sends up to 10 invitations per day on its own — no daily action needed from you.' },
    { icon: '💻', title: 'Keep Chrome open', body: 'Chrome needs to stay open (minimized is totally fine) for messages to send. If Chrome is closed or your computer is off, it\'ll pick up the next day.' },
    { icon: '👁️', title: 'You\'ll see a tab briefly flash', body: 'When sending a message, a Facebook tab will open in the background for a few seconds then close. That\'s completely normal — it\'s the extension doing its thing.' },
    { icon: '🚫', title: 'Don\'t blast messages yourself', body: 'While the campaign is running, avoid sending a large volume of messages manually. Keep things natural so Facebook doesn\'t flag your account.' },
    { icon: '⏸️', title: 'Pause or resume anytime', body: 'Open this extension popup anytime to check progress, pause, or resume. You\'re always in control.' },
    { icon: '📅', title: 'Takes about 30 days', body: 'At 10/day it takes roughly 30 days to reach your full friends list. Set it, forget it, and let it work.' },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 580, background: '#1a1a2e', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: '20px 20px 0', flexShrink: 0 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: '#f1f5f9', marginBottom: 4 }}>
          🚀 Before You Start
        </h2>
        <p style={{ fontSize: 12, color: '#64748b', marginBottom: 0 }}>
          Read this once so your campaign runs smoothly.
        </p>
      </div>

      {/* Scrollable content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', minHeight: 0 }}>
        {items.map((item, i) => (
          <div key={i} style={{
            display: 'flex', gap: 12, marginBottom: 16,
            background: '#0f0f23', border: '1px solid #2a2a4a',
            borderRadius: 10, padding: '12px 14px'
          }}>
            <div style={{ fontSize: 22, flexShrink: 0, marginTop: 1 }}>{item.icon}</div>
            <div>
              <p style={{ fontSize: 13, fontWeight: 600, color: '#e2e8f0', marginBottom: 4 }}>{item.title}</p>
              <p style={{ fontSize: 12, color: '#94a3b8', lineHeight: 1.5 }}>{item.body}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Footer CTA */}
      <div style={{ padding: '12px 20px 16px', background: '#0f0f23', borderTop: '1px solid #2a2a4a', flexShrink: 0 }}>
        <button
          onClick={onContinue}
          style={{
            width: '100%', padding: '13px',
            background: '#3b82f6', color: 'white',
            border: 'none', borderRadius: 8,
            fontSize: 14, fontWeight: 600, cursor: 'pointer'
          }}
        >
          Got It — Show Me My Friends →
        </button>
      </div>
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
          <div style={{ marginTop: 10, borderTop: '1px solid #2a2a4a', paddingTop: 10, maxHeight: 220, overflowY: 'auto' }}>
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
  const recentlyInvited = isInvitedWithin90Days(friend.invitedDate);
  const isDisabled = friend.hbaMember || recentlyInvited;
  
  return (
    <div
      onClick={isDisabled ? undefined : onToggle}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '7px 0',
        borderBottom: '1px solid #1e1e38',
        cursor: isDisabled ? 'not-allowed' : 'pointer',
        opacity: isDisabled ? 0.5 : 1
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

      {/* Invited badge — show different message if within 90 days */}
      {friend.invitedDate && !friend.hbaMember && (
        <span style={{
          fontSize: 10, 
          color: recentlyInvited ? '#f87171' : '#fbbf24', 
          background: recentlyInvited ? '#1c0a0a' : '#1c1a0e',
          border: `1px solid ${recentlyInvited ? '#7f1d1d' : '#854d0e'}`, 
          borderRadius: 4,
          padding: '2px 6px', flexShrink: 0
        }}>
          {recentlyInvited ? `🚫 Invited ${friend.invitedDate}` : `Invited ${friend.invitedDate}`}
        </span>
      )}

      {/* Checkbox */}
      <input
        type="checkbox"
        checked={checked}
        disabled={isDisabled}
        onChange={isDisabled ? undefined : onToggle}
        onClick={e => e.stopPropagation()}
        style={{ flexShrink: 0, cursor: isDisabled ? 'not-allowed' : 'pointer' }}
      />
    </div>
  );
}

// ─── Screen: Active Campaign ──────────────────────────────────────────────────

function CampaignScreen({ campaign, lastSendError, onPause, onResume, onCancel }) {
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

      {/* Last send error — shows if something failed */}
      {lastSendError && (
        <div style={{ background: '#1a0a0a', border: '1px solid #7f1d1d', borderRadius: 8, padding: '8px 12px', marginBottom: 10 }}>
          <p style={{ fontSize: 11, color: '#f87171', lineHeight: 1.4 }}>
            ⚠️ Last error ({lastSendError.name}): {lastSendError.error}
          </p>
        </div>
      )}

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
      <h1 style={{ fontSize: 22, fontWeight: 700, color: '#f1f5f9', marginBottom: 16 }}>
        Launch Complete!
      </h1>

      <div style={{
        background: '#0f0f23',
        border: '1px solid #2a2a4a',
        borderRadius: 12,
        padding: '20px',
        marginTop: 24,
        marginBottom: 32,
        width: '100%'
      }}>
        <p style={{ fontSize: 16, color: '#fbbf24', fontWeight: 600, marginBottom: 8 }}>
          WAHOOOO! Way to go! 🙌
        </p>
        <p style={{ fontSize: 14, color: '#94a3b8', lineHeight: 1.6 }}>
          Be sure to check your inbox and get everyone who said "Yes" your link!
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
