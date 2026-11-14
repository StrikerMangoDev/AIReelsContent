import type { CompletePackage, PackageContext, PackagePlatform, StrategyDestination, StrategyWorkflowReport } from '@/services/complete-package'

type RecordValue = string | number | boolean | string[] | undefined
type FieldsValue = Record<string, RecordValue>
type Field = { key: string; title: string; type?: 'text' | 'textarea' | 'number' | 'datetime-local' | 'url' | 'checkbox' | 'select' | 'refs'; options?: string[]; min?: number; max?: number; optional?: boolean; help?: string }
const f = (key: string, title: string, type: Field['type'] = 'text', rest: Partial<Field> = {}): Field => ({ key, title, type, ...rest })
const title = (value: string) => value.replace(/([a-z])([A-Z])/g, '$1 $2').replaceAll('_', ' ').replaceAll('-', ' ').replace(/^./, first => first.toUpperCase())
const date = () => new Date().toISOString()
const localDate = (value: RecordValue) => typeof value === 'string' && value ? new Date(Date.parse(value) - new Date(value).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : ''
const questionFields = [f('question', 'Audience question / test hypothesis', 'textarea'), f('source', 'Where it came from', 'select', { options: ['comment', 'dm', 'faq', 'poll', 'search', 'consultation', 'community', 'editorial-hypothesis'] }), f('occurrences', 'Observed occurrences', 'number', { min: 1 }), f('audience', 'Audience / familiarity'), f('observedAt', 'Observed at', 'datetime-local'), f('sourceUrl', 'Public source URL (optional)', 'url', { optional: true }), f('hypothesis', 'Audience need is an editorial test hypothesis', 'checkbox'), f('basisNote', 'Basis and uncertainty (required for editorial hypothesis)', 'textarea', { optional: true }), f('anonymized', 'I removed identifying and private details', 'checkbox')]
const researchFields = [f('type', 'Research type', 'select', { options: ['audience', 'competitor', 'trend', 'fact', 'poll'] }), f('url', 'Source URL', 'url'), f('observedAt', 'Observed at', 'datetime-local'), f('observation', 'What we actually saw or heard', 'textarea'), f('interpretation', 'What it might mean', 'textarea'), f('response', 'Possible content response', 'textarea'), f('confidence', 'Confidence', 'select', { options: ['low', 'medium', 'high'] }), f('hypothesis', 'Interpretation is an untested hypothesis', 'checkbox')]
const trendFields = [f('query', 'Exact search query'), f('region', 'Trend region'), f('periodStart', 'Trend period starts', 'datetime-local'), f('periodEnd', 'Trend period ends', 'datetime-local'), f('recheckAt', 'Recheck before publishing', 'datetime-local')]
const candidateFields = [f('topic', 'Topic'), f('angle', 'Distinct angle', 'textarea'), f('rationale', 'Why this audience, account and moment?', 'textarea'), f('selected', 'Selected for this package', 'checkbox')]
const scoreFields = [f('topicFit', 'Topic fit'), f('audienceUsefulness', 'Audience usefulness'), f('brandFit', 'Brand fit'), f('evidence', 'Evidence'), f('timing', 'Timing'), f('effort', 'Production effort · 0 easy, 5 costly'), f('risk', 'Risk · 0 low, 5 high')].map(field => ({ ...field, type: 'number' as const, min: 0, max: 5 }))
const communityFields = [f('owner', 'Community reply owner'), f('responseGuidance', 'Approved response guidance', 'textarea'), f('escalationOwner', 'Escalation owner'), f('escalationRules', 'When to escalate / route inquiries', 'textarea')]
const caseFields = [f('kind', 'Conversation type', 'select', { options: ['question', 'spam', 'abuse', 'booking', 'sensitive'] }), f('summary', 'Anonymized summary', 'textarea'), f('status', 'Handling status', 'select', { options: ['open', 'answered', 'escalated', 'closed'] }), f('owner', 'Handling owner'), f('note', 'Response / moderation / escalation note', 'textarea'), f('anonymized', 'I removed identifying and private details', 'checkbox')]
const learningFields = [f('action', 'Next-cycle action', 'select', { options: ['repeat', 'change', 'stop', 'test', 'investigate'] }), f('topic', 'Topic / content pattern'), f('observation', 'What happened, including uncertainty', 'textarea'), f('nextAction', 'What changes in the next brief?', 'textarea'), f('variable', 'One variable to test (required for test)', 'text', { optional: true }), f('reviewedAt', 'Reviewed at', 'datetime-local'), f('reviewer', 'Review owner'), f('status', 'Decision status', 'select', { options: ['proposed', 'adopted'] }), f('basis', 'Decision basis', 'select', { options: ['hypothesis', 'measured'] }), f('reviewWindowHours', 'Measurement window (hours)', 'number', { min: 1, max: 2160 })]
const checklistFields = [f('originalityChecked', 'Distinct angle and original creative checked', 'checkbox'), f('hookFulfilled', 'Hook promise fulfilled by the content', 'checkbox'), f('phonePreviewChecked', 'Actual asset previewed on a phone', 'checkbox'), f('soundOffChecked', 'Actual video checked with sound off', 'checkbox'), f('linksChecked', 'Final links and destination checked', 'checkbox'), f('livePostInspected', 'Actual live post inspected', 'checkbox'), f('sensitiveEventCheckedAt', 'Final fact-date, sensitive-event and timing check', 'datetime-local', { optional: true }), f('liveUrl', 'Inspected live post URL (optional)', 'url', { optional: true })]
const textLimits: Record<string, number> = { question: 500, audience: 300, query: 200, region: 100, topic: 300, angle: 500, phrase: 150, reviewer: 200, owner: 200, escalationOwner: 200, variable: 300, kpi: 200, targetAction: 500, summary: 500 }
const goalMetrics = { reach: ['reach', 'impressions', 'views', 'shares', 'shareRate', 'averageWatchSeconds', 'averagePercentageViewed'], trust: ['saves', 'saveRate', 'comments'], engagement: ['likes', 'comments', 'shares', 'saves', 'engagementRateByReach', 'shareRate', 'saveRate'], traffic: ['clicks', 'clickThroughRate'], conversion: ['conversions', 'conversionRateByClick'] }

export function StudioStrategyWorkflow({ context, platform, accountId, contentHash, report, trendIntakes = [], disabled, onChange }: { context: PackageContext; platform: PackagePlatform; accountId: string; contentHash: string; report?: StrategyWorkflowReport; trendIntakes?: CompletePackage['trendIntakes']; disabled: boolean; onChange: (next: PackageContext) => void }) {
  const destination = context.workflow?.destinations.find(entry => entry.platform === platform && entry.accountId === accountId)
  const current = destination || { platform, accountId }
  const saved = report?.destinations.find(entry => entry.platform === platform && entry.accountId === accountId)
  const update = (patch: Partial<StrategyDestination>) => {
    if (disabled || !accountId) return
    onChange({ ...context, workflow: { version: 'strategy-workflow-v1', destinations: [...(context.workflow?.destinations || []).filter(entry => entry.platform !== platform || entry.accountId !== accountId), { ...current, ...patch }] } })
  }
  const questions = current.audienceQuestions || []
  const research = current.researchLog || []
  const metrics = (context.metrics || []).filter(entry => entry.platform === platform && entry.accountId === accountId)
  const locked = disabled || !accountId
  return <div className="strategy-workflow">
    <p>Plan, check and learn for <strong>{platform}</strong> · {accountId || 'no destination selected'}. Each account keeps its own strategy.</p>
    {!accountId && <p className="complete-package-warning">Choose this platform’s destination in Brief &amp; research before adding workflow records.</p>}
    <p className="studio-muted">Save all context changes to update these checks. Research and community records are supplied by your team; this view does not collect private messages or send replies.</p>
    <details className="complete-package-edit" open={!destination}><summary>Workflow checks <span>{saved ? title(saved.status) : 'Not started'}</span></summary>
      {saved ? <ol className="strategy-workflow-steps">{saved.steps.map(step => <li key={step.id}><strong>{step.title}</strong><span>{title(step.status)}</span><p>{step.detail}</p></li>)}</ol> : <p>Add the strategy records below, then save context to see the checks for the complete workflow.</p>}
      {Boolean(saved?.issues.length) && <ul>{saved?.issues.map(issue => <li key={issue}>{issue}</li>)}</ul>}
    </details>
    {saved?.machineAssessment && <details className="complete-package-edit"><summary>Machine checks for this saved media</summary><p>Server checks are separate from the team’s reported previews and any required subject-expert approval.</p><p>Checked {new Date(saved.machineAssessment.checkedAt).toLocaleString()} · Expires {new Date(saved.machineAssessment.expiresAt).toLocaleString()}</p><ul>{Object.entries(saved.machineAssessment.checks).map(([key, passed]) => <li key={key}>{title(key)}: {passed ? 'Passed' : 'Needs attention'}</li>)}</ul><ul>{saved.machineAssessment.limitations.map(item => <li key={item}>{item}</li>)}</ul><details><summary>Content and media binding</summary><p>Content: {saved.machineAssessment.contentHash}</p><p>Media manifest: {saved.machineAssessment.manifestHash}</p></details></details>}
    <details className="complete-package-edit"><summary>Official public trend captures</summary><p>Captures use the saved country in Brief &amp; research. Global or missing country has no inferred feed; traffic buckets do not establish growth or virality.</p>{trendIntakes.filter(item => item.platform === platform && item.accountId === accountId).length ? trendIntakes.filter(item => item.platform === platform && item.accountId === accountId).map(item => <article className="complete-package-record" key={item.id}><h4>{item.country || 'Country not selected'} · {title(item.status)}</h4><p>{item.reason}</p><p>Topic: {item.topic}. Captured {new Date(item.capturedAt).toLocaleString()} · {title(item.freshness)}.</p>{item.sourceUrl && <a href={item.sourceUrl} target="_blank" rel="noreferrer">Official RSS source</a>}{item.matches.map(match => <p key={match.id}><strong>{match.query}</strong> · Reported approximate traffic bucket: {match.approximateTraffic || 'Unavailable'}. {match.matchBasis}</p>)}<ul>{item.limitations.map(value => <li key={value}>{value}</li>)}</ul></article>) : <p>No saved official trend capture for this account and package. Automatic intake needs a consented account plan and an explicit country.</p>}</details>
    <fieldset disabled={locked}>
      <details className="complete-package-edit"><summary>Goal, audience action &amp; review window</summary>
        {!current.goal ? <button type="button" onClick={() => update({ goal: { primary: 'reach', kpi: '', targetAction: '', reviewAfterHours: 48 } })}>Define the primary goal</button> : <>
          <Fields fields={[f('primary', 'One primary goal', 'select', { options: ['reach', 'trust', 'engagement', 'traffic', 'conversion'] }), f('kpi', 'Matching success metric', 'select', { options: ['', ...goalMetrics[current.goal.primary], ...(current.goal.kpi && !goalMetrics[current.goal.primary].includes(current.goal.kpi) ? [current.goal.kpi] : [])] }), f('targetAction', 'Intended audience action'), f('reviewAfterHours', 'Review after publication (hours)', 'number', { min: 1, max: 2160 }), f('reviewDueAt', 'Review deadline (optional)', 'datetime-local', { optional: true })]} value={current.goal} onChange={value => update({ goal: value as StrategyDestination['goal'] })} />
          {current.goal.kpi && !goalMetrics[current.goal.primary].includes(current.goal.kpi) && <p className="complete-package-warning">Choose a metric matching {current.goal.primary}: {goalMetrics[current.goal.primary].join(', ')}.</p>}
          <p>A review window defines when to compare similar posts. Proxy metrics do not prove trust or business outcomes.</p>
        </>}
      </details>
      <details className="complete-package-edit"><summary>Audience question bank <span>{questions.length}/30 records</span></summary>
        <p>Record recurring needs in the audience’s words. An editorial hypothesis needs a source link, a basis note and 0 observed occurrences; it does not establish account demand. Remove names, handles and private details.</p>
        <Records entries={questions} name="audience question" onRemove={index => update({ audienceQuestions: questions.filter((_entry, i) => i !== index) })} render={(entry, index) => <Fields fields={questionFields.map(field => entry.source === 'editorial-hypothesis' ? field.key === 'occurrences' ? { ...field, min: 0, max: 0 } : field.key === 'sourceUrl' ? { ...field, title: 'Source link for this test question', optional: false } : field.key === 'basisNote' ? { ...field, optional: false } : field : field)} value={entry} onChange={value => {
          if (value.source === 'editorial-hypothesis') { value.occurrences = 0; value.hypothesis = true }
          else if (entry.source === 'editorial-hypothesis' && value.occurrences === 0) value.occurrences = 1
          update({ audienceQuestions: questions.map((row, i) => i === index ? value as typeof entry : row) })
        }} />} />
        <button type="button" disabled={questions.length >= 30} onClick={() => update({ audienceQuestions: [...questions, { id: crypto.randomUUID(), question: '', source: 'faq', occurrences: 1, audience: '', observedAt: date(), anonymized: false }] })}>Add anonymized audience question</button>
      </details>
      <details className="complete-package-edit"><summary>Research, competitors &amp; trends <span>{research.length}/30 records</span></summary>
        <p>Keep observation separate from interpretation. Public engagement is not proof of sales; trend records need actual query, place and time evidence.</p>
        {!current.trendDecision ? <button type="button" onClick={() => update({ trendDecision: { mode: 'not_relevant', reason: '' } })}>Record trend relevance</button> : <Fields fields={[f('mode', 'Does this idea depend on a trend?', 'select', { options: ['not_relevant', 'use_signal'] }), f('reason', 'Why use this trend or choose evergreen content?', 'textarea')]} value={current.trendDecision} onChange={value => update({ trendDecision: value as StrategyDestination['trendDecision'] })} />}
        <Records entries={research} name="research record" onRemove={index => update({ researchLog: research.filter((_entry, i) => i !== index) })} render={(entry, index) => {
          const change = (patch: Partial<typeof entry>) => update({ researchLog: research.map((row, i) => i === index ? { ...entry, ...patch } : row) })
          return <><Fields fields={researchFields} value={entry as unknown as FieldsValue} onChange={value => {
            const next = value as unknown as typeof entry
            if (next.type === 'trend' && !next.trend) next.trend = { query: '', region: '', periodStart: date(), periodEnd: date(), recheckAt: date() }
            if (next.type !== 'trend') next.trend = undefined
            change(next)
          }} /><References title="Supporting audience questions" options={questions.map(row => ({ id: row.id, label: row.question || 'Untitled question' }))} value={entry.questionIds} onChange={questionIds => change({ questionIds })} />
            {entry.type === 'trend' && <Fields fields={trendFields} value={entry.trend || {}} onChange={value => change({ trend: value as typeof entry.trend })} />}
          </>
        }} />
        <button type="button" disabled={research.length >= 30} onClick={() => update({ researchLog: [...research, { id: crypto.randomUUID(), type: 'fact', url: '', observedAt: date(), observation: '', interpretation: '', response: '', confidence: 'low', hypothesis: true, questionIds: [] }] })}>Add research record</button>
      </details>
      <details className="complete-package-edit"><summary>Topic selection &amp; scoring <span>{current.candidates?.length || 0}/20 candidates</span></summary>
        <p>Editorial scores are judgments, not measured popularity. Rate fit, usefulness, brand, evidence and timing from 0–5; lower effort and risk are preferable.</p>
        <Records entries={current.candidates || []} name="topic candidate" onRemove={index => update({ candidates: (current.candidates || []).filter((_entry, i) => i !== index) })} render={(entry, index) => {
          const change = (patch: Partial<typeof entry>) => update({ candidates: (current.candidates || []).map((row, i) => i === index ? { ...entry, ...patch } : row) })
          const scored = saved?.candidates.find(row => row.id === entry.id)
          return <><Fields fields={candidateFields} value={entry as unknown as FieldsValue} onChange={value => change(value)} /><Fields fields={scoreFields} value={entry.scores} onChange={value => change({ scores: value as typeof entry.scores })} /><References title="Research supporting this candidate" options={research.map(row => ({ id: row.id, label: row.observation || 'Untitled research' }))} value={entry.researchIds} onChange={researchIds => change({ researchIds })} /><References title="Audience questions answered" options={questions.map(row => ({ id: row.id, label: row.question || 'Untitled question' }))} value={entry.questionIds} onChange={questionIds => change({ questionIds })} />{scored && <p>Last saved editorial score: <strong>{scored.score}/{scored.maxScore}</strong> · {scored.formula}</p>}</>
        }} />
        <button type="button" disabled={(current.candidates || []).length >= 20} onClick={() => update({ candidates: [...current.candidates || [], { id: crypto.randomUUID(), topic: '', angle: '', rationale: '', researchIds: [], questionIds: [], selected: false, scores: { topicFit: 0, audienceUsefulness: 0, brandFit: 0, evidence: 0, timing: 0, effort: 0, risk: 0 } }] })}>Add topic candidate</button>
      </details>
      <details className="complete-package-edit"><summary>Search language &amp; placement <span>{current.keywords?.length || 0}/20 phrases</span></summary>
        <p>Use terms the content actually explains. Record audience/search evidence rather than assume search demand.</p>
        <Records entries={current.keywords || []} name="keyword" onRemove={index => update({ keywords: (current.keywords || []).filter((_entry, i) => i !== index) })} render={(entry, index) => {
          const change = (patch: Partial<typeof entry>) => update({ keywords: (current.keywords || []).map((row, i) => i === index ? { ...entry, ...patch } : row) })
          return <><Fields fields={[f('phrase', 'Primary / supporting phrase'), f('rationale', 'Why this phrase matches the audience and content', 'textarea')]} value={entry} onChange={change} /><References title="Natural placement" options={['spoken', 'on-screen', 'caption', 'title'].map(id => ({ id, label: title(id) }))} value={entry.placements} onChange={placements => change({ placements: placements as typeof entry.placements })} /><References title="Supporting research" options={research.map(row => ({ id: row.id, label: row.observation || 'Untitled research' }))} value={entry.researchIds} onChange={researchIds => change({ researchIds })} /></>
        }} />
        <button type="button" disabled={(current.keywords || []).length >= 20} onClick={() => update({ keywords: [...current.keywords || [], { phrase: '', placements: [], rationale: '', researchIds: [] }] })}>Add search phrase</button>
      </details>
      <details className="complete-package-edit"><summary>Expert review &amp; pre/post-publish checks</summary>
        <p>Record a real review when required. AI review does not establish subject-expert approval; preview checks describe the actual asset.</p>
        <p>The final fact-date and sensitive-event check must be within 24 hours of publishing. Live-post inspection happens after publication.</p>
        {!current.expertReview ? <button type="button" onClick={() => update({ expertReview: { required: false, status: 'not_required' } })}>Record expert-review requirement</button> : <>
          <Fields fields={[f('required', 'Subject-expert sign-off required', 'checkbox'), f('status', 'Actual review status', 'select', { options: ['not_required', 'pending', 'approved', 'rejected'] }), f('reviewer', 'Accountable expert (if required)', 'text', { optional: true }), f('reviewedAt', 'Actual review time (if reviewed)', 'datetime-local', { optional: true }), f('note', 'Review scope / limits', 'textarea', { optional: true })]} value={current.expertReview} onChange={value => update({ expertReview: { ...value as NonNullable<StrategyDestination['expertReview']>, ...(value.status === 'approved' && current.expertReview?.status !== 'approved' ? { contentHash } : {}) } })} />
          {current.expertReview.status === 'approved' && current.expertReview.contentHash !== contentHash && <><p className="complete-package-warning">The saved approval does not cover this content revision.</p><button type="button" onClick={() => update({ expertReview: { ...current.expertReview!, contentHash } })}>Confirm actual expert approval for this saved content</button></>}
          <p>Approval is bound to the current saved content. Changed content needs a new review.</p>
        </>}
        {current.checklist?.contentHash !== contentHash && current.checklist && <p className="complete-package-warning">Execution checks do not cover this saved content revision. Rechecking starts a fresh checklist; previous confirmations are cleared.</p>}
        {!current.checklist ? <button type="button" onClick={() => update({ checklist: { originalityChecked: false, hookFulfilled: false, phonePreviewChecked: false, soundOffChecked: false, linksChecked: false, livePostInspected: false } })}>Start execution checklist</button> : <Fields fields={checklistFields} value={current.checklist} onChange={(value, changedKey) => {
          const checks = current.checklist?.contentHash === contentHash ? value : { originalityChecked: false, hookFulfilled: false, phonePreviewChecked: false, soundOffChecked: false, linksChecked: false, livePostInspected: false, ...(changedKey ? { [changedKey]: value[changedKey] } : {}) }
          update({ checklist: { ...checks, contentHash } as StrategyDestination['checklist'] })
        }} />}
      </details>
      <details className="complete-package-edit"><summary>Community replies, moderation &amp; escalation</summary>
        {!current.community ? <button type="button" onClick={() => update({ community: { owner: '', responseGuidance: '', escalationOwner: '', escalationRules: '', cases: [] } })}>Set community responsibilities</button> : <>
          <Fields fields={communityFields} value={current.community as unknown as FieldsValue} onChange={value => update({ community: value as unknown as NonNullable<StrategyDestination['community']> })} />
          <p>Use anonymized summaries. Handle actual replies in the connected platform; no reply or moderation action is sent here.</p>
          <Records entries={current.community.cases} name="conversation" onRemove={index => update({ community: { ...current.community!, cases: current.community!.cases.filter((_entry, i) => i !== index) } })} render={(entry, index) => <Fields fields={caseFields} value={entry} onChange={value => update({ community: { ...current.community!, cases: current.community!.cases.map((row, i) => i === index ? value as typeof entry : row) } })} />} />
          <button type="button" disabled={current.community.cases.length >= 30} onClick={() => update({ community: { ...current.community!, cases: [...current.community!.cases, { id: crypto.randomUUID(), kind: 'question', summary: '', status: 'open', owner: '', note: '', anonymized: false }] } })}>Add anonymized conversation</button>
        </>}
      </details>
      <details className="complete-package-edit"><summary>Results → next-cycle decisions <span>{current.learnings?.length || 0}/30 decisions</span></summary>
        <p>Compare the goal KPI over a matching window. Keep unsuccessful tests too. Adopted eligible decisions guide the next account plan; one result does not establish a universal rule.</p>
        <Records entries={current.learnings || []} name="learning decision" onRemove={index => update({ learnings: (current.learnings || []).filter((_entry, i) => i !== index) })} render={(entry, index) => {
          const change = (patch: Partial<typeof entry>) => update({ learnings: (current.learnings || []).map((row, i) => i === index ? { ...entry, ...patch } : row) })
          const learned = saved?.learnings.find(row => row.id === entry.id)
          return <><Fields fields={learningFields} value={entry} onChange={change} /><References title="Matching performance observations" options={metrics.map(row => ({ id: row.observationId, label: `${row.postId} · ${new Date(row.measuredAt).toLocaleString()}` }))} value={entry.metricIds} onChange={metricIds => change({ metricIds })} />{learned && <p>Last saved automation eligibility: <strong>{learned.eligibleForAutomation ? 'Eligible' : 'Not eligible'}</strong>. {learned.reason}</p>}</>
        }} />
        <button type="button" disabled={(current.learnings || []).length >= 30} onClick={() => update({ learnings: [...current.learnings || [], { id: crypto.randomUUID(), action: 'investigate', topic: '', observation: '', nextAction: '', metricIds: [], reviewedAt: date(), reviewer: '', status: 'proposed', basis: 'hypothesis', reviewWindowHours: 48 }] })}>Add learning decision</button>
      </details>
    </fieldset>
    {destination && <div className="complete-package-actions"><button type="button" disabled={locked} onClick={() => { if (!locked) onChange({ ...context, workflow: { version: 'strategy-workflow-v1', destinations: (context.workflow?.destinations || []).filter(entry => entry.platform !== platform || entry.accountId !== accountId) } }) }}>Remove this account strategy</button><p>Removes this account’s workflow records from the draft. Discard unsaved context to restore them before saving. Other accounts are preserved.</p></div>}
    {Boolean(report?.limitations.length) && <details className="complete-package-edit"><summary>What these checks can establish</summary><ul>{report?.limitations.map(item => <li key={item}>{item}</li>)}</ul></details>}
  </div>
}

function Fields({ fields, value, onChange }: { fields: Field[]; value: FieldsValue; onChange: (value: FieldsValue, changedKey?: string) => void }) {
  function set(field: Field, raw: string | boolean) {
    const next = { ...value }
    if (raw === '' && field.optional) delete next[field.key]
    else next[field.key] = field.type === 'datetime-local' ? raw ? new Date(String(raw)).toISOString() : '' : field.type === 'number' ? raw === '' ? '' : Number(raw) : raw
    onChange(next, field.key)
  }
  return <div className="complete-package-fields">{fields.map(field => {
    const input = value[field.key]
    const maxLength = field.type === 'url' ? 2000 : textLimits[field.key] || 1000
    if (field.type === 'checkbox') return <label className="complete-package-check" key={field.key}><input type="checkbox" name={field.key} required={field.key === 'anonymized'} checked={input === true} onChange={event => set(field, event.target.checked)} /><span>{field.title}</span></label>
    return <label key={field.key}>{field.title}{field.type === 'textarea' ? <textarea name={field.key} autoComplete="off" maxLength={maxLength} required={!field.optional} value={String(input ?? '')} onChange={event => set(field, event.target.value)} /> : field.type === 'select' ? <select name={field.key} required={!field.optional} value={String(input ?? '')} onChange={event => set(field, event.target.value)}>{field.options?.map(option => <option key={option} value={option}>{option ? title(option) : 'Choose a matching metric'}</option>)}</select> : <input name={field.key} autoComplete="off" type={field.type || 'text'} required={!field.optional} pattern={field.type === 'url' ? 'https://.*' : undefined} maxLength={maxLength} min={field.min} max={field.max} step={field.type === 'number' ? 1 : undefined} value={field.type === 'datetime-local' ? localDate(input) : String(input ?? '')} onChange={event => set(field, event.target.value)} />}{field.help && <span>{field.help}</span>}</label>
  })}</div>
}

function Records<T extends { id?: string; question?: string; topic?: string; phrase?: string; observation?: string; summary?: string }>({ entries, name, render, onRemove }: { entries: T[]; name: string; render: (value: T, index: number) => React.ReactNode; onRemove: (index: number) => void }) {
  return <>{!entries.length && <p>No {name} records yet.</p>}{entries.map((entry, index) => <details className="complete-package-draft-record" key={entry.id || index} open><summary>{title(name)} {index + 1}: {(entry.question || entry.topic || entry.phrase || entry.observation || entry.summary || 'Complete this record').slice(0, 100)}</summary>{entry.id && <p className="studio-muted">Reference: {entry.id}</p>}{render(entry, index)}<button type="button" onClick={() => onRemove(index)}>Remove {name} {index + 1}</button></details>)}</>
}

function References({ title: heading, options, value, onChange }: { title: string; options: { id: string; label: string }[]; value: string[]; onChange: (value: string[]) => void }) {
  const unknown = value.filter(id => !options.some(option => option.id === id))
  return <fieldset className="strategy-workflow-references"><legend>{heading}</legend>{!options.length && <p>No matching records yet.</p>}{value.length >= 20 && <p>Maximum 20 supporting references. Clear one before selecting another.</p>}{options.map(option => <label className="complete-package-check" key={option.id}><input type="checkbox" name={`${heading}:${option.id}`} checked={value.includes(option.id)} disabled={value.length >= 20 && !value.includes(option.id)} onChange={event => onChange(event.target.checked ? [...value, option.id] : value.filter(id => id !== option.id))} /><span>{option.label}</span></label>)}{unknown.map(id => <label className="complete-package-check" key={id}><input type="checkbox" name={`${heading}:${id}`} checked onChange={() => onChange(value.filter(ref => ref !== id))} /><span>Missing reference: {id}. Remove or restore its record.</span></label>)}</fieldset>
}
