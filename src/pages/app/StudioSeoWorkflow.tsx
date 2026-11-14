import type { ReactNode } from 'react'
import type { PackageContext, PackageValue, WebsiteSeoReport, WebsiteSeoWorkflow } from '@/services/complete-package'

type Field = { key: string; label: string; type?: 'text' | 'textarea' | 'url' | 'number' | 'date' | 'datetime-local' | 'select' | 'checkbox'; optional?: boolean; options?: string[]; max?: number; min?: number; step?: string; maxLength?: number }
type Values = Record<string, unknown>
const field = (key: string, label: string, options: Omit<Field, 'key' | 'label'> = {}): Field => ({ key, label, ...options })
const date = () => new Date().toISOString()
const title = (value: string) => value.replace(/([a-z])([A-Z])/g, '$1 $2').replaceAll('_', ' ').replaceAll('-', ' ').replace(/^./, first => first.toUpperCase())
const localDate = (value: unknown) => { const d = new Date(String(value)); return Number.isNaN(d.getTime()) ? '' : new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16) }
const optionalUrl = (key: string, label: string) => field(key, label, { type: 'url', optional: true })
const url = (key: string, label: string) => field(key, label, { type: 'url' })
const note = (key: string, label: string, optional = false) => field(key, label, { type: 'textarea', optional })
const choice = (key: string, label: string, options: string[]) => field(key, label, { type: 'select', options })
const number = (key: string, label: string, max?: number) => field(key, label, { type: 'number', optional: true, min: key === 'position' ? 1 : 0, max: key === 'position' ? 1000 : max, step: key === 'cpc' || key === 'position' ? '0.01' : '1' })
const observed = field('observedAt', 'Observed at', { type: 'datetime-local' })

