# Internal login

Only email/password sign-in is public. Account creation, password replacement, role changes and session release are backend operations. Firebase/Google/Hexclave tokens no longer grant portal access. There is no signup or password-reset endpoint.

Passwords are salted with 16 random bytes and hashed with Node scrypt (N=32768,r=8,p=3). Only the hash is stored in the database. Session cookies are HttpOnly, Secure in production, SameSite=Strict and host-only. Only the SHA-256 digest of the random session token is stored. Mutation requests require the same-origin custom header; no credentialed CORS is enabled.

One active browser session is allowed per user; tabs in that browser share it. A second browser receives 409 after password verification. The database serializes competing claims across server instances. Sessions expire after 12 hours or 30 minutes without a request. Sign out before switching browsers; closing a browser alone does not immediately release the session. Password replacement revokes the session. No device fingerprinting is used.

## Backend operations

Use Node 24 and the existing backend environment (STORAGE_PROVIDER plus database settings). Never put passwords or service-role keys in browser code, command arguments or source control. Output credentials to a private file outside the checkout and apply a current-user-only ACL on Windows.

Create an account:

```text
npm run user:manage -- provision new person@example.com "Person Name" user /private/new-login.json
```

Replace a password or migrate an existing account: use its exact existing UID instead of `new`, with its current email/name/role. This preserves content ownership. Each invocation generates a new random password, writes it to a new private file and stores only its salted hash. If the database operation fails, the output file does not prove that the password is active; retry using a new output filename.

Release a stuck session without changing the password:

```text
npm run user:manage -- revoke EXISTING_UID
```

Direct SQL administrators can set `disabled=true` and clear session fields in `signal_internal_accounts` to disable an account. Passwords must always go through the hash helper, never plaintext SQL. The tables and RPC deny PUBLIC, anon and authenticated access; only the backend service role can use them. Preserve existing service-role-key restrictions.

Login attempts are limited persistently per normalized email (10/15 minutes) and per IP (60/15 minutes), in addition to the existing HTTP limits. An administrator can remove the specific hashed attempt key from `signal_login_attempts` if needed. No account-management controls are exposed in the portal.

Deploy the additive migration first, provision existing accounts with their original UIDs, then release the application. Existing external-provider sessions must sign in again. Do not delete old identity-provider accounts or their project credentials if other applications may depend on them; this portal no longer accepts those identities.
