# Fast Start Inviter — API Specification

This document describes the backend API endpoints needed for the Fast Start Inviter Chrome extension.

---

## Overview

The Chrome extension needs two features that require backend support:

1. **Member Authentication** — Verify the user is an active HBA member before allowing access
2. **Global Invite Registry** — Track which Facebook users have been invited (and when) across all HBA members to prevent duplicate outreach

---

## Endpoint 1: Check Active Member

Verify if an email address belongs to an active HBA member (has at least one active subscription).

### Request
```
GET /api/fast-start/check-active?email={email}
```

### Response (Success)
```json
{
  "active": true
}
```

### Response (Not Active / Not Found)
```json
{
  "active": false
}
```

### Notes
- This endpoint should be public but rate-limited (e.g., 10 requests/minute per IP)
- "Active" means the user has at least one active subscription to any HBA product
- Used by the Chrome extension to gate access to members only

---

## Endpoint 2: Log an Invite

Called after the extension successfully sends an invitation to a Facebook user.

### Request
```
POST /api/fast-start/invites
Content-Type: application/json

{
  "facebookId": "john.smith.123"
}
```

The `facebookId` is the Facebook username or numeric ID extracted from the profile URL.

### Response
```json
{
  "success": true
}
```

### Behavior
- If the `facebookId` already exists in the database, update `last_invited_at` to the current timestamp
- If it doesn't exist, create a new record with the current timestamp

---

## Endpoint 3: Bulk Check Invites

Called when the extension loads a user's Facebook friends list. Checks which friends have already been invited and returns their last invite dates.

### Request
```
POST /api/fast-start/invites/check
Content-Type: application/json

{
  "facebookIds": ["john.smith.123", "jane.doe.456", "bob.wilson.789", ...]
}
```

The array may contain 500-1000+ IDs in a single request.

### Response
```json
{
  "john.smith.123": "2025-12-21",
  "jane.doe.456": "2025-06-15"
}
```

### Behavior
- Only return IDs that exist in the database (have been invited before)
- Return the date in `YYYY-MM-DD` format
- IDs not in the database should be omitted from the response (not included with null)

---

## Database Schema

### Table: `fast_start_invites`

| Column | Type | Description |
|--------|------|-------------|
| `facebook_id` | VARCHAR (primary key) | Facebook username or numeric ID |
| `last_invited_at` | TIMESTAMP | When this person was last invited |

### Index
- Primary key on `facebook_id` for fast lookups

---

## Security Considerations

1. **Rate limiting** — All endpoints should be rate-limited to prevent abuse
2. **No sensitive data** — We only store Facebook IDs and timestamps, no personal information
3. **Member-only logging** — The Chrome extension will only call the "log invite" endpoint after verifying the user is an active member (client-side check via Endpoint 1)

---

## Example Flow

1. User opens Chrome extension
2. Extension prompts for HBA email
3. Extension calls `GET /api/fast-start/check-active?email=user@example.com`
4. If `active: true`, proceed; otherwise show "Members Only" message
5. User clicks "Load My Friends"
6. Extension scrapes Facebook friends list (600+ IDs)
7. Extension calls `POST /api/fast-start/invites/check` with all friend IDs
8. Extension displays friends with "Invited {date}" badge for any matches
9. User selects friends and starts campaign
10. For each successful message send, extension calls `POST /api/fast-start/invites` with that friend's ID