export function StudioSeoWorkflow({ context, contentHash, report, disabled, dirty, onChange, onAudit }: {
  context: PackageContext; contentHash: string; report?: WebsiteSeoReport; disabled: boolean; dirty: boolean;
  onChange: (context: PackageContext) => void; onAudit: (pageUrl: string) => void;
}) {
  const workflow = context.seoWorkflow
  const update = (patch: Partial<WebsiteSeoWorkflow>) => { if (!disabled && workflow) onChange({ ...context, seoWorkflow: { ...workflow, ...patch } }) }
  const empty: WebsiteSeoWorkflow = { version: 'website-seo-v1', enabled: true, pages: [], competitors: [], keywords: [], research: [], outline: [], calendar: [], metrics: [], decisions: [] }
  if (!workflow) return <div className="strategy-workflow"><p>Plan website research, search intent, page mapping, SEO checks and content updates alongside this package’s social content.</p><button type="button" disabled={disabled} onClick={() => { if (!disabled) onChange({ ...context, seoWorkflow: empty }) }}>Start website SEO workflow</button><p>Website SEO remains optional for social-only content. This does not connect a CMS or publish a page.</p></div>
  const locked = disabled || !workflow.enabled
  const priorities = new Map(report?.keywordPriority.map(item => [item.keywordId, item]))
  const currentChecks = workflow.checks?.contentHash === contentHash
  return <div className="strategy-workflow" aria-label="Website SEO workflow">
    <p>Website research and page execution share this saved package. Save package context to retain edits; changing inputs makes prior AI analysis stale.</p>
    {report?.applicable === false && <p role="status">Website output is not selected for this package. Research can be planned here; SEO readiness does not hold social-only content.</p>}
    <label className="complete-package-check"><input type="checkbox" name="seoEnabled" checked={workflow.enabled} disabled={disabled} onChange={event => update({ enabled: event.target.checked })} /><span>Use website SEO workflow for this package</span></label>
    {!workflow.enabled && <p role="status">Website SEO checks are paused. Saved research is retained. Enable the workflow to edit it.</p>}
    {report && <details className="complete-package-edit"><summary>Saved website SEO readiness: {title(report.status)}</summary><p>Readiness below describes the last saved inputs, not unsaved edits or guaranteed search performance.</p><ol className="strategy-workflow-steps">{report.steps.map(item => <li key={item.id}><strong>{item.title}: {title(item.status)}</strong><p>{item.reason}</p></li>)}</ol></details>}
    <fieldset disabled={locked}>
      <details className="complete-package-edit"><summary>Website and business research</summary>
        <Fields fields={[optionalUrl('siteUrl', 'Website URL')]} value={workflow} onChange={value => update(value as Partial<WebsiteSeoWorkflow>)} />
        <Fields fields={[{ ...note('objectives', 'Business objectives'), maxLength: 1500 }, note('audience', 'Target audience and search behaviour'), field('industry', 'Industry', { maxLength: 500 })]} value={workflow.business || { objectives: '', audience: '', industry: '' }} onChange={value => update({ business: value as WebsiteSeoWorkflow['business'] })} />
        <p>Use page records below to describe the existing site, services, products and content gaps. Research records preserve where an observation came from.</p>
      </details>
      <details className="complete-package-edit"><summary>Competitors and content gaps <span>{workflow.competitors.length}/10</span></summary>
        <p>Record inspected competing pages. A reported traffic or ranking claim needs its own dated source; visible content alone cannot establish traffic.</p>
        <Rows entries={workflow.competitors} name="competitor" locked={locked} fields={[url('url', 'Competitor page URL'), choice('kind', 'Competitor type', ['direct', 'indirect']), note('observation', 'Observed structure, content, rankings or links'), note('gap', 'Missing information and our opportunity'), url('sourceUrl', 'Evidence URL'), observed]} onChange={competitors => update({ competitors })} />
        <button type="button" disabled={locked || workflow.competitors.length >= 10} onClick={() => update({ competitors: [...workflow.competitors, { id: crypto.randomUUID(), url: '', kind: 'direct', observation: '', gap: '', sourceUrl: '', observedAt: date() }] })}>Add competitor</button>
      </details>
      <details className="complete-package-edit"><summary>Keywords and search intent <span>{workflow.keywords.length}/30</span></summary>
        <p>Leave unavailable measurements blank. Zero means a source actually reported zero. Keyword priority is an editorial score, not ranking probability.</p>
        <Rows entries={workflow.keywords} name="keyword" locked={locked} fields={[field('phrase', 'Search phrase', { maxLength: 300 }), choice('intent', 'Search intent', ['informational', 'commercial', 'transactional', 'navigational']), choice('role', 'Keyword role', ['primary', 'supporting']), field('cluster', 'Topic cluster', { optional: true, maxLength: 200 }), number('volume', 'Reported search volume'), number('difficulty', 'Reported keyword difficulty (0–100)', 100), number('cpc', 'Reported CPC', 1000000), field('currency', 'CPC currency code', { optional: true, maxLength: 3 }), field('provider', 'Research provider or source', { maxLength: 200 }), url('sourceUrl', 'Research evidence URL'), field('region', 'Measurement geography', { maxLength: 200 }), field('period', 'Measurement period', { maxLength: 200 }), observed]} onChange={keywords => update({ keywords })} extra={entry => { const priority = priorities.get(entry.id); return priority && <p>Last saved editorial priority: {priority.score === null ? 'Unavailable' : `${priority.score}/${priority.maxScore}`}. {priority.rationale}</p> }} />
        <button type="button" disabled={locked || workflow.keywords.length >= 30} onClick={() => update({ keywords: [...workflow.keywords, { id: crypto.randomUUID(), phrase: '', intent: 'informational', role: 'primary', provider: '', sourceUrl: '', observedAt: date(), region: '', period: '' }] })}>Add SEO keyword</button>
      </details>
      <details className="complete-package-edit"><summary>Page mapping, topic clusters and calendar</summary>
        <p>Give each search intent a destination. Assign primary and supporting keywords, then link supporting pages to a pillar page. Reuse existing pages where appropriate.</p>
        <Rows entries={workflow.pages} name="page" locked={locked} fields={[url('url', 'Existing or planned page URL'), note('purpose', 'Page purpose and audience need'), choice('action', 'Page action', ['create', 'update', 'merge', 'keep']), field('cluster', 'Topic cluster', { optional: true }), optionalUrl('pillarUrl', 'Pillar page URL'), note('rationale', 'Why create, update, merge or keep this page')]} onChange={pages => update({ pages })} extra={(entry, change) => <><label>Primary keyword<select name="primaryKeywordId" value={entry.primaryKeywordId || ''} onChange={event => change({ primaryKeywordId: event.target.value || undefined })}><option value="">Choose a primary keyword</option>{workflow.keywords.map(item => <option key={item.id} value={item.id}>{item.phrase || 'Untitled keyword'}</option>)}</select></label><References label="Supporting keywords" entries={workflow.keywords.map(item => ({ id: item.id, label: item.phrase || 'Untitled keyword' }))} value={entry.supportingKeywordIds} onChange={supportingKeywordIds => change({ supportingKeywordIds })} /></>} />
        <button type="button" disabled={locked || workflow.pages.length >= 30} onClick={() => update({ pages: [...workflow.pages, { id: crypto.randomUUID(), url: '', purpose: '', supportingKeywordIds: [], action: 'create', rationale: '' }] })}>Add website page</button>
        <h4>Saved keyword overlap checks</h4>{report?.conflicts.length ? report.conflicts.map(item => <p key={item.phrase} className="complete-package-warning">Review “{item.phrase}” across {item.pageUrls.join(', ')}.</p>) : <p>No conflicts reported for the last saved mappings. This is not a full search-index audit.</p>}
        <h4>Content calendar</h4>
        <Rows entries={workflow.calendar} name="calendar entry" locked={locked} fields={[field('dueDate', 'Planned publication date', { type: 'date' }), field('owner', 'Responsible owner'), choice('status', 'Work status', ['planned', 'writing', 'review', 'published'])]} onChange={calendar => update({ calendar })} extra={(entry, change) => <Reference label="Calendar page" value={entry.pageId} entries={workflow.pages.map(item => ({ id: item.id, label: item.url || 'Untitled page' }))} onChange={pageId => change({ pageId })} />} />
        <button type="button" disabled={locked || workflow.calendar.length >= 30} onClick={() => update({ calendar: [...workflow.calendar, { id: crypto.randomUUID(), pageId: '', dueDate: new Date().toISOString().slice(0, 10), owner: '', status: 'planned' }] })}>Add calendar entry</button>
      </details>
      <details className="complete-package-edit"><summary>Content research and article outline</summary>
        <p>Preserve search-result observations, audience questions and authoritative facts. Competitor headings guide coverage; do not copy their content. Writing still uses the package’s checked source evidence.</p>
        <Rows entries={workflow.research} name="research record" locked={locked} fields={[url('url', 'Research URL'), choice('kind', 'Research type', ['serp', 'question', 'expert', 'official', 'community']), note('observation', 'Observed fact, question or search result'), note('gap', 'Missing information or unique angle', true), observed]} onChange={research => update({ research })} />
        <button type="button" disabled={locked || workflow.research.length >= 30} onClick={() => update({ research: [...workflow.research, { id: crypto.randomUUID(), url: '', kind: 'official', observation: '', observedAt: date() }] })}>Add content research</button>
        <h4>Article outline</h4>
        <Rows entries={workflow.outline} name="outline heading" locked={locked} fields={[field('level', 'Heading level', { type: 'number', min: 1, max: 3, step: '1' }), field('text', 'Heading or FAQ question')]} onChange={outline => update({ outline })} extra={(entry, change) => <References label="Supporting content research" entries={workflow.research.map(item => ({ id: item.id, label: item.observation || item.url || 'Untitled research' }))} value={entry.researchIds} onChange={researchIds => change({ researchIds })} />} />
        <button type="button" disabled={locked || workflow.outline.length >= 30} onClick={() => update({ outline: [...workflow.outline, { id: crypto.randomUUID(), level: workflow.outline.length ? 2 : 1, text: '', researchIds: [] }] })}>Add outline heading</button>
      </details>
      <details className="complete-package-edit"><summary>Editing and on-page SEO checks</summary>
        <p>Edit the SEO title, description, slug, canonical URL, internal links and hero alternative text in Brief &amp; research → Website metadata &amp; internal links.</p>
        {!workflow.checks ? <button type="button" disabled={locked} onClick={() => update({ checks: { contentHash, originality: 'not_checked', intentSatisfied: false, addedValue: false, note: '' } })}>Start website content checks</button> : <>
          {!currentChecks && <p className="complete-package-warning">These confirmations cover an older content revision. Changing a check starts a new review and clears previous confirmations.</p>}
          <Fields fields={[choice('originality', 'Actual originality review', ['not_checked', 'reported_checked']), field('intentSatisfied', 'Search intent satisfied', { type: 'checkbox' }), field('addedValue', 'Additional value beyond inspected competing pages', { type: 'checkbox' }), note('note', 'Review scope, tool, reviewer and limitations')]} value={workflow.checks} onChange={(value, key) => update({ checks: { ...(currentChecks ? value : { originality: 'not_checked', intentSatisfied: false, addedValue: false, note: '', ...(key ? { [key]: value[key] } : {}) }), contentHash } as WebsiteSeoWorkflow['checks'] })} />
          <p>A recorded originality check does not prove a plagiarism service was connected or certify legal clearance.</p>
        </>}
        <h4>Inspect a saved public page</h4><p>Save context first. This read-only check fetches the selected page and reports observed metadata, headings, links and indexing directives. It does not publish, submit for indexing or replace a mobile visual review.</p>
        {dirty && <p role="status">Save all context changes before inspecting a page.</p>}
        {!workflow.pages.length && <p>Add a page mapping before inspecting its URL.</p>}
        {workflow.pages.map(item => <div className="complete-package-actions" key={item.id}><button type="button" disabled={locked || dirty || !item.url} onClick={() => { if (!locked && !dirty && item.url) onAudit(item.url) }}>Inspect page {item.url || '(URL required)'}</button></div>)}
      </details>
      <details className="complete-package-edit"><summary>Website publishing, sitemap and indexing</summary>
        <p>Record actual website delivery separately from social publishing. A CMS name or indexing request does not prove publication or index inclusion.</p>
        {!workflow.publication ? <button type="button" disabled={locked} onClick={() => update({ publication: { pageUrl: '', status: 'not_connected', indexing: 'not_checked' } })}>Add website publication record</button> : <><Fields fields={[url('pageUrl', 'Website publication URL'), choice('status', 'Actual website publication status', ['not_connected', 'draft', 'published_reported']), field('cms', 'CMS used', { optional: true }), field('publishedAt', 'Actual publication time', { type: 'datetime-local', optional: true }), optionalUrl('receiptUrl', 'Publication receipt URL'), optionalUrl('sitemapUrl', 'XML sitemap URL'), choice('indexing', 'Reported indexing status', ['not_checked', 'requested_reported', 'indexed_reported', 'not_indexed_reported']), field('inspectedAt', 'Actual indexing inspection time', { type: 'datetime-local', optional: true }), optionalUrl('inspectionSourceUrl', 'Indexing inspection evidence URL')]} value={workflow.publication} onChange={value => update({ publication: value as WebsiteSeoWorkflow['publication'] })} /><button type="button" disabled={locked} onClick={() => update({ publication: undefined })}>Remove website publication record</button></>}
      </details>
      <details className="complete-package-edit"><summary>Search performance and content updates</summary>
        <p>Record exact reporting periods and evidence from Search Console, GA4 or another report. Blank metrics stay unknown. A report source does not connect that service.</p><p>Describe all applied filters, such as India, mobile, web search and all queries. Comparisons require the same measurement segment, source, page, query and reporting duration.</p>
        <Rows entries={workflow.metrics} name="SEO performance record" locked={locked} fields={[url('pageUrl', 'Measured page URL'), field('query', 'Search query', { optional: true }), field('segment', 'Measurement segment / filters', { maxLength: 500 }), choice('source', 'Report source', ['search_console', 'ga4', 'reported']), url('sourceUrl', 'Performance report evidence URL'), field('periodStart', 'Reporting period starts', { type: 'datetime-local' }), field('periodEnd', 'Reporting period ends', { type: 'datetime-local' }), observed, number('clicks', 'Organic search clicks'), number('impressions', 'Organic search impressions'), number('position', 'Average search position'), number('organicSessions', 'Organic sessions'), number('conversions', 'Attributed conversions')]} onChange={metrics => update({ metrics })} />
        <button type="button" disabled={locked || workflow.metrics.length >= 60} onClick={() => update({ metrics: [...workflow.metrics, { id: crypto.randomUUID(), pageUrl: '', segment: '', source: 'reported', sourceUrl: '', periodStart: '', periodEnd: '', observedAt: date() }] })}>Add SEO performance record</button>
        <h4>Next content actions</h4>
        <Rows entries={workflow.decisions} name="content update decision" locked={locked} fields={[choice('action', 'Proposed content action', ['refresh', 'expand', 'merge', 'keep', 'investigate']), note('reason', 'Reason and expected improvement'), choice('status', 'Decision status', ['proposed', 'adopted'])]} onChange={decisions => update({ decisions })} extra={(entry, change) => <><Reference label="Page to improve" value={entry.pageId} entries={workflow.pages.map(item => ({ id: item.id, label: item.url || 'Untitled page' }))} onChange={pageId => change({ pageId })} /><References label="Supporting SEO performance" entries={workflow.metrics.map(item => ({ id: item.id, label: `${item.pageUrl || 'Page required'} · ${item.periodStart || 'Period required'}` }))} value={entry.metricIds} onChange={metricIds => change({ metricIds })} /></>} />
        <button type="button" disabled={locked || workflow.decisions.length >= 20} onClick={() => update({ decisions: [...workflow.decisions, { id: crypto.randomUUID(), pageId: '', action: 'investigate', reason: '', metricIds: [], status: 'proposed' }] })}>Add content update decision</button>
      </details>
    </fieldset>
    {report && <>
      <details className="complete-package-edit"><summary>Saved page inspection results</summary><Readout value={report.audits} /></details>
      <details className="complete-package-edit"><summary>Calculated search results and refresh suggestions</summary><Readout value={report.performance} /><Readout value={report.refreshRecommendations} /><p>Comparisons describe reported data. Changes in traffic do not prove a content change caused them.</p></details>
      <details className="complete-package-edit"><summary>Connections and verification limits</summary>{report.connections.map(item => <p key={item.id}><strong>{title(item.id)}: {title(item.status)}</strong>. {item.reason}</p>)}<ul>{report.limitations.map(item => <li key={item}>{item}</li>)}</ul></details>
    </>}
  </div>
}

