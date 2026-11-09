import { useEffect, useState } from 'react'
import { studioRequest } from '@/services/studio-api'

type Account = { id: string; name: string; platform: string }
type Profile = { accountId: string; revision: number; weeklyBrief: string; audience: string; tone: string; contentPillars: string[]; weeklyCadence: number; dailyNews: boolean; maxDailyPosts: number; enabled: boolean; automationConsent: boolean }
type Publication = { id: string; status: string; mode: string; accountId: string; platform: string; caption: string; createdAt: string; releaseUrl?: string; error?: string }
type AutomationRun = { id: string; accountId: string; status: string; stage?: string; packageId?: string; error?: string; findings?: string[]; releaseUrl?: string }
type AutomationState = { plans: { id: string; accountId: string; weekStart: string; timezone: string; days: { date: string; slots: { kind: string }[] }[] }[]; runs: AutomationRun[]; requests: { id: string; status: string; accountIds: string[] }[]; requestResults: { requestId: string; accountId: string; outcome: { deferred?: boolean } }[] }
const emptyAutomation: AutomationState = { plans: [], runs: [], requests: [], requestResults: [] }
const emptyProfile = (accountId: string): Profile => ({ accountId, revision: 0, weeklyBrief: '', audience: '', tone: '', contentPillars: [], weeklyCadence: 3, dailyNews: true, maxDailyPosts: 1, enabled: false, automationConsent: false })

