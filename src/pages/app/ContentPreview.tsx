/* eslint-disable react-refresh/only-export-components -- export formatting is shared with the workspace. */
import { useState } from 'react'
import type { StudioContent } from '@/services/studio-api'

export const cleanCopy = (text: string) => text.replace(/\s*\[C\d+\]/g, '').trim()

export function ContentPreview({ content }: { content: StudioContent }) {
  const [platform, setPlatform] = useState('Instagram')
  const [copied, setCopied] = useState('')
  const strategy = content.strategy
  const selected = strategy?.platforms?.find(item => item.platform === platform) ?? strategy?.platforms?.[0]
  async function copy(value: string) {
    try { await navigator.clipboard.writeText(cleanCopy(value)); setCopied('Draft copied. Use the approved export for a reviewed handoff.') } catch { setCopied('Clipboard unavailable. Select the text to copy it.') }
  }
  return <div className="content-preview">
    {strategy && <><div className="creative-summary"><span className="studio-eyebrow">THE CREATIVE DIRECTION</span><h2>{cleanCopy(strategy.angle)}</h2><p>{strategy.whyNow}</p><p className="studio-muted">For {strategy.audience}</p></div>
      <nav className="studio-tabs" aria-label="Platform preview">{(strategy.platforms || []).map(({ platform: name }) => <button key={name} aria-pressed={selected?.platform === name} onClick={() => { setPlatform(name); setCopied('') }}>{name}</button>)}</nav>
      {selected && <article className="platform-preview"><span className="studio-eyebrow">{selected.format}</span><h2>{cleanCopy(selected.headline)}</h2><blockquote className="creative-hook">{cleanCopy(selected.hook)}</blockquote><p className="preserve-lines">{cleanCopy(selected.body)}</p><p><strong>{cleanCopy(selected.cta)}</strong></p><div className="keyword-list">{selected.hashtags.map((word, index) => <span key={index}>{word}</span>)}</div><button onClick={() => void copy([selected.headline, selected.body, selected.cta, selected.hashtags.join(' ')].join('\n\n'))}>Copy draft {selected.platform} post</button>
        <details><summary>Hook variation & retention plan</summary><p><strong>Alternative hook:</strong> {cleanCopy(selected.alternativeHook)}</p><p><strong>Keep people watching:</strong> {selected.retentionPlan}</p><p><strong>Thumbnail / cover:</strong> {selected.thumbnail}</p><p><strong>Test:</strong> {selected.testPlan}</p></details>
      </article>}
      <p role="status">{copied}</p>
      <div className="reaction-columns"><div><h3>{strategy.language} narration</h3><p>{strategy.languageReason}</p></div><div><h3>{strategy.voice} voice · {strategy.delivery}</h3><p>{strategy.voiceReason}</p></div></div>
      <p className="studio-muted">Voice and language are creative recommendations, not proven performance winners.</p>
      <details><summary>Keywords & experiments</summary><p>Suggested keywords; search volume has not been measured.</p><div className="keyword-list">{strategy.keywords.map((word, index) => <span key={index}>{word}</span>)}</div>{(strategy.experiments || []).map((test, index) => <article className="studio-evidence" key={index}><h3>{test.variable}</h3><p>A: {test.variantA}</p><p>B: {test.variantB}</p><p>Measure: {test.metric}</p><p>{test.decisionRule}</p></article>)}</details>
      <details><summary>Source notes — check before publishing</summary><p>{strategy.factCheck}</p></details>
    </>}
    {content.script && <details open={!strategy}><summary>Full narration & hooks</summary>{(content.hooks || []).map((hook, index) => <blockquote key={index}>{cleanCopy(hook)}</blockquote>)}<p className="preserve-lines">{cleanCopy(content.script)}</p><button onClick={() => void copy(content.script || '')}>Copy draft narration</button></details>}
    {content.captions && <section><h2>Captions</h2><h3>Reel caption</h3><p className="preserve-lines">{cleanCopy(content.captions.reel)}</p><h3>LinkedIn caption</h3><p className="preserve-lines">{cleanCopy(content.captions.linkedin)}</p></section>}
    {content.website && <section><h2>{cleanCopy(content.website.title)}</h2><p className="preserve-lines">{cleanCopy(content.website.body)}</p></section>}
  </div>
}

export function contentMarkdown(title: string, content: StudioContent, evidence: { id: string; title: string; url: string; limitations: string[] }[], sections: readonly string[] = ['main', 'brief', 'keywords', 'alternatives', 'production']) {
  const strategy = content.strategy
  const has = (id: string) => sections.includes(id)
  return [`# ${title}`, ...(has('main') && content.script ? ['## Narration', cleanCopy(content.script)] : []), ...(has('alternatives') && content.hooks?.length ? ['## Hooks', ...content.hooks.map(cleanCopy)] : []), ...(has('main') && content.captions ? ['## Reel caption', cleanCopy(content.captions.reel), '## LinkedIn caption', cleanCopy(content.captions.linkedin)] : []), ...(has('main') && content.website ? ['## Website draft', cleanCopy(content.website.title), cleanCopy(content.website.body)] : []),
    ...(strategy ? [
      ...(has('brief') ? ['## Creative direction', strategy.angle, strategy.whyNow, `Audience: ${strategy.audience}`, `Language: ${strategy.language} — ${strategy.languageReason}`, `Voice: ${strategy.voice} — ${strategy.delivery}`, strategy.voiceReason] : []),
      ...(strategy.platforms || []).flatMap(item => [
        ...(has('main') || has('keywords') || has('alternatives') || has('production') ? [`## ${item.platform}`] : []),
        ...(has('main') ? [`### ${cleanCopy(item.headline)}`, `Hook: ${cleanCopy(item.hook)}`, cleanCopy(item.body), cleanCopy(item.cta)] : []),
        ...(has('keywords') ? [(item.hashtags || []).join(' ')] : []),
        ...(has('alternatives') ? [`Alternative hook: ${cleanCopy(item.alternativeHook)}`, `Retention: ${item.retentionPlan}`, `Test: ${item.testPlan}`] : []),
        ...(has('production') ? [`Thumbnail: ${item.thumbnail}`] : []),
      ]),
      ...(has('keywords') && strategy.keywords?.length ? ['## Suggested keywords (not measured search volume)', strategy.keywords.join(', ')] : []),
      ...(has('production') && strategy.production ? ['## Production prompts', ...Object.entries(strategy.production).map(([key, value]) => `### ${key}\n${cleanCopy(value)}`)] : []),
      ...(has('alternatives') && strategy.experiments?.length ? ['## Experiments', ...strategy.experiments.map(item => `${item.variable}\nA: ${item.variantA}\nB: ${item.variantB}\nMetric: ${item.metric}\n${item.decisionRule}`)] : []),
      '## Source notes — check before publishing', strategy.factCheck] : []),
    ...((has('main') || has('production')) && content.scenes?.length ? ['## Scene plan', ...content.scenes.map((scene, index) => [`### Scene ${index + 1}: ${scene.timing}`, ...(has('main') ? [cleanCopy(scene.narration), `On screen: ${scene.onScreen}`] : []), ...(has('production') ? [`Visual: ${scene.visualPrompt}`, `Delivery: ${scene.voiceDirection}`] : [])].join('\n'))] : []),
    '## Claims and evidence', ...content.claims.map(claim => `${claim.id}: ${claim.text}\n${claim.evidenceId}: ${claim.quote}`),
    '## Sources', ...evidence.map(item => `[${item.id}] ${item.title}: ${item.url}\n${item.limitations.join(' ')}`),
  ].join('\n\n')
}

