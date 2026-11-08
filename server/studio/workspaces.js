import { Router } from 'express'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'

const control = '__workspace_control__'
const roles = z.enum(['owner', 'editor', 'reviewer', 'viewer'])
const workspaceId = z.string().regex(/^ws:[0-9a-f-]{36}$/)
const userId = z.string().trim().min(1).max(200).refine(value => !/[\u0000-\u001f/\\]/.test(value))
const revision = z.number().int().positive()
const fail = (status, message) => Object.assign(new Error(message), { status, publicMessage: message })
const member = (workspace, uid) => workspace?.members.find(value => value.uid === uid)
const pending = invite => invite.status === 'pending' && Date.parse(invite.expiresAt) > Date.now()
const read = (repository, id) => repository.studioGet(control, 'workspace', id)

export const ownerScope = req => req.workspace?.id || req.identity.uid
export const requireWorkspaceRole = (...allowed) => (req, _res, next) => allowed.includes(req.workspace?.role) ? next() : next(fail(403, 'Your workspace role cannot perform this action'))
export const requireWriteRole = (req, res, next) => ['GET', 'HEAD'].includes(req.method) ? next() : requireWorkspaceRole('owner', 'editor')(req, res, next)
export async function workspaceRole(repository, scopeId, actorUid) {
  if (!scopeId.startsWith('ws:')) return scopeId === actorUid ? 'owner' : null
  return member(await read(repository, scopeId), actorUid)?.role || null
}

export function workspaceAuth(repository, auth) {
  return [auth, async (req, res, next) => {
    try {
      req.actor = req.identity
      if (req.headers['x-actor-id'] && req.headers['x-actor-id'] !== req.identity?.uid) throw fail(409, 'Account changed. Reload before continuing.')
      if (!req.identity?.uid || req.identity.uid.startsWith('ws:') || req.identity.uid === control) throw fail(403, 'Account identifier conflicts with a reserved workspace namespace')
      const id = req.headers['x-workspace-id']
      if (!id || id === 'personal') req.workspace = { id: req.identity.uid, role: 'owner', personal: true }
      else {
        if (!workspaceId.safeParse(id).success) throw fail(403, 'Workspace access denied')
        const workspace = await read(repository, id)
        const membership = member(workspace, req.identity.uid)
        if (!membership) throw fail(403, 'Workspace membership is missing or revoked')
        req.workspace = { id, role: membership.role, personal: false }
      }
      res.setHeader('Cache-Control', 'no-store')
      next()
    } catch (error) { next(error) }
  }]
}