export function StudioPublishing({ packageId, disabled = false }: { packageId?: string; disabled?: boolean }) {
  const [accounts, setAccounts] = useState<Account[]>([])
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [profile, setProfile] = useState<Profile>(emptyProfile(''))
  const [pillars, setPillars] = useState('')
  const [publications, setPublications] = useState<Publication[]>([])
  const [providerEnabled, setProviderEnabled] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [automation, setAutomation] = useState<AutomationState>(emptyAutomation)
  const receiptsPath = packageId ? `/packages/${packageId}/social-publications` : '/publishing/receipts'
  useEffect(() => {
    let active = true
    Promise.all([
      studioRequest<{ enabled: boolean; accounts: Account[] }>('/publishing/config'),
      studioRequest<{ profiles: Profile[] }>('/publishing/profiles'),
      studioRequest<{ publications: Publication[] }>(receiptsPath),
      studioRequest<AutomationState>('/automation'),
    ]).then(([config, saved, receipts, execution]) => {
      if (active) { setAccounts(config.accounts); setProviderEnabled(config.enabled); setProfiles(saved.profiles); setPublications(receipts.publications); setAutomation(execution); setLoading(false) }
    }).catch(cause => { if (active) { setError(cause.message); setLoading(false) } })
    return () => { active = false }
  }, [receiptsPath])
  const pendingRuns = automation.runs.some(run => ['pending', 'awaiting_receipt'].includes(run.status) || run.status.endsWith('_running'))
  const pendingRequests = automation.requests.some(request => request.status === 'queued' && request.accountIds.some(id => !automation.requestResults.some(result => result.requestId === request.id && result.accountId === id && !result.outcome.deferred)))
  const pendingPosts = publications.some(item => ['submitted', 'dispatching', 'dispatch_unknown'].includes(item.status))
  useEffect(() => {
    if (!pendingRuns && !pendingRequests && !pendingPosts) return
    let active = true; let polling = false
    const timer = window.setInterval(async () => {
      if (polling) return
      polling = true
      try {
        const [execution, receipts] = await Promise.all([studioRequest<AutomationState>('/automation'), studioRequest<{ publications: Publication[] }>(receiptsPath)])
        const updated = await Promise.all(receipts.publications.map(async item => {
          if (!['submitted', 'dispatch_unknown'].includes(item.status)) return item
          try { return await studioRequest<Publication>(`/social-publications/${item.id}/refresh`, {}, 'POST') } catch { return item }
        }))
        if (active) { setAutomation(execution); setPublications(updated) }
      } catch { /* Status polling never creates content or posts. */ } finally { polling = false }
    }, 8000)
    return () => { active = false; window.clearInterval(timer) }
  }, [pendingRuns, pendingRequests, pendingPosts, receiptsPath])

  function accountLabel(accountId: string, fallback = accountId) {
    const account = accounts.find(value => value.id === accountId)
    return account ? `${account.name} · ${account.platform}` : fallback
  }
  function chooseAccount(accountId: string) {
    const value = profiles.find(item => item.accountId === accountId) || emptyProfile(accountId)
    setProfile(value); setPillars(value.contentPillars.join('\n')); setNotice(''); setError('')
  }
  async function saveProfile() {
    if (busy || disabled) return
    setBusy(true); setError(''); setNotice('')
    try {
      const { accountId, revision, weeklyBrief, audience, tone, weeklyCadence, dailyNews, maxDailyPosts, enabled, automationConsent } = profile
      const value = await studioRequest<Profile>('/publishing/profiles', { accountId, revision, weeklyBrief, audience, tone, weeklyCadence, dailyNews, maxDailyPosts, enabled, automationConsent, contentPillars: pillars.split('\n').map(item => item.trim()).filter(Boolean) }, 'PUT')
      setProfile(value); setPillars(value.contentPillars.join('\n')); setProfiles(previous => [...previous.filter(item => item.accountId !== value.accountId), value])
      setNotice(value.enabled ? 'Account plan saved. Automation will use this account’s brief and release checks.' : 'Account plan saved. Automation is paused for this account.')
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'The account plan was not saved. Please retry.') } finally { setBusy(false) }
  }
  async function refreshReceipt(id: string) {
    if (busy) return
    setBusy(true); setError('')
    try {
      const receipt = await studioRequest<Publication>(`/social-publications/${id}/refresh`, {}, 'POST')
      setPublications(previous => previous.map(item => item.id === receipt.id ? receipt : item))
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not check the post. No new post was started.') } finally { setBusy(false) }
  }
  async function createFromPlans() {
    if (busy || disabled || pendingRuns || pendingRequests) return
    setBusy(true); setError(''); setNotice('')
    try {
      await studioRequest('/automation/run', {}, 'POST')
      setAutomation(await studioRequest<AutomationState>('/automation'))
      setNotice('Account automation is queued. Each account uses its saved brief, source checks and publishing limits.')
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'The run was not confirmed. Check its saved status before trying again.') } finally { setBusy(false) }
  }
  async function downloadAutomated(packageId: string) {
    if (busy || disabled) return
    setBusy(true); setError('')
    try {
      const exported = await studioRequest(`/automation/packages/${encodeURIComponent(packageId)}/export`)
      const url = URL.createObjectURL(new Blob([JSON.stringify(exported, null, 2)], { type: 'application/json' }))
      const link = document.createElement('a'); link.href = url; link.download = `checked-content-${packageId}.json`; link.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
      setNotice('Your automated package is ready to download. Media links remain private to your workspace.')
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'This package has not passed its current automated release checks.') } finally { setBusy(false) }
  }

  return <section className="studio-readable-section" aria-busy={loading || busy}>
    <h2>Account content plan</h2>
    <p>Set each account’s audience, voice and weekly direction. Daily news supplements that account’s plan when enabled.</p>
    {loading && <p role="status">Loading connected accounts…</p>}
    {error && <p className="studio-alert" role="alert">{error}</p>}
    {notice && <p role="status" aria-live="polite">{notice}</p>}
    {!loading && !accounts.length && <p>No publishing account is enabled for this workspace. Connect an account before setting its plan.</p>}
    {profiles.length > 0 && <section><h3>Saved account plans</h3>{profiles.map(item => <p key={item.accountId}><strong>{accountLabel(item.accountId)}</strong> · {item.enabled && item.automationConsent ? 'Automatic research, creation and publishing enabled' : 'Paused'} · {item.weeklyCadence} planned posts per week · {item.dailyNews ? 'Daily news included' : 'Daily news off'} · Up to {item.maxDailyPosts} per day</p>)}<button type="button" disabled={disabled || busy || pendingRuns || pendingRequests || !profiles.some(item => item.enabled && item.automationConsent)} onClick={() => void createFromPlans()}>Create from saved plans</button>{(pendingRuns || pendingRequests) && <p role="status" aria-live="polite">Account automation is working. This page checks saved progress automatically.</p>}<p className="studio-muted">Enabled plans continue without a separate approval click for each post. Source, quality, media and duplicate checks can block a release.</p></section>}
    {!loading && accounts.length > 0 && <form onSubmit={event => { event.preventDefault(); void saveProfile() }}>
      <fieldset disabled={disabled || busy}>
        <legend>Weekly account direction</legend>
        <label>Social account<select name="publishing-account" value={profile.accountId} required onChange={event => chooseAccount(event.target.value)}><option value="">Choose an account</option>{accounts.map(account => <option key={account.id} value={account.id}>{account.name} · {account.platform}</option>)}</select></label>
        {profile.accountId && <>
          <label>Weekly brief<textarea name="weekly-brief" required minLength={15} maxLength={4000} value={profile.weeklyBrief} onChange={event => setProfile(previous => ({ ...previous, weeklyBrief: event.target.value }))} /></label>
          <div className="studio-fields"><label>Audience<input name="account-audience" required maxLength={500} value={profile.audience} onChange={event => setProfile(previous => ({ ...previous, audience: event.target.value }))} /></label><label>Account voice and tone<input name="account-tone" required maxLength={200} value={profile.tone} onChange={event => setProfile(previous => ({ ...previous, tone: event.target.value }))} /></label></div>
          <label>Content pillars, one per line<textarea name="content-pillars" required maxLength={2400} value={pillars} onChange={event => setPillars(event.target.value)} /></label><p className="studio-muted">Use up to 12 pillars, with no more than 200 characters per line.</p>
          <div className="studio-fields"><label>Planned posts per week<input name="weekly-cadence" type="number" min={0} max={14} required value={profile.weeklyCadence} onChange={event => setProfile(previous => ({ ...previous, weeklyCadence: Number(event.target.value) }))} /></label><label>Maximum posts per day<input name="daily-post-limit" type="number" min={1} max={10} required value={profile.maxDailyPosts} onChange={event => setProfile(previous => ({ ...previous, maxDailyPosts: Number(event.target.value) }))} /></label></div>
          <label className="studio-check"><input name="daily-news" type="checkbox" checked={profile.dailyNews} onChange={event => setProfile(previous => ({ ...previous, dailyNews: event.target.checked }))} />Include relevant daily news with linked sources.</label>
          <label className="studio-check"><input name="automation-consent" type="checkbox" checked={profile.automationConsent} onChange={event => setProfile(previous => ({ ...previous, automationConsent: event.target.checked, enabled: event.target.checked ? previous.enabled : false }))} />Authorize research, content creation and social publishing for this account under its saved plan and release checks.</label>
          <label className="studio-check"><input name="automation-enabled" type="checkbox" checked={profile.enabled} disabled={!profile.automationConsent} onChange={event => setProfile(previous => ({ ...previous, enabled: event.target.checked }))} />Enable this account’s automation.</label>
          {!profile.automationConsent && <p className="studio-muted">Authorize the account plan before enabling automation. Paid media still requires a separately authorized budget.</p>}
          {!providerEnabled && <p className="studio-muted">Publishing is not connected yet. You can save this account’s plan; posts will wait for the connection.</p>}
          <button type="submit">{busy ? 'Saving account plan…' : 'Save account plan'}</button>
        </>}
      </fieldset>
    </form>}
    {automation.plans.length > 0 && <details><summary>This week’s content plan</summary>{automation.plans.map(plan => <section key={plan.id}><h3>{accountLabel(plan.accountId)} · Week of {plan.weekStart}</h3><p className="studio-muted">{plan.timezone}</p>{plan.days.filter(day => day.slots.length).map(day => <p key={day.date}>{day.date} · {day.slots.map(slot => slot.kind === 'news' ? 'Daily news' : 'Weekly brief').join(', ')}</p>)}</section>)}</details>}
    {automation.runs.length > 0 && <section aria-live="polite"><h3>Content creation progress</h3>{automation.runs.map(run => <article className="studio-evidence" key={run.id}><h4>{accountLabel(run.accountId)} · {run.status.replaceAll('_', ' ')}</h4>{run.stage && <p>Latest stage: {run.stage}</p>}{run.error && <p role="status">{run.error}</p>}{run.findings?.map((finding, index) => <p key={index}>{finding}</p>)}{run.packageId && <div className="studio-toolbar"><a href={`/studio/${encodeURIComponent(run.packageId)}`}>Open content & media</a><button type="button" disabled={busy || disabled} onClick={() => void downloadAutomated(run.packageId!)}>Download checked package</button></div>}</article>)}</section>}
    <h3>Publishing receipts</h3>
    {!loading && !publications.length && <p>{packageId ? 'No post has been sent for this content.' : 'No publishing receipt has been recorded in this workspace.'}</p>}
    {publications.map(item => <article className="studio-evidence" key={item.id}><h4>{accountLabel(item.accountId, item.platform)} · {item.status.replaceAll('_', ' ')}</h4><p className="studio-muted">{item.mode} · {new Date(item.createdAt).toLocaleString()}</p><details><summary>Sent caption</summary><p className="preserve-lines">{item.caption}</p></details>{item.error && <p role="alert">{item.error}</p>}{item.releaseUrl?.startsWith('https://') ? <a href={item.releaseUrl} target="_blank" rel="noreferrer">Open published post</a> : <p>The platform has not returned a published link.</p>}<button type="button" disabled={busy || disabled} onClick={() => void refreshReceipt(item.id)}>Check post status</button></article>)}
  </section>
}