function Fields({ fields, value, onChange }: { fields: Field[]; value: object; onChange: (value: Values, key?: string) => void }) {
  const values = value as Values
  function change(f: Field, raw: string | boolean) {
    const next = { ...values }
    if (raw === '' && f.optional) delete next[f.key]
    else next[f.key] = f.type === 'number' ? raw === '' ? '' : Number(raw) : f.type === 'datetime-local' ? raw ? new Date(String(raw)).toISOString() : '' : raw
    onChange(next, f.key)
  }
  return <div className="complete-package-fields">{fields.map(f => {
    const label = `${f.label}${f.optional ? ' (optional)' : ''}`
    const maxLength = f.maxLength || ({ objectives: 1500, industry: 500, observation: 1500, gap: 1500, cluster: 200, provider: 200, region: 200, period: 200, text: 500, cms: 200, owner: 200, query: 300, note: 1500, reason: 1500 } as Record<string, number>)[f.key] || (f.type === 'url' ? 2000 : 1000)
    if (f.type === 'checkbox') return <label className="complete-package-check" key={f.key}><input type="checkbox" name={f.key} checked={values[f.key] === true} onChange={event => change(f, event.target.checked)} /><span>{label}</span></label>
    return <label key={f.key}>{label}{f.type === 'textarea' ? <textarea name={f.key} autoComplete="off" required={!f.optional} maxLength={maxLength} value={String(values[f.key] ?? '')} onChange={event => change(f, event.target.value)} /> : f.type === 'select' ? <select name={f.key} required={!f.optional} value={String(values[f.key] ?? '')} onChange={event => change(f, event.target.value)}>{f.options?.map(option => <option key={option} value={option}>{title(option)}</option>)}</select> : <input name={f.key} autoComplete="off" type={f.type || 'text'} required={!f.optional} pattern={f.type === 'url' ? 'https://.*' : f.key === 'currency' ? '[A-Z]{3}' : undefined} maxLength={maxLength} min={f.min} max={f.max} step={f.step} value={f.type === 'datetime-local' ? localDate(values[f.key]) : String(values[f.key] ?? '')} onChange={event => change(f, event.target.value)} />}</label>
  })}</div>
}

