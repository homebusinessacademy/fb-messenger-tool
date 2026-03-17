# Fast Start Inviter — Simplified Changes (March 11, 2026)

## Three Changes

### 1. Remove Error Display (Extension Only)
No API change needed. Just remove error display from popup.

### 2. 1-Year Cooldown (API — One Line Change)
### 3. Just-in-Time Dedup Check (Extension Only)

---

## API Change (HBA App)

**File:** `server/routes/fast-start-invites.ts`

**Find this section** in the `/invites/check` endpoint (around line 85-95):

```typescript
const records = await db
  .select()
  .from(fastStartInvites)
  .where(inArray(fastStartInvites.facebookId, facebookIds));
```

**Replace with:**

```typescript
const oneYearAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);

const records = await db
  .select()
  .from(fastStartInvites)
  .where(and(
    inArray(fastStartInvites.facebookId, facebookIds),
    gt(fastStartInvites.lastInvitedAt, oneYearAgo)
  ));
```

**Also add `gt` to the imports at the top:**

```typescript
import { inArray, eq, and, gt } from 'drizzle-orm';
```

That's it for the API. No new columns, no new endpoints, no migration.

---

## Extension Changes

### Change 1: Remove Error Display

**File:** `popup/popup.jsx` (or wherever the popup renders)

Find and DELETE any code that displays `lastSendError`:

```jsx
// DELETE THIS (or similar):
{lastSendError && (
  <div className="error-banner">
    ⚠️ Error: {lastSendError.error}
  </div>
)}
```

Also in the service worker, remove the line that stores the error:

**File:** `background/service-worker.js`

In the `sendToFriend` catch block, DELETE this line:
```javascript
await setStorage({ lastSendError: { name: friend.name, error: err.message, at: now } });
```

---

### Change 2: Just-in-Time Check Before Each Send

**File:** `background/service-worker.js`

In the `sendToFriend` function, add this check **at the very beginning** (right after getting the friend object):

```javascript
async function sendToFriend(friendId, campaign) {
  const { friends = [] } = await getStorage(['friends']);
  const friend = friends.find(f => f.id === friendId);
  if (!friend) {
    console.warn(`[FSI] Friend not found: ${friendId}`);
    return false;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // NEW: Just-in-time check — skip if already invited by another member
  // ═══════════════════════════════════════════════════════════════════════
  const checkResult = await bulkCheckInvites([friendId]);
  if (checkResult[friendId]) {
    console.log(`[FSI] Skipping ${friend.name} — already invited on ${checkResult[friendId]}`);
    campaign.sendRecords[friendId] = {
      status: 'skipped',
      messageVariation: null,
      scheduledAt: new Date().toISOString(),
      sentAt: null,
      error: 'Already invited by another HBA member'
    };
    await setStorage({ campaign });
    return false; // Skip this friend, move to next
  }
  // ═══════════════════════════════════════════════════════════════════════

  // ... rest of existing code continues below ...
```

---

### Change 3: Update Status Display (Optional)

In `getStatus()`, add a count of skipped friends so the UI can show it:

```javascript
const skipped = Object.values(campaign.sendRecords || {}).filter(r => r.status === 'skipped').length;

return {
  campaign: {
    ...campaign,
    sent,
    total,
    failed,
    skipped,  // NEW
    // ... rest of fields
  }
};
```

---

## Testing Checklist

- [ ] Friend invited 11 months ago → shows "Invited [date]" badge, not selectable
- [ ] Friend invited 13 months ago → shows as available (no badge)
- [ ] Friend invited by another member mid-campaign → silently skipped
- [ ] No error banner shown when friend's messages are disabled
- [ ] Campaign continues normally after any skip

---

## Deployment Order

1. **Deploy API change** (one line + import)
2. **Update extension** (remove error display + add just-in-time check)
3. **Redistribute extension** to members

