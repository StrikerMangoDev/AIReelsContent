import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Users, Plus, Copy, ShieldCheck, UserRound } from 'lucide-react'
import { useAuth } from '@/context/auth-state'
import { studioRequest } from '@/services/studio-api'
import { activeWorkspace, selectWorkspace } from '@/services/workspace-session'
import '@/styles/studio.css'
import '@/styles/workspace-settings.css'

type Role = 'owner' | 'editor' | 'reviewer' | 'viewer'
type Invitation = { id: string; targetUid: string; role: Role; status: string; expiresAt: string; workspaceId: string; workspaceName: string }
type Workspace = { id: string; name: string; role: Role; revision: number; members?: { uid: string; role: Role }[]; invitations?: Invitation[] }
const roles: Role[] = ['owner', 'editor', 'reviewer', 'viewer']
const descriptions: Record<Role, string> = { owner: 'Manage members, settings and content', editor: 'Research ideas, create and edit content', reviewer: 'Read content and review assigned drafts', viewer: 'Read saved ideas and content' }
const shortId = (value: string) => `${value.slice(0, 10)}…${value.slice(-6)}`

export function WorkspacesPage() {
  const { identity, loading } = useAuth()
  if (!identity) return <section className="studio">{loading ? <p role="status">Checking account…</p> : <Link to="/login?next=%2Fworkspaces">Sign in to manage workspaces</Link>}</section>
  return <WorkspaceManager key={identity.uid} uid={identity.uid} verified={identity.emailVerified} />
}
function WorkspaceManager({ uid, verified }: { uid: string; verified: boolean }) {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [invitations, setInvitations] = useState<Invitation[]>([])
  const [selected, setSelected] = useState(activeWorkspace)
  const [detail, setDetail] = useState<Workspace | null>(null)
  const [name, setName] = useState('')
  const [createRequestId, setCreateRequestId] = useState(() => crypto.randomUUID())
  const [targetUid, setTargetUid] = useState('')
  const [role, setRole] = useState<Role>('editor')
  const [memberRoles, setMemberRoles] = useState<Record<string, Role>>({})
  const [busy, setBusy] = useState(false)
  const [fetching, setFetching] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [reload, setReload] = useState(0)
  const [showCreate, setShowCreate] = useState(false)
  const [showInvite, setShowInvite] = useState(false)
  useEffect(() => {
    let active = true
    void studioRequest<{ workspaces: Workspace[]; invitations: Invitation[] }>('/workspaces').then(async result => {
      if (!active) return
      setWorkspaces(result.workspaces); setInvitations(result.invitations)
      if (selected !== 'personal' && result.workspaces.some(item => item.id === selected)) {
        const value = await studioRequest<Workspace>(`/workspaces/${encodeURIComponent(selected)}`)
        if (active) setDetail(value)
      } else if (selected !== 'personal') { selectWorkspace(uid, 'personal'); setSelected('personal') }
    }).catch(cause => { if (active) setError(cause instanceof Error ? cause.message : 'Could not load workspaces.') }).finally(() => { if (active) setFetching(false) })
    return () => { active = false }
  }, [selected, uid, reload])
  async function run(action: () => Promise<void>) {
    setBusy(true); setError(''); setNotice('')
    try { await action(); setFetching(true); setDetail(null); setReload(value => value + 1) } catch (cause) { setError(cause instanceof Error ? cause.message : 'Workspace update failed. Please retry.') } finally { setBusy(false) }
  }
  async function copyId(value: string) {
    try { await navigator.clipboard.writeText(value); setNotice('Account ID copied.') } catch { setError('Copy failed. Expand the account ID to copy it manually.') }
  }
  const current = workspaces.find(item => item.id === selected)
  const pending = detail?.invitations?.filter(invite => invite.status === 'pending') || []
  const locked = busy || fetching
  return <section className="studio settings-page" aria-busy={locked}>
    <header className="settings-heading"><div><h1>Team & access</h1><p>Choose where you work and who can work with you.</p></div><button className="settings-primary" disabled={locked} aria-expanded={showCreate} onClick={() => setShowCreate(!showCreate)}><Plus size={17} aria-hidden="true" /> New workspace</button></header>
    {error && <div role="alert" className="settings-message error">{error} <button disabled={locked} onClick={() => { setError(''); setFetching(true); setReload(value => value + 1) }}>Try again</button></div>}
    {notice && <p role="status" className="settings-message">{notice}</p>}
    {!verified && <p className="settings-message warning">Verify your account before creating a workspace or accepting an invitation.</p>}
    <div className="settings-workspace"><span className="settings-icon"><Users size={24} aria-hidden="true" /></span><div><label htmlFor="workspace-select">You’re working in</label><select id="workspace-select" disabled={locked} value={selected} onChange={event => { selectWorkspace(uid, event.target.value); setSelected(event.target.value); setDetail(null); setFetching(true); setMemberRoles({}); setShowInvite(false); setNotice('') }}>{workspaces.length ? workspaces.map(item => <option key={item.id} value={item.id}>{item.name}</option>) : <option value={selected}>Loading workspaces…</option>}</select><p>{selected === 'personal' ? 'Your personal ideas and drafts are visible only to you.' : 'Ideas and content are shared with this workspace’s members.'}</p></div>{current && <span className="settings-pill">{current.role}</span>}<Link to="/ideas">Open Topic Library →</Link></div>
    {showCreate && <form className="settings-surface settings-form" onSubmit={event => { event.preventDefault(); void run(async () => { const created = await studioRequest<Workspace>('/workspaces', { name, requestId: createRequestId }, 'POST'); setName(''); setCreateRequestId(crypto.randomUUID()); setShowCreate(false); selectWorkspace(uid, created.id); setSelected(created.id); setNotice('Workspace created. You can now invite your team.') }) }}><h2>Create a shared workspace</h2><p>A separate place for your team’s ideas and content.</p><label>Workspace name<input required minLength={2} maxLength={100} name="workspace-name" placeholder="For example, Marketing team…" value={name} disabled={locked} onChange={event => { setName(event.target.value); setCreateRequestId(crypto.randomUUID()) }} /></label><div className="settings-actions"><button className="settings-primary" disabled={locked || !verified}>Create workspace</button><button type="button" disabled={locked} onClick={() => setShowCreate(false)}>Cancel</button></div></form>}
    <div className="settings-columns"><div><section className="settings-surface"><header className="settings-section-heading"><div><h2>People in this workspace {detail?.members && <span className="settings-count">{detail.members.length}</span>}</h2><p>{detail?.members ? 'Manage who can join and what they can do.' : 'Workspace owners manage membership and permissions.'}</p></div>{detail?.members && <button className="settings-primary" disabled={locked} aria-expanded={showInvite} onClick={() => setShowInvite(!showInvite)}><Plus size={16} aria-hidden="true" /> Invite member</button>}</header>
    {fetching ? <div className="settings-loading" role="status"><span />Loading workspace members…<span /></div> : selected === 'personal' ? <div className="settings-empty"><UserRound size={28} aria-hidden="true" /><h3>Just you, for now</h3><p>Create a shared workspace when you want to collaborate.</p><button onClick={() => setShowCreate(true)}>Create a shared workspace</button></div> : !detail?.members ? <p className="settings-empty">Your role: <strong>{current?.role}</strong>. {current && descriptions[current.role]}</p> : <>
      {showInvite && <form className="settings-invite settings-form" onSubmit={event => { event.preventDefault(); void run(async () => { await studioRequest(`/workspaces/${encodeURIComponent(detail.id)}/invitations`, { targetUid, role, expiresInHours: 24, revision: detail.revision }, 'POST'); setTargetUid(''); setShowInvite(false); setNotice('Invitation created. The recipient can accept it on their Team & access page within 24 hours. No email was sent.') }) }}><h3>Invite someone to collaborate</h3><p>Ask them to copy their account ID from this page in their own account.</p><label>Recipient account ID<input required name="recipient-account" autoComplete="off" spellCheck={false} maxLength={200} placeholder="Paste their account ID…" value={targetUid} disabled={locked} onChange={event => setTargetUid(event.target.value)} /></label><label>What can they do?<select value={role} disabled={locked} onChange={event => setRole(event.target.value as Role)}>{roles.map(value => <option key={value} value={value}>{value} — {descriptions[value]}</option>)}</select></label><p>Expires in 24 hours. The recipient accepts here; no email is sent.</p><div className="settings-actions"><button className="settings-primary" disabled={locked}>Create invitation</button><button type="button" disabled={locked} onClick={() => setShowInvite(false)}>Cancel</button></div></form>}
      <div className="settings-members">{detail.members.map(member => <article className="settings-member" key={member.uid}><span className="settings-avatar"><UserRound size={18} aria-hidden="true" /></span><div className="settings-member-identity"><strong>{member.uid === uid ? 'You' : 'Workspace member'}</strong><details><summary>Account ID · {shortId(member.uid)}</summary><code>{member.uid}</code><button onClick={() => void copyId(member.uid)}>Copy ID</button></details></div><label className="settings-role"><span className="sr-only">Role for {member.uid === uid ? 'you' : member.uid}</span><select value={memberRoles[member.uid] || member.role} disabled={locked} onChange={event => setMemberRoles(previous => ({ ...previous, [member.uid]: event.target.value as Role }))}>{roles.map(value => <option key={value}>{value}</option>)}</select></label><div className="settings-member-actions"><button disabled={locked || !memberRoles[member.uid] || memberRoles[member.uid] === member.role} onClick={() => void run(async () => { await studioRequest(`/workspaces/${encodeURIComponent(detail.id)}/members/${encodeURIComponent(member.uid)}`, { revision: detail.revision, role: memberRoles[member.uid] }, 'PATCH'); setNotice('Member role updated.') })}>Save role</button><button className="settings-danger" disabled={locked} onClick={() => { if (window.confirm(`Remove ${member.uid} from this workspace?`)) void run(async () => { await studioRequest(`/workspaces/${encodeURIComponent(detail.id)}/members/${encodeURIComponent(member.uid)}`, { revision: detail.revision }, 'DELETE') }) }}>Remove</button></div></article>)}</div>
      <div className="settings-pending"><h3>Pending invitations <span className="settings-count">{pending.length}</span></h3>{!pending.length ? <p>No invitations waiting for a response.</p> : pending.map(invite => <article className="settings-invitation" key={invite.id}><div><code>{invite.targetUid}</code><p>{invite.role} · Expires {new Date(invite.expiresAt).toLocaleString()}</p></div><button disabled={locked} onClick={() => { if (window.confirm('Revoke this invitation?')) void run(async () => { await studioRequest(`/workspaces/${encodeURIComponent(detail.id)}/invitations/${invite.id}`, { revision: detail.revision }, 'DELETE') }) }}>Revoke</button></article>)}</div></>}
    </section><section className="settings-surface"><h2>Invitations for you</h2><p>Invitations to join another team appear here.</p>{fetching ? <p role="status">Checking invitations…</p> : !invitations.length ? <p className="settings-quiet">You’re all caught up. No pending invitations.</p> : invitations.map(invite => <article className="settings-invitation" key={invite.id}><div><h3>{invite.workspaceName}</h3><p>{invite.role} · Expires {new Date(invite.expiresAt).toLocaleString()}</p></div><button disabled={locked || !verified} onClick={() => void run(async () => { await studioRequest(`/workspaces/${encodeURIComponent(invite.workspaceId)}/invitations/${invite.id}/accept`, {}, 'POST'); setNotice('Invitation accepted. Choose the workspace above to open it.') })}>Accept invitation</button></article>)}</section></div>
    <aside><section className="settings-surface"><h2><ShieldCheck size={20} aria-hidden="true" /> Roles, explained</h2><dl className="settings-role-guide">{roles.map(value => <div key={value}><dt>{value}</dt><dd>{descriptions[value]}</dd></div>)}</dl></section><section className="settings-surface"><h2>Your account ID</h2><p>Share this with a workspace owner so they can invite you.</p><button onClick={() => void copyId(uid)}><Copy size={16} aria-hidden="true" /> Copy my account ID</button><details className="settings-id"><summary>Show full ID</summary><code>{uid}</code></details></section></aside></div>
  </section>
}
