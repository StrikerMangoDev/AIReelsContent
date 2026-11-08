# Workspace authorization contract

Local implementation; no production migration or deployment was performed.

`workspaceAuth(repository, auth)` verifies identity first, preserves `req.identity.uid`, copies that identity to `req.actor`, and attaches `{id, role, personal}` as `req.workspace`. An absent `X-Workspace-Id` or `personal` uses the existing user UID as the storage owner. Shared scope uses `ws:<uuid>` and requires current membership on every request. A header containing another personal UID is rejected. `ownerScope(req)` is the storage owner; it is never the acting user's identity for audit or independent-review checks.

`requireWriteRole` permits GET/HEAD for members and mutation only for owner/editor. Assigned-review routes use their own exact-recipient and independent-contributor checks plus `workspaceRole(repository, scopeId, actorUid)`; viewer roles cannot review. Owner role does not bypass independent review. Existing personal records are not moved.

The `/api/studio/workspaces` router is mounted before selected-workspace authorization, so an expired/revoked active selection cannot prevent access to membership management or switching back to personal scope.

| Method/path relative to `/workspaces` | Contract |
|---|---|
| GET `/` | Current memberships plus unexpired invitations addressed to the authenticated UID; includes personal scope. |
| POST `/` | `{name, requestId: UUID}`; verified account creates owner membership. Same request/name is idempotent while requester remains owner. |
| GET `/:id` | Members see name/current role; owners also see members/invitations. |
| POST `/:id/invitations` | Owner supplies `{targetUid, role, revision, expiresInHours?}`; default 24 hours, maximum 168. |
| POST `/:id/invitations/:inviteId/accept` | Only the exact authenticated, verified target UID can accept an unexpired pending invitation. |
| DELETE `/:id/invitations/:inviteId` | Owner supplies `{revision}` to revoke a pending invitation. Accepted membership is revoked via member removal. |
| PATCH `/:id/members/:uid` | Owner supplies `{role, revision}`. |
| DELETE `/:id/members/:uid` | Owner supplies `{revision}`. Last owner cannot be removed or demoted. |

Roles are owner/editor/reviewer/viewer. Invitations send no email or message, never match on email, and never grant access before acceptance. Current limits are 100 members and 50 pending invitations per workspace. Expired/revoked invitation metadata remains in record revision history where retained by the existing storage implementation.

Authoritative metadata uses the server-only `__workspace_control__` owner and `workspace` record kind. Per-user `workspace_link` and `workspace_invitation` records are discovery indices only: stale/incomplete indices cannot grant access. Updates acquire a per-workspace lease, read current membership/revision, then use compare-and-swap storage writes. All supported database access remains server-mediated; browser database roles do not receive control-record access.

Client selection uses `workspace-session.ts`, scoped to the verified current UID through `studio-workspace:<uid>`. `studioRequest` attaches the selection; the application remounts workspace content when actor or selected scope changes. WorkspacesPage falls back to personal when a selected membership disappears. This local selection never establishes authority.

Tests cover personal compatibility, header spoofing, role changes/revocation, invitation target/verification/expiry/revoke checks, last-owner protection, author-contribution laundering, revoked-reviewer exports and shared/personal isolation. Actual hosted identity sessions, deployed RLS and multi-process load remain separate verification gates.