function Rows<T extends { id: string }>({ entries, name, locked, fields, onChange, extra }: { entries: T[]; name: string; locked: boolean; fields: Field[]; onChange: (entries: T[]) => void; extra?: (entry: T, change: (patch: Partial<T>) => void) => ReactNode }) {
  const change = (index: number, patch: Partial<T>) => { if (!locked) onChange(entries.map((entry, i) => i === index ? { ...entry, ...patch } : entry)) }
  return <>{!entries.length && <p>No {name} records yet.</p>}{entries.map((entry, index) => <details className="complete-package-draft-record" key={entry.id}><summary>{title(name)} {index + 1}</summary><p className="studio-muted">Reference: {entry.id}</p><Fields fields={fields} value={entry} onChange={value => { if (!locked) onChange(entries.map((row, i) => i === index ? value as T : row)) }} />{extra?.(entry, patch => change(index, patch))}<button type="button" disabled={locked} onClick={() => { if (!locked) onChange(entries.filter((_row, i) => i !== index)) }}>Remove {name} {index + 1}</button></details>)}</>
}

function Reference({ label, entries, value, onChange }: { label: string; entries: { id: string; label: string }[]; value: string; onChange: (id: string) => void }) {
  return <label>{label}<select name={label} required value={value} onChange={event => onChange(event.target.value)}><option value="">Choose a page</option>{entries.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}{value && !entries.some(item => item.id === value) && <option value={value}>Missing page: {value}</option>}</select></label>
}

