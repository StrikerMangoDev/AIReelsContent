import { useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, Check, CheckCircle2, Circle, ClipboardList, Copy, Download, Eye, FileJson, FileText, Link2, X } from 'lucide-react'
import type { StudioPackage } from '@/services/studio-api'
import { formatLabels, type ContentFormat } from '@/services/studio-package'
import { defaultExportSections, exportData, exportDocument, exportFormats, exportSections, type ExportFormat, type ExportSection } from '@/services/studio-export'
import { cleanCopy } from './ContentPreview'
import { renderSocialCaption } from '../../../shared/social-caption.js'
import '@/styles/studio-export.css'

type Props = {
  pack: StudioPackage
  contentFormat: ContentFormat
  disabled: boolean
  dirty: boolean
  busy: string
  error: string
  onDownload: (format: ExportFormat, sections: readonly ExportSection[]) => Promise<void>
  onEdit: () => void
  onSources: () => void
  onHandoff: (view: string) => void
  onPublishing: () => void
}

export function StudioExport({ pack, contentFormat, disabled, dirty, busy, error, onDownload, onEdit, onSources, onHandoff, onPublishing }: Props) {
  const [format, setFormat] = useState<ExportFormat>('md')
  const [sections, setSections] = useState<ExportSection[]>(defaultExportSections)
  const [copyNotice, setCopyNotice] = useState('')
  const preview = useRef<HTMLDialogElement>(null)
  const choice = exportFormats.find(entry => entry.id === format)!
  const blocked = dirty ? 'Save your edits before downloading.' : pack.status === 'dispatch_unknown' ? 'Check the previous generation attempt before downloading.' : pack.review?.issues.length ? 'Resolve the source checks before downloading.' : busy ? `${busy}…` : pack.status === 'generating' ? 'Wait for generation to finish before downloading.' : !pack.content ? 'Generate and save content before downloading.' : disabled ? 'This saved package is not available to download yet.' : ''
  const sourceAvailable = pack.evidence.some(source => /^https?:\/\//i.test(source.url))
  const selectedPost = pack.content?.strategy?.platforms?.find(post => pack.settings.platform.split(',').map(value => value.trim()).includes(post.platform)) || pack.content?.strategy?.platforms?.[0]
  const copyText = contentFormat === 'article' ? pack.content?.website?.body : contentFormat === 'audio' || contentFormat === 'reel' ? pack.content?.script : renderSocialCaption(pack, selectedPost?.platform || pack.settings.platform.split(',')[0].trim())
  const copyLabel = contentFormat === 'post' ? 'Copy post' : 'Copy saved text'
  const previewDocument = pack.content ? exportDocument(pack, contentFormat, sections) : ''
  const previewText = pack.content ? format === 'json' ? JSON.stringify(exportData({ package: pack, manifest: { note: 'The server adds the validated export manifest when downloading.' } }, contentFormat, sections), null, 2) : format === 'txt' ? previewDocument.replace(/^#{1,6} /gm, '') : previewDocument : ''
  async function copy() {
    if (disabled || !copyText) return
    try { await navigator.clipboard.writeText(cleanCopy(copyText)); setCopyNotice('Saved text copied. Sources remain in your download.') }
    catch { setCopyNotice('Clipboard unavailable. Open Edit & preview to select and copy your text.') }
  }

  return <div className="studio-export">
    <header className="export-heading"><div><h2>{busy ? 'Preparing your file…' : disabled ? 'Prepare your content for export' : 'Your content is ready to export'}</h2><p>Choose your format and the sections you need.</p></div><span className="export-revision"><Check size={16} aria-hidden="true" />Saved revision {pack.revision}</span></header>
    <div className="export-layout">
      <div className="export-main">
        <fieldset className="export-card export-format-picker" disabled={Boolean(busy)}>
          <legend>Choose export format</legend>
          <div className="export-card-intro"><p>Select the file type for your workflow.</p><span>Step 1 of 2</span></div>
          <div className="export-formats">{exportFormats.map(entry => <label className="export-format" key={entry.id} data-selected={format === entry.id}>
            <input type="radio" name="exportFormat" value={entry.id} checked={format === entry.id} onChange={() => setFormat(entry.id)} />
            <span className="export-file-mark" aria-hidden="true">{entry.mark}</span><strong>{entry.label}</strong><span className="export-description">{entry.description}</span>
          </label>)}</div>
        </fieldset>

        <section className="export-card" aria-labelledby="export-customize-title">
          <div className="export-card-heading"><div><h3 id="export-customize-title">Customize your package</h3><p>Include the information you want in your export.</p></div><span>Step 2 of 2</span></div>
          <fieldset className="export-section-picker" disabled={Boolean(busy)}><legend className="export-sr-only">Included sections</legend>{exportSections.map(entry => <label key={entry.id}>
            <input type="checkbox" name="exportSection" value={entry.id} checked={sections.includes(entry.id)} disabled={entry.id === 'sources'} onChange={event => setSections(current => event.target.checked ? [...current, entry.id] : current.filter(id => id !== entry.id))} />
            <span><strong>{entry.label}</strong><small>{entry.description}</small></span>
          </label>)}</fieldset>
          <p className="export-source-note"><Link2 size={16} aria-hidden="true" />Sources and claim references stay attached to every file.</p>
          <div className="export-summary-line"><div><strong>Package summary</strong><p aria-live="polite" aria-atomic="true">{sections.length} of {exportSections.length} sections · {choice.label}</p></div><button type="button" disabled={disabled} onClick={() => preview.current?.showModal()}><Eye size={17} aria-hidden="true" />Preview file</button></div>
          {blocked && <div className="export-warning" id="export-blocked" role="status"><p>{blocked}</p>{dirty ? <button type="button" onClick={onEdit}>Return to content</button> : Boolean(pack.review?.issues.length) && <button type="button" onClick={onSources}>View source checks</button>}</div>}
          {error && <p className="export-error" role="alert">{error}</p>}
          <button type="button" className="export-download" disabled={disabled} aria-describedby={blocked ? 'export-blocked' : undefined} onClick={() => void onDownload(format, sections)}><Download size={18} aria-hidden="true" />{busy === 'Preparing your download' ? 'Preparing your download…' : `Download ${format === 'zip' ? 'all files' : choice.label}`}</button>
          <p className="export-fineprint">Downloads only. Nothing will be published automatically.</p>
        </section>

        <section className="export-card export-handoffs" aria-labelledby="export-handoff-title"><h3 id="export-handoff-title">Need another handoff?</h3>
          <button type="button" onClick={() => onHandoff('downloads')}><FileJson size={20} aria-hidden="true" /><span><strong>Internal production package</strong><small>Complete structured data for your team and tools</small></span><ArrowRight size={18} aria-hidden="true" /></button>
          <button type="button" onClick={() => onHandoff('prompts')}><FileText size={20} aria-hidden="true" /><span><strong>External AI prompt handoff</strong><small>Creative instructions for other tools</small></span><ArrowRight size={18} aria-hidden="true" /></button>
          <button type="button" onClick={onPublishing}><ClipboardList size={20} aria-hidden="true" /><span><strong>Publishing checklist</strong><small>Review account plans and publishing controls</small></span><ArrowRight size={18} aria-hidden="true" /></button>
        </section>
      </div>

      <aside className="export-aside" aria-label="Export overview">
        <div className="export-readiness" data-ready={!disabled}>{disabled ? <Circle size={24} aria-hidden="true" /> : <CheckCircle2 size={24} aria-hidden="true" />}<div><strong>{disabled ? 'Package needs attention' : 'Saved package available'}</strong><p>{disabled ? blocked : 'Sources and citations are checked again when you download.'}</p></div></div>
        <section className="export-card export-overview"><h3>Export overview</h3><span className="export-description">Current project</span><p className="export-project-title">{pack.title}</p><dl>
          <div><dt>Content format</dt><dd>{formatLabels[contentFormat]}</dd></div><div><dt>Platforms</dt><dd>{pack.settings.platform}</dd></div><div><dt>Version</dt><dd>Revision {pack.revision}</dd></div><div><dt>File format</dt><dd>{format === 'docx' ? choice.label : `${choice.label} (.${format})`}</dd></div><div><dt>Sections included</dt><dd>{sections.length} of {exportSections.length}</dd></div>
        </dl></section>
        <section className="export-card export-checklist"><h3>Before publishing</h3><ul>
          <li>{pack.content && !dirty ? <Check size={16} aria-hidden="true" /> : <Circle size={16} aria-hidden="true" />}<span>{pack.content && !dirty ? 'Saved writing is available' : 'Save your writing'}</span></li>
          <li>{sourceAvailable ? <Check size={16} aria-hidden="true" /> : <Circle size={16} aria-hidden="true" />}<span>{sourceAvailable ? 'Source URL included' : 'Review source references'}</span></li>
          {['Independently verify claims', 'Attach final media, if needed', 'Review the publishing account'].map(label => <li key={label} className="export-review-item"><Circle size={14} aria-hidden="true" /><span>{label}</span></li>)}
        </ul><p>Automated checks do not guarantee factual accuracy. Review the final content and source references before use.</p></section>
        <section className="export-card export-quick-actions"><h3>Quick actions</h3><button type="button" disabled={disabled || !copyText} onClick={() => void copy()}><Copy size={16} aria-hidden="true" />{copyLabel}</button>{!copyText && <p>No matching text is saved for this content format.</p>}<button type="button" onClick={onSources}><Link2 size={16} aria-hidden="true" />View sources</button><p role="status">{copyNotice}</p></section>
      </aside>
    </div>
    <footer className="export-footer"><p><Check size={16} aria-hidden="true" />Revision {pack.revision} · Export does not publish your content</p><div><button type="button" onClick={onEdit}><ArrowLeft size={16} aria-hidden="true" />Edit content</button><button type="button" className="export-download" disabled={disabled} onClick={() => void onDownload(format, sections)}><Download size={17} aria-hidden="true" />Download package</button></div></footer>
    <dialog ref={preview} className="export-preview" aria-labelledby="export-preview-title"><header><div><h2 id="export-preview-title">{choice.label} preview</h2><p>Saved revision {pack.revision} · {sections.length} sections</p></div><button type="button" aria-label="Close file preview" onClick={() => preview.current?.close()}><X size={20} aria-hidden="true" /></button></header><p>{format === 'zip' ? 'The ZIP contains Markdown, JSON, plain text, HTML and Word versions of the content below. ' : format === 'docx' || format === 'html' ? 'Text preview; heading styles are applied in the downloaded document. ' : ''}The validated export manifest is added when you download. Generated media files are not included.</p><pre tabIndex={0}>{previewText}</pre><button type="button" onClick={() => preview.current?.close()}>Back to export options</button></dialog>
  </div>
}
