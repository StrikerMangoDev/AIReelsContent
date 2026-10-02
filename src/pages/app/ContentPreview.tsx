/* eslint-disable react-refresh/only-export-components -- export formatting is shared with the workspace. */
import { useState } from 'react'
import type { StudioContent } from '@/services/studio-api'

export const cleanCopy = (text: string) => text.replace(/\s*\[C\d+\]/g, '').trim()

export function ContentPreview({ content }: { content: StudioContent }) {
  const [platform, setPlatform] = useState('Instagram')
  const [copied, setCopied] = useState('')
  const strategy = content.strategy
  const selected = strategy?.platforms.find(item => item.platform === platform)
  async function copy(value: string) {
    try { await navigator.clipboard.writeText(cleanCopy(value)); setCopied('Copied to clipboard.') } catch { setCopied('Clipboard unavailable. Select the text to copy it.') }
  }
  return <div className="content-preview">
    {strategy && <><div className="creative-summary"><span className="studio-eyebrow">THE CREATIVE DIRECTION</span><h2>{cleanCopy(strategy.angle)}</h2><p>{strategy.whyNow}</p><p className="studio-muted">For {strategy.audience}</p></div>
      <nav className="studio-tabs" aria-label="Platform preview">{['Instagram', 'YouTube', 'LinkedIn'].map(name => <button key={name} aria-pressed={platform === name} onClick={() => { setPlatform(name); setCopied('') }}>{name}</button>)}</nav>
      {selected && <article className="platform-preview"><span className="studio-eyebrow">{selected.format}</span><h2>{cleanCopy(selected.headline)}</h2><blockquote className="creative-hook">{cleanCopy(selected.hook)}</blockquote><p className="preserve-lines">{cleanCopy(selected.body)}</p><p><strong>{cleanCopy(selected.cta)}</strong></p><div className="keyword-list">{selected.hashtags.map((word, index) => <span key={index}>{word}</span>)}</div><button onClick={() => void copy([selected.headline, selected.body, selected.cta, selected.hashtags.join(' ')].join('\n\n'))}>Copy {platform} post</button>
        <details><summary>Hook variation & retention plan</summary><p><strong>Alternative hook:</strong> {cleanCopy(selected.alternativeHook)}</p><p><strong>Keep people watching:</strong> {selected.retentionPlan}</p><p><strong>Thumbnail / cover:</strong> {selected.thumbnail}</p><p><strong>Test:</strong> {selected.testPlan}</p></details>
      </article>}
      <p role="status">{copied}</p>
      <div className="reaction-columns"><div><h3>{strategy.language} narration</h3><p>{strategy.languageReason}</p></div><div><h3>{strategy.voice} voice · {strategy.delivery}</h3><p>{strategy.voiceReason}</p></div></div>
      <p className="studio-muted">Voice and language are creative recommendations, not proven performance winners.</p>
      <details><summary>Keywords & experiments</summary><p>Suggested keywords; search volume has not been measured.</p><div className="keyword-list">{strategy.keywords.map((word, index) => <span key={index}>{word}</span>)}</div>{strategy.experiments.map((test, index) => <article className="studio-evidence" key={index}><h3>{test.variable}</h3><p>A: {test.variantA}</p><p>B: {test.variantB}</p><p>Measure: {test.metric}</p><p>{test.decisionRule}</p></article>)}</details>
      <details><summary>Fact-check notes</summary><p>{strategy.factCheck}</p></details>
    </>}
    <details open={!strategy}><summary>Full narration & hooks</summary>{content.hooks.map((hook, index) => <blockquote key={index}>{cleanCopy(hook)}</blockquote>)}<p className="preserve-lines">{cleanCopy(content.script)}</p><button onClick={() => void copy(content.script)}>Copy clean narration</button></details>
  </div>
}

export function contentMarkdown(title: string, content: StudioContent, evidence: { id: string; title: string; url: string; limitations: string[] }[]) {
  const strategy = content.strategy
  return [`# ${title}`, '## Narration', cleanCopy(content.script), '## Hooks', ...content.hooks.map(cleanCopy),
    ...(strategy ? ['## Creative direction', strategy.angle, strategy.whyNow, `Audience: ${strategy.audience}`, `Language: ${strategy.language} — ${strategy.languageReason}`, `Voice: ${strategy.voice} — ${strategy.delivery}`, strategy.voiceReason,
      ...strategy.platforms.flatMap(item => [`## ${item.platform}`, `### ${cleanCopy(item.headline)}`, `Hook: ${cleanCopy(item.hook)}`, cleanCopy(item.body), cleanCopy(item.cta), item.hashtags.join(' '), `Alternative hook: ${cleanCopy(item.alternativeHook)}`, `Retention: ${item.retentionPlan}`, `Thumbnail: ${item.thumbnail}`, `Test: ${item.testPlan}`]),
      '## Suggested keywords (not measured search volume)', strategy.keywords.join(', '), '## Production prompts', ...Object.entries(strategy.production).map(([key, value]) => `### ${key}\n${cleanCopy(value)}`),
      '## Experiments', ...strategy.experiments.map(item => `${item.variable}\nA: ${item.variantA}\nB: ${item.variantB}\nMetric: ${item.metric}\n${item.decisionRule}`), '## Fact-check notes', strategy.factCheck] : []),
    '## Scene plan', ...content.scenes.map((scene, index) => `### Scene ${index + 1}: ${scene.timing}\n${cleanCopy(scene.narration)}\nOn screen: ${scene.onScreen}\nVisual: ${scene.visualPrompt}\nDelivery: ${scene.voiceDirection}`),
    '## Claims and evidence', ...content.claims.map(claim => `${claim.id}: ${claim.text}\n${claim.evidenceId}: ${claim.quote}`),
    '## Sources', ...evidence.map(item => `[${item.id}] ${item.title}: ${item.url}\n${item.limitations.join(' ')}`),
  ].join('\n\n')
}
