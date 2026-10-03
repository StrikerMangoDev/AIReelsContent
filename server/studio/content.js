import { z } from 'zod'
import { generateJson } from '../providers/llm.js'
import { readFileSync } from 'node:fs'
const managerPrompt = readFileSync(new URL('../prompts/social-manager.md', import.meta.url), 'utf8')

export const settingsSchema = z.object({ industry: z.string().trim().min(1).max(100).default('AI'), audience: z.string().trim().min(1).max(300).default('Curious professionals'), language: z.string().min(1).max(80).default('English'), tone: z.string().min(1).max(100).default('Clear and factual'), platform: z.string().min(1).max(80).default('Reels'), duration: z.coerce.number().int().min(15).max(180).default(60), voice: z.enum(['Auto', 'Female', 'Male']).default('Auto') }).strict()
const text = z.string().trim().min(1).max(12000)
export const strategySchema = z.object({
  angle: text, audience: text, whyNow: text, factCheck: text,
  language: z.enum(['English', 'Hindi', 'Hinglish']), languageReason: text,
  voice: z.enum(['Female', 'Male']), voiceReason: text, delivery: text,
  keywords: z.array(z.string().min(1).max(100)).min(1).max(15),
  platforms: z.array(z.object({ platform: z.enum(['LinkedIn', 'Instagram', 'YouTube']), headline: text,
    hook: text, body: text, cta: text, hashtags: z.array(z.string().max(100)).max(8),
    thumbnail: text, format: text, retentionPlan: text, alternativeHook: text, testPlan: text,
  }).strict()).length(3),
  production: z.object({ videoPrompt: text, audioPrompt: text, musicDirection: text, subtitleStyle: text, editingNotes: text }).strict(),
  experiments: z.array(z.object({ variable: text, variantA: text, variantB: text, metric: text, decisionRule: text }).strict()).min(1).max(5),
}).strict()
export const contentSchema = z.object({
  hooks: z.array(text).min(1).max(5), script: text,
  scenes: z.array(z.object({ timing: text, narration: text, onScreen: text, visualPrompt: text, voiceDirection: text }).strict()).min(1).max(20),
  captions: z.object({ reel: text, linkedin: text }).strict(), website: z.object({ title: text, body: text }).strict(),
  claims: z.array(z.object({ id: z.string().regex(/^C\d+$/), text, evidenceId: z.string().max(50), quote: text, status: z.literal('attributed') }).strict()).min(1).max(30),
  strategy: strategySchema.optional(),
}).strict()