function References({ label, entries, value, onChange }: { label: string; entries: { id: string; label: string }[]; value: string[]; onChange: (ids: string[]) => void }) {
  return <fieldset className="strategy-workflow-references"><legend>{label}</legend>{!entries.length && <p>No matching records yet.</p>}{entries.map(item => <label className="complete-package-check" key={item.id}><input type="checkbox" name={`${label}:${item.id}`} checked={value.includes(item.id)} disabled={!value.includes(item.id) && value.length >= 20} onChange={event => onChange(event.target.checked ? [...value, item.id] : value.filter(id => id !== item.id))} /><span>{item.label}</span></label>)}{value.filter(id => !entries.some(item => item.id === id)).map(id => <label className="complete-package-check" key={id}><input type="checkbox" checked onChange={() => onChange(value.filter(item => item !== id))} /><span>Missing reference: {id}. Remove it or restore the record.</span></label>)}</fieldset>
}

function Readout({ value }: { value: PackageValue }) {
  if (value === null || value === undefined || value === '') return <span className="complete-package-unknown">Unavailable</span>
  if (typeof value === 'boolean') return <span>{value ? 'Yes' : 'No'}</span>
  if (typeof value === 'number') return <span>{String(value)}</span>
  if (typeof value === 'string') return /^https:\/\/\S+$/.test(value) ? <a href={value} target="_blank" rel="noreferrer">{value}</a> : <p>{value}</p>
  if (Array.isArray(value)) return value.length ? <ul>{value.map((item, index) => <li key={index}><Readout value={item} /></li>)}</ul> : <p>No saved observations.</p>
  return <dl className="complete-package-data">{Object.entries(value).map(([key, item]) => <div key={key}><dt>{title(key)}</dt><dd><Readout value={item} /></dd></div>)}</dl>
}
