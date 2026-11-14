import { useEffect, useState, type ComponentProps } from 'react'
import { RefreshCw } from 'lucide-react'
import { IconButton } from '@/components/ui/IconButton'
import { useAuth } from '@/context/auth-state'
import { activeWorkspace } from '@/services/workspace-session'
import { studioRead, studioAssetBlob } from '@/services/studio-api'
import { InstagramPreview, type PreviewAccount, type PreviewMedia } from './InstagramPreview'

type Asset = { id: string; kind: string; mime: string; status: string; current: boolean; verification?: { status: string } | null }
type Snapshot = { key: string; loading: boolean; accounts: PreviewAccount[]; assets: Asset[]; errors: string[] }
type Props = ComponentProps<typeof InstagramPreview> & { packageId: string; revision: number; active?: boolean; dirty?: boolean }

export function ConnectedPostPreview({ packageId, revision, active = true, dirty = false, ...props }: Props) {
  const { identity } = useAuth()
  const platform = props.selectedPlatform || props.content.strategy?.platforms?.[0]?.platform || ''
  const postView = props.selectedSection === 'posts' || !props.selectedSection && (!props.contentFormat || props.contentFormat === 'post')
  const enabled = Boolean(active && identity && platform && postView)
  const key = JSON.stringify([identity?.uid, activeWorkspace(), packageId, revision, platform])
  const [refresh, setRefresh] = useState(0)
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [selection, setSelection] = useState<{ key: string; accountId?: string; assetId?: string }>({ key: '' })
  const [file, setFile] = useState<{ key: string; media?: PreviewMedia; error?: string } | null>(null)
  useEffect(() => {
    let live = true
    void Promise.resolve().then(() => { if (live) setSnapshot(enabled ? { key, loading: true, accounts: [], assets: [], errors: [] } : null) })
    if (!enabled) return () => { live = false }
    void Promise.allSettled([
      studioRead<{ enabled: boolean; accounts: PreviewAccount[] }>('/publishing/config'),
      studioRead<{ packageId: string; revision: number; platform: string; assets: Asset[] }>(`/packages/${encodeURIComponent(packageId)}/social-preview?platform=${encodeURIComponent(platform)}`),
    ]).then(([accounts, media]) => {
      if (!live) return
      const errors: string[] = []
      if (accounts.status === 'rejected') errors.push('Publishing accounts could not load. Reload the preview to try again.')
      if (media.status === 'rejected') errors.push('Generated media could not load. ' + (typeof media.reason?.message === 'string' ? media.reason.message : 'Reload the preview to try again.'))
      const current = media.status === 'fulfilled' && media.value.packageId === packageId && media.value.revision === revision && media.value.platform === platform
      if (media.status === 'fulfilled' && !current) errors.push('The saved content version changed. Reload the draft before previewing media.')
      setSnapshot({ key, loading: false, accounts: accounts.status === 'fulfilled' ? accounts.value.accounts.filter(account => account.platform === platform) : [], assets: current ? media.value.assets : [], errors })
    })
    return () => { live = false }
  }, [enabled, key, packageId, revision, platform, refresh])
  const current = enabled && snapshot?.key === key ? snapshot : null
  const assets = current?.assets.filter(asset => asset.current && asset.status === 'completed' && (platform === 'YouTube' ? asset.kind === 'video' && asset.mime === 'video/mp4' : asset.kind === 'image' && ['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(asset.mime) || asset.kind === 'video' && asset.mime === 'video/mp4')) || []
  const selected = selection.key === key ? selection : { key }
  const account = selected.accountId !== undefined ? current?.accounts.find(value => value.id === selected.accountId) : current?.accounts[0]
  const preferred = platform === 'YouTube' || props.contentFormat === 'reel' ? assets.find(asset => asset.kind === 'video') : assets.find(asset => asset.kind === 'image')
  const asset = selected.assetId !== undefined ? assets.find(value => value.id === selected.assetId) : preferred || assets[0]
  const fileKey = JSON.stringify([key, asset?.id, asset?.mime])
  useEffect(() => {
    let live = true; let url: string | undefined
    void Promise.resolve().then(() => { if (live) setFile(enabled && !dirty && asset ? { key: fileKey } : null) })
    if (!enabled || dirty || !asset) return () => { live = false }
    const controller = new AbortController()
    const timer = window.setTimeout(() => controller.abort(), 15000)
    void studioAssetBlob(asset.id, controller.signal).then(blob => {
      if (!live) return
      if (!blob.size || blob.type && blob.type !== asset.mime) throw new Error('The generated media format could not be verified.')
      url = URL.createObjectURL(blob)
      setFile({ key: fileKey, media: { id: asset.id, kind: asset.kind as 'image' | 'video', url } })
    }).catch(() => { if (live) setFile({ key: fileKey, error: 'The selected media could not be opened. Reload the preview to try again.' }) }).finally(() => window.clearTimeout(timer))
    return () => { live = false; controller.abort(); window.clearTimeout(timer); if (url) URL.revokeObjectURL(url) }
  }, [enabled, dirty, fileKey, asset, refresh])
  const media = !dirty && asset && current && file?.key === fileKey ? file.media : undefined
  if (!enabled) return <InstagramPreview {...props} />
  return <div className="connected-post-preview">
    <div className="post-preview-connections">
      <label>Preview account<select name="previewAccount" disabled={!current || current.loading || !current.accounts.length} value={account?.id || ''} onChange={event => { const accountId = event.target.value; setSelection(previous => ({ ...(previous.key === key ? previous : { key }), accountId })) }}><option value="">{current?.loading || !current ? 'Loading accounts…' : current.accounts.length ? 'Choose an account' : 'No matching account'}</option>{current?.accounts.map(value => <option key={value.id} value={value.id}>{value.name || value.id}</option>)}</select></label>
      <label>Preview media<select name="previewMedia" disabled={dirty || !current || current.loading || !assets.length} value={asset?.id || ''} onChange={event => { const assetId = event.target.value; setSelection(previous => ({ ...(previous.key === key ? previous : { key }), assetId })) }}><option value="">{dirty ? 'Save edits to check media' : 'No media selected'}</option>{assets.map(value => <option key={value.id} value={value.id}>{value.kind === 'video' ? 'Video' : 'Image'} · {value.id.slice(-8)}</option>)}</select></label>
      <IconButton icon={RefreshCw} label="Reload preview connections" tooltip="Reload preview" onClick={() => setRefresh(value => value + 1)} />
    </div>
    {(!current || current.loading) && <p role="status">Loading publishing accounts and current generated media…</p>}
    {current && !current.loading && !current.accounts.length && <p role="status">No {platform} account is configured for this workspace.</p>}
    {dirty ? <p role="status">Save your edits before checking media against this content version.</p> : current && !current.loading && !assets.length ? <p role="status">No compatible completed media is available for this saved version.</p> : asset && !media && !(file?.key === fileKey && file.error) ? <p role="status">Loading selected media…</p> : null}
    {current?.errors.map(error => <p role="alert" key={error}>{error}</p>)}
    {!dirty && asset && file?.key === fileKey && file.error && <p role="alert">{file.error}</p>}
    {asset?.verification?.status !== 'passed' && media && <p role="status">This media still needs release checks. Previewing does not approve it for publishing.</p>}
    <InstagramPreview {...props} selectedPlatform={platform} account={account} media={media} onMediaError={() => setFile({ key: fileKey, error: 'The selected media could not be displayed. Try another asset or reload the preview.' })} />
    <p className="post-preview-selection-note">Preview only. Publishing uses its own account and media selection and still runs release checks.</p>
  </div>
}