export function reviewContent(content, evidence) {
  const issues = []
  if (Buffer.byteLength(JSON.stringify(content)) > 90000) issues.push('Content exceeds the editable package size limit.')
  const parsed = contentSchema.safeParse(content)
  if (!parsed.success) return { issues: ['Content is incomplete or does not match the production schema.'], checkedAt: new Date().toISOString() }
  const narration = value => value.replace(/\s*\[C\d+\]/g, '').normalize('NFKC').replace(/\s+/g, ' ').trim()
  if (narration(content.script) !== narration(content.scenes.map(scene => scene.narration).join(' '))) issues.push('Scene narration does not match the saved script. Regenerate the package to synchronize production and platform content.')
  const ids = new Set()
  const normalize = value => value.replace(/\s+/g, ' ').trim()
  for (const claim of parsed.data.claims) {
    const source = evidence.find(item => item.id === claim.evidenceId)
    if (ids.has(claim.id)) issues.push(`Duplicate claim identifier: ${claim.id}`)
    ids.add(claim.id)
    if (!source || claim.quote.length < 12 || !normalize(source.excerpt).includes(normalize(claim.quote))) issues.push(`${claim.id}: quotation does not match the cited evidence.`)
  }
  const fields = { script: content.script, website: content.website.body, reel: content.captions.reel, linkedin: content.captions.linkedin, ...Object.fromEntries(content.hooks.map((hook, index) => [`hook ${index + 1}`, hook])), ...Object.fromEntries(content.scenes.map((scene, index) => [`scene ${index + 1}`, scene.narration])) }
  for (const [field, body] of Object.entries(fields)) {
    const citations = [...body.matchAll(/\[(C\d+)\]/g)].map(match => match[1])
    if (!citations.length) issues.push(`${field}: add inline claim references such as [C1].`)
    if (citations.some(id => !ids.has(id))) issues.push(`${field}: references an unknown claim.`)
  }
  const allText = JSON.stringify(content)
  if (content.strategy) {
    if (new Set(content.strategy.platforms.map(item => item.platform)).size !== 3) issues.push('Provide one adaptation for each of LinkedIn, Instagram and YouTube.')
    for (const item of content.strategy.platforms) {
      if (![item.headline, item.hook, item.body, item.alternativeHook].every(value => /\[C\d+\]/.test(value))) issues.push(`${item.platform}: headlines, hooks and body need claim references.`)
    }
  }
  if ([...allText.matchAll(/\[(C\d+)\]/g)].some(match => !ids.has(match[1]))) issues.push('Content references an unknown claim identifier.')
  if (/https?:\/\//i.test(allText)) issues.push('Use claim references instead of unreviewed links in generated content.')
  return { issues, checkedAt: new Date().toISOString(), limitations: ['Automated checks verify quotation and citation integrity, not factual truth or complete claim coverage. Human editorial review is required.'] }
}

export async function generateContent(evidence, settings, context = {}, generate = generateJson) {
  const request = { input: { evidence, settings, context },
    system: `${managerPrompt}\nCreate a complete content package strictly from supplied evidence. Settings and context guide creativity but are not factual evidence. Every factual statement must map to a claim. Include [C1] style references in scripts, captions, hooks, website body AND platform headlines, hooks, alternative hooks and body. Each claim must include an exact supporting passage from the excerpt; for search-grounded-summary this is a quote from a model summary, not from the publisher. Keep claims attributed, never independently verified. Provide three hooks, a duration-appropriate script, scene timings/narration/onScreen/visualPrompt/voiceDirection, captions and a website draft. Scene narration must concatenate to the full script apart from citation markers; use 3 to 6 scenes with numeric second ranges covering the requested duration. Choose a realistic speaking pace for the chosen language. The strategy must provide exactly one LinkedIn, Instagram and YouTube adaptation, each with headline, hook, platform-ready body, CTA, hashtags, thumbnail direction, format, retention beats and a concrete A/B test. Keep the core facts consistent. Explain language and voice as audience-fit recommendations to test, not performance facts. Respect explicit preferences; Auto means infer from the brief. Include reusable video/audio prompts, subtitle, music and editing directions. Experiments must define observable metrics and avoid predicting views. Illustrative visuals must never impersonate documentary evidence. The audio prompt must describe delivery and then include the clean narration without citation markers. Do not include external URLs; sources are attached separately. Provide JSON only.`,
    schema: z.toJSONSchema(contentSchema.extend({ strategy: strategySchema })), maxTokens: 16000,
  }
  let issues = []
  // One correction for editorial errors; provider/quota errors propagate without retries.
  for (let attempt = 0; attempt < 2; attempt++) {
    const content = contentSchema.parse(await generate(request))
    content.script = content.scenes.map(scene => scene.narration).join(' ')
    issues = reviewContent(content, evidence).issues
    if (!issues.length) return content
    request.input = { evidence, settings, context, draft: content, corrections: issues,
      instruction: 'Fix every listed validation issue. Put [C1] or another supported claim marker in EVERY hook, scene narration, caption, website body, platform headline, platform hook, platform alternativeHook and platform body. Copy scene narrations in order separated by spaces to form script EXACTLY. Keep quotes verbatim. Return the full corrected JSON package.' }
  }
  throw Object.assign(new Error('Generated content failed evidence validation; existing draft was preserved'), { code: 'EVIDENCE_VALIDATION', issueCount: issues.length, issues })
}