export function workspaceRouter({ repository, auth }) {
  const router = Router()
  router.use(auth, (req, res, next) => {
    if (req.headers['x-actor-id'] && req.headers['x-actor-id'] !== req.identity?.uid) return next(fail(409, 'Account changed. Reload before continuing.'))
    res.setHeader('Cache-Control', 'no-store'); next()
  })
  const link = (uid, id) => repository.studioPut(uid, 'workspace_link', id, { workspaceId: id })
  async function change(id, action) {
    workspaceId.parse(id)
    const lease = `workspace:${id}`; const owner = randomUUID()
    if (!await repository.acquireLease(lease, owner, 30000)) throw fail(409, 'Workspace is being updated. Reload and retry.')
    try {
      const current = await read(repository, id)
      if (!current) throw fail(404, 'Workspace not found')
      return await action(current)
    } finally { await repository.releaseLease(lease, owner) }
  }
  function requireOwner(current, req, expectedRevision) {
    if (member(current, req.identity.uid)?.role !== 'owner') throw fail(403, 'Workspace owner access required')
    if (expectedRevision !== undefined && current.revision !== expectedRevision) throw fail(409, 'Workspace changed. Reload before updating.')
  }
  const save = (current, patch) => repository.studioPut(control, 'workspace', current.id, { ...current, ...patch }, current.revision)
  const verified = req => { if (!req.identity.emailVerified) throw fail(403, 'Verify your account before creating or joining a shared workspace') }
  router.get('/', async (req, res) => {
    const workspaces = [{ id: 'personal', name: 'Personal workspace', role: 'owner', revision: 0 }]
    for (const item of await repository.studioList(req.identity.uid, 'workspace_link')) {
      const workspace = await read(repository, item.workspaceId)
      const membership = member(workspace, req.identity.uid)
      if (membership) workspaces.push({ id: workspace.id, name: workspace.name, role: membership.role, revision: workspace.revision })
    }
    const invitations = []
    for (const item of await repository.studioList(req.identity.uid, 'workspace_invitation')) {
      const workspace = await read(repository, item.workspaceId)
      const invitation = workspace?.invitations.find(value => value.id === item.id && value.targetUid === req.identity.uid && pending(value))
      if (invitation) invitations.push({ ...invitation, workspaceId: workspace.id, workspaceName: workspace.name })
    }
    res.json({ workspaces, invitations })
  })
  router.post('/', async (req, res) => {
    verified(req)
    const input = z.object({ name: z.string().trim().min(2).max(100), requestId: z.string().uuid() }).strict().parse(req.body)
    const id = `ws:${input.requestId}`
    const existing = await read(repository, id)
    if (existing) {
      if (existing.createdBy !== req.identity.uid || existing.name !== input.name) throw fail(409, 'Workspace request identifier is already used')
      requireOwner(existing, req)
      await link(req.identity.uid, id)
      return res.json(existing)
    }
    const workspace = await repository.studioPut(control, 'workspace', id, { name: input.name, createdBy: req.identity.uid, members: [{ uid: req.identity.uid, role: 'owner' }], invitations: [] }, 0)
    await link(req.identity.uid, id)
    res.status(201).json(workspace)
  })
  router.get('/:id', async (req, res) => {
    workspaceId.parse(req.params.id)
    const workspace = await read(repository, req.params.id)
    const membership = member(workspace, req.identity.uid)
    if (!membership) throw fail(403, 'Workspace access denied')
    res.json(membership.role === 'owner' ? workspace : { id: workspace.id, name: workspace.name, role: membership.role, revision: workspace.revision })
  })
  router.post('/:id/invitations', async (req, res) => {
    const input = z.object({ targetUid: userId, role: roles, expiresInHours: z.number().int().min(1).max(168).default(24), revision }).strict().parse(req.body)
    const result = await change(req.params.id, async current => {
      requireOwner(current, req, input.revision)
      if (member(current, input.targetUid)) throw fail(409, 'This account is already a member')
      const active = current.invitations.filter(pending)
      if (active.some(invite => invite.targetUid === input.targetUid)) throw fail(409, 'This account already has a pending invitation')
      if (active.length >= 50 || current.members.length >= 100) throw fail(422, 'Workspace member or invitation limit reached')
      const invitation = { id: randomUUID(), targetUid: input.targetUid, role: input.role, status: 'pending', expiresAt: new Date(Date.now() + input.expiresInHours * 3600000).toISOString(), invitedBy: req.identity.uid }
      // Index first: an interrupted write may leave an inert inbox entry, never a grant.
      await repository.studioPut(input.targetUid, 'workspace_invitation', invitation.id, { workspaceId: current.id }, 0)
      await save(current, { invitations: [...active, invitation] })
      return invitation
    })
    res.status(201).json(result)
  })
  router.post('/:id/invitations/:inviteId/accept', async (req, res) => {
    verified(req)
    const workspace = await change(req.params.id, async current => {
      const invitation = current.invitations.find(value => value.id === req.params.inviteId && value.targetUid === req.identity.uid)
      if (!invitation || !pending(invitation)) throw fail(403, 'Invitation is unavailable, expired or revoked')
      if (member(current, req.identity.uid)) throw fail(409, 'This account is already a member')
      if (current.members.length >= 100) throw fail(422, 'Workspace member limit reached')
      await link(req.identity.uid, current.id)
      return save(current, { members: [...current.members, { uid: req.identity.uid, role: invitation.role }], invitations: current.invitations.map(value => value.id === invitation.id ? { ...value, status: 'accepted' } : value) })
    })
    const membership = member(workspace, req.identity.uid)
    res.json({ id: workspace.id, name: workspace.name, role: membership.role, revision: workspace.revision })
  })
  router.delete('/:id/invitations/:inviteId', async (req, res) => {
    const input = z.object({ revision }).strict().parse(req.body)
    await change(req.params.id, async current => {
      requireOwner(current, req, input.revision)
      const invite = current.invitations.find(value => value.id === req.params.inviteId)
      if (!invite || invite.status !== 'pending') throw fail(404, 'Pending invitation not found')
      return save(current, { invitations: current.invitations.map(value => value.id === invite.id ? { ...value, status: 'revoked' } : value) })
    })
    res.json({ revoked: true })
  })
  async function membershipChange(req, remove) {
    const input = (remove ? z.object({ revision }) : z.object({ revision, role: roles })).strict().parse(req.body)
    userId.parse(req.params.uid)
    return change(req.params.id, async current => {
      requireOwner(current, req, input.revision)
      const target = member(current, req.params.uid)
      if (!target) throw fail(404, 'Member not found')
      if (target.role === 'owner' && (remove || input.role !== 'owner') && current.members.filter(value => value.role === 'owner').length === 1) throw fail(409, 'A workspace must retain at least one owner')
      return save(current, { members: remove ? current.members.filter(value => value.uid !== target.uid) : current.members.map(value => value.uid === target.uid ? { ...value, role: input.role } : value) })
    })
  }
  router.patch('/:id/members/:uid', async (req, res) => { const workspace = await membershipChange(req, false); res.json({ id: workspace.id, revision: workspace.revision }) })
  router.delete('/:id/members/:uid', async (req, res) => { const workspace = await membershipChange(req, true); res.json({ id: workspace.id, revision: workspace.revision }) })
  router.use((error, _req, res, next) => {
    if (error instanceof z.ZodError) return res.status(400).json({ error: 'Invalid workspace request' })
    if (error.code === 'STUDIO_CONFLICT') return res.status(409).json({ error: 'Workspace changed. Reload before updating.' })
    if (error.publicMessage) return res.status(error.status).json({ error: error.publicMessage })
    next(error)
  })
  return router
}
