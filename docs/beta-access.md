# JUVO Private Beta Tester Access

## Enable on the backend

Add to `server/.env`:

```
BETA_ACCESS_MODE=true
BETA_CODE_PEPPER=<long-random-secret>
```

`BETA_CODE_PEPPER` is used when hashing tester codes. If omitted, `JWT_SECRET` is used.

Restart the API after changing these values.

Set `BETA_ACCESS_MODE=false` (or remove it) to restore normal authentication. Existing tester records remain intact.

## Promote an administrator

Admins bypass the private beta gate via the `role` field (not hardcoded emails):

```bash
npm run beta:admin:promote -- --email you@example.com
```

## Generate tester codes

Plaintext codes are printed **once**. Only hashes are stored.

```bash
# 10 single-use codes that expire in 7 days if unused
npm run beta:codes:create -- --count 10 --expires-in-days 7

# Bind a code to one email
npm run beta:codes:create -- --count 1 --email tester@example.com --note "Pilot cohort"

# Multi-redemption (rare)
npm run beta:codes:create -- --count 1 --max-redemptions 5
```

Format: `JUVO-TEST-XXXX-XXXX-XXXX`

## List and revoke

```bash
npm run beta:codes:list
npm run beta:codes:revoke -- --id <mongoObjectId> --reason "compromised"
```

## 24-hour access window

- Starts at successful redemption (`activatedAt`).
- Ends at `expiresAt = activatedAt + 24h` (UTC).
- Logout, login, refresh, and device switches do **not** reset the window.
- Redeeming another code does **not** extend an already activated or expired tester.
- Backend middleware re-checks expiration on every authenticated request.
- JWTs for active testers expire no later than the remaining window.

## Manual test checklist

1. `BETA_ACCESS_MODE=true`
2. Generate a code and register with it.
3. Confirm dashboard access and the remaining-time chip.
4. Log out and back in without a code — still works while active.
5. Attempt a second code after activation — rejected.
6. Call a protected API with an expired tester — `403 BETA_ACCESS_EXPIRED`.
7. Promote an admin and confirm access without a tester code.
8. Set `BETA_ACCESS_MODE=false` and confirm normal auth works.
9. Confirm waitlist invitation / billing discount codes still work independently.
