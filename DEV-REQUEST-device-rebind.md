# Dev Request: Fast Start Inviter — Device Re-bind Grace Period

## Endpoint
`POST /api/fast-start/auth`

## Problem
When a member installs the Fast Start Inviter extension and enters their email, their email gets bound to that device ID. If they then open the extension on a different browser/device (or reinstall), they get blocked with "already registered on another device" even though it's legitimately their first real use.

## Requested Change

In the `/api/fast-start/auth` handler, update the `device_mismatch` logic:

**Current behavior:**
```
If email exists in fast_start_devices with a different device_id → return device_mismatch error
```

**New behavior:**
```
If email exists in fast_start_devices with a different device_id:
  - Check created_at timestamp
  - If created_at is LESS than 24 hours ago → allow re-bind (update device_id and token, return success)
  - If created_at is MORE than 24 hours ago → return device_mismatch error (existing behavior)
```

## Pseudocode
```
existing = SELECT * FROM fast_start_devices WHERE email = $email

if existing:
  if existing.device_id == $device_id:
    # Same device, just return their token
    return { success: true, token: existing.token }
  else:
    age_hours = (now - existing.created_at) / 3600
    if age_hours < 24:
      # Grace period — allow re-bind with new device
      new_token = generate_fst_token()
      UPDATE fast_start_devices SET device_id = $device_id, token = new_token, created_at = now() WHERE email = $email
      return { success: true, token: new_token }
    else:
      # Locked to original device
      return { error: 'device_mismatch' }
else:
  # First time — create binding
  new_token = generate_fst_token()
  INSERT INTO fast_start_devices (email, device_id, token, created_at) VALUES (...)
  return { success: true, token: new_token }
```

## Why 24 hours?
Members are installing for the first time and may open the extension on multiple browsers/devices before settling on one. 24 hours gives them enough time to get set up without being locked out on first use.

## Table Reference
`fast_start_devices`: email (PK), device_id, token, created_at
