import { evidencePassages, resolvePassageClaims } from './evidence-passages.js'
import { z } from 'zod'
import { generateJson, retainGenerationReceipt } from '../providers/llm.js'
import { cleanCaption, xWeightedLength, renderSocialCaption } from '../publishing/constraints.js'
import { readFileSync } from 'node:fs'
const managerPrompt = readFileSync(new URL('../prompts/social-manager.md', import.meta.url), 'utf8')

export const platforms = ['Facebook', 'Instagram', 'X', 'LinkedIn', 'YouTube']
export const outputFormats = ['script', 'captions', 'website', 'platforms', 'production']
export const selectedOutputs = settings => settings.outputs || outputFormats
export function selectedPlatforms(settings) {
  // Existing saved Reels preferences describe Instagram, not three destinations.
  return (settings.platform || 'Instagram').split(',').map(value => value.trim() === 'Reels' ? 'Instagram' : value.trim())
}
const platformSelection = z.string().min(1).max(80).refine(value => {
  const selected = selectedPlatforms({ platform: value })
  return selected.length > 0 && selected.length <= platforms.length && new Set(selected).size === selected.length && selected.every(platform => platforms.includes(platform))
}, 'Select one or more distinct supported platforms')
export const settingsSchema = z.object({ industry: z.string().trim().min(1).max(100).default('AI'), audience: z.string().trim().min(1).max(300).default('Curious professionals'), language: z.string().min(1).max(80).default('English'), tone: z.string().min(1).max(100).default('Clear and factual'), platform: platformSelection.default('Instagram'), duration: z.coerce.number().int().min(15).max(180).default(60), voice: z.enum(['Auto', 'Female', 'Male']).default('Auto'), outputs: z.array(z.enum(outputFormats)).min(1).max(5).refine(value => new Set(value).size === value.length && (!value.includes('production') || value.includes('script')), 'Choose unique outputs; production requires a script').default(outputFormats) }).strict()
const text = z.string().trim().min(1).max(12000)
export const strategySchema = z.object({
  angle: text, audience: text, whyNow: text, factCheck: text,
  language: z.enum(['English', 'Hindi', 'Hinglish']), languageReason: text,
  voice: z.enum(['Female', 'Male']), voiceReason: text, delivery: text,
  keywords: z.array(z.string().min(1).max(100)).min(1).max(15),
  platforms: z.array(z.object({ platform: z.enum(platforms), headline: text,
    hook: text, body: text, cta: text, hashtags: z.array(z.string().max(100)).max(8),
    thumbnail: text, format: text, retentionPlan: text, alternativeHook: text, testPlan: text,
  }).strict()).min(1).max(5).optional(),
  production: z.object({ videoPrompt: text, audioPrompt: text, musicDirection: text, subtitleStyle: text, editingNotes: text }).strict().optional(),
  experiments: z.array(z.object({ variable: text, variantA: text, variantB: text, metric: text, decisionRule: text }).strict()).min(1).max(5).optional(),
}).strict()
export const contentSchema = z.object({
  hooks: z.array(text).min(1).max(5).optional(), script: text.optional(),
  scenes: z.array(z.object({ timing: text, narration: text, onScreen: text, visualPrompt: text, voiceDirection: text }).strict()).min(1).max(20).optional(),
  captions: z.object({ reel: text, linkedin: text }).strict().optional(), website: z.object({ title: text, body: text }).strict().optional(),
  claims: z.array(z.object({ id: z.string().regex(/^C\d+$/), text, evidenceId: z.string().max(50), quote: text, status: z.literal('attributed') }).strict()).min(1).max(30),
  strategy: strategySchema.optional(),
}).strict()

export function generationSchema(settings) {
  const outputs = selectedOutputs(settings)
  const fields = { claims: contentSchema.shape.claims }
  if (outputs.includes('script')) { fields.script = contentSchema.shape.script.unwrap(); fields.hooks = contentSchema.shape.hooks.unwrap() }
  if (outputs.includes('captions')) fields.captions = contentSchema.shape.captions.unwrap()
  if (outputs.includes('website')) fields.website = contentSchema.shape.website.unwrap()
  if (outputs.includes('production')) fields.scenes = contentSchema.shape.scenes.unwrap()
  if (outputs.includes('platforms') || outputs.includes('production')) {
    const strategy = strategySchema.omit({ platforms: true, production: true, experiments: true }).shape
    if (outputs.includes('platforms')) { strategy.platforms = strategySchema.shape.platforms.unwrap(); strategy.experiments = strategySchema.shape.experiments.unwrap() }
    if (outputs.includes('production')) strategy.production = strategySchema.shape.production.unwrap()
    fields.strategy = z.object(strategy).strict()
  }
  return z.object(fields).strict()
}

export function reviewContent(content, evidence, settings) {
  const issues = []
  if (Buffer.byteLength(JSON.stringify(content) || '') > 90000) issues.push('Content exceeds the editable package size limit.')
  const parsed = contentSchema.safeParse(content)
  if (!parsed.success) return { issues: ['Content is incomplete or does not match the production schema.'], checkedAt: new Date().toISOString() }
  if (settings && !generationSchema(settings).safeParse(content).success) issues.push('Content must contain exactly the selected output formats, including their required fields.')
  const narration = value => value.replace(/\s*\[C\d+\]/g, '').normalize('NFKC').replace(/\s+/g, ' ').trim()
  if (content.scenes && (!content.script || narration(content.script) !== narration(content.scenes.map(scene => scene.narration).join(' ')))) issues.push('Scene narration does not match the saved script. Regenerate the package to synchronize production and platform content.')
  const ids = new Set()
  const normalize = value => value.replace(/\s+/g, ' ').trim()
  for (const claim of parsed.data.claims) {
    const source = evidence.find(item => item.id === claim.evidenceId)
    if (ids.has(claim.id)) issues.push(`Duplicate claim identifier: ${claim.id}`)
    ids.add(claim.id)
    if (!source || claim.quote.length < 12 || !normalize(source.excerpt).includes(normalize(claim.quote))) issues.push(`${claim.id}: quotation does not match the cited evidence.`)
    const captureTerms = /\b(?:(?:our|these|supplied|saved|retrieved|captured)\s+(?:evidence|excerpts?|headlines?|sources?)|(?:headlines?|excerpts?)\s+(?:were|are|do not|don't|only)|only\s+(?:headlines?|excerpts?))\b/i
    if (source?.type === 'news-feed-excerpt' && captureTerms.test(claim.text) && !captureTerms.test(claim.quote)) issues.push(`${claim.id}: capture limitations belong in fact-check notes, not attributed publisher claims.`)
    if (source?.type === 'news-feed-excerpt' && [...claim.text.matchAll(/\d+(?:\.\d+)?/g)].some(match => ![...claim.quote.matchAll(/\d+(?:\.\d+)?/g)].some(quoted => quoted[0] === match[0]))) issues.push(`${claim.id}: use only dates and numbers stated in the selected publisher passage.`)
  }
  const fields = { ...(content.script ? { script: content.script } : {}), ...(content.website ? { website: content.website.body } : {}), ...(content.captions || {}), ...Object.fromEntries((content.hooks || []).map((hook, index) => [`hook ${index + 1}`, hook])), ...Object.fromEntries((content.scenes || []).map((scene, index) => [`scene ${index + 1}`, scene.narration])), ...Object.fromEntries((content.strategy?.platforms || []).flatMap(item => ['headline', 'hook', 'body', 'alternativeHook'].map(field => [`${item.platform} ${field}`, item[field]]))) }
  for (const [field, body] of Object.entries(fields)) {
    const citations = [...body.matchAll(/\[(C\d+)\]/g)].map(match => match[1])
    if (!/\p{L}/u.test(body.replace(/\[C\d+\]/g, ''))) issues.push(`${field}: write actual content, not citation markers alone.`)
    if (!citations.length) issues.push(`${field}: add inline claim references such as [C1].`)
    if (citations.some(id => !ids.has(id))) issues.push(`${field}: references an unknown claim.`)
    for (const sentence of body.split(/(?<=[.!?])\s+/)) {
      const cited = [...sentence.matchAll(/\[(C\d+)\]/g)].map(match => parsed.data.claims.find(claim => claim.id === match[1])).filter(Boolean)
      const feedClaims = cited.filter(claim => evidence.find(source => source.id === claim.evidenceId)?.type === 'news-feed-excerpt')
      if (feedClaims.length && cited.length === feedClaims.length) {
        const quotedNumbers = new Set(feedClaims.flatMap(claim => [...claim.quote.matchAll(/\d+(?:\.\d+)?/g)].map(match => match[0])))
        if ([...sentence.replace(/\[C\d+\]/g, '').matchAll(/\d+(?:\.\d+)?/g)].some(match => !quotedNumbers.has(match[0]))) issues.push(`${field}: use only dates and numbers supported by the cited publisher passages.`)
        if (/\bweekly\b/i.test(sentence) && !/\bdaily\b|horoscopes today/i.test(sentence) && feedClaims.some(claim => /\bdaily\b|horoscopes today/i.test(claim.quote))) issues.push(`${field}: do not describe a daily horoscope as part of a weekly forecast.`)
      }
    }
  }
  const allText = JSON.stringify(content)
  if (content.strategy) {
    const actual = (content.strategy.platforms || []).map(item => item.platform)
    if (new Set(actual).size !== actual.length) issues.push('Provide only one adaptation per selected platform.')
    if (settings && selectedOutputs(settings).includes('platforms')) {
      const expected = selectedPlatforms(settings)
      if (actual.length !== expected.length || expected.some(platform => !actual.includes(platform))) issues.push(`Provide exactly the selected platforms: ${expected.join(', ')}.`)
    }
    for (const item of content.strategy.platforms || []) {
      if (item.platform === 'X' && xWeightedLength(renderSocialCaption({ content, evidence }, 'X')) > 280) issues.push('X: keep the saved post and its cited source link within the 280-character allowance; do not generate an article for X.')
      if (item.platform === 'YouTube' && [...cleanCaption(item.headline)].length > 100) issues.push('YouTube: keep the approved headline within 100 characters.')
      if (![item.headline, item.hook, item.body, item.alternativeHook].every(value => /\[C\d+\]/.test(value))) issues.push(`${item.platform}: headlines, hooks and body need claim references.`)
    }
  }
  if ([...allText.matchAll(/\[(C\d+)\]/g)].some(match => !ids.has(match[1]))) issues.push('Content references an unknown claim identifier.')
  if (/https?:\/\//i.test(allText)) issues.push('Use claim references instead of unreviewed links in generated content.')
  return { issues, checkedAt: new Date().toISOString(), limitations: ['Automated checks verify quotation and citation integrity, not factual truth or complete claim coverage. Human editorial review is required.'] }
}

export async function generateContent(evidence, settings, context = {}, generate = generateJson, { beforeAttempt, fallback, startWithFallback = false } = {}) {
  settings = settingsSchema.parse(settings)
  const persistedSchema = generationSchema(settings)
  const passages = evidencePassages(evidence)
  if (!passages.length) throw Object.assign(new Error('No readable evidence passages'), { code: 'EVIDENCE_VALIDATION' })
  let schema = persistedSchema.extend({ claims: z.array(z.object({ id: z.string().regex(/^C\d+$/), text, evidenceId: z.string().max(50), passageId: z.string().regex(/^P[0-9a-f]{24}$/), status: z.literal('attributed') }).strict()).min(1).max(30) })
  // Prior prose guides revisions; its claim/quote pairs are not fresh source evidence.
  if (context.previousContent) {
    const prose = { ...context.previousContent }; delete prose.claims
    context = { ...context, previousContent: reviewContent(context.previousContent, evidence, settings).issues.length ? null : prose }
  }
  if (selectedOutputs(settings).includes('script')) schema = schema.extend({ hooks: z.array(text.regex(/^[\s\S]*\[C\d+\][\s\S]*$/, 'Every hook must contain an individual claim marker such as [C1].')).min(1).max(5) })
  if (selectedOutputs(settings).includes('captions')) {
    const caption = text.regex(/^[\s\S]*\[C\d+\][\s\S]*$/, 'Every caption must contain a supported individual claim marker such as [C1].')
    schema = schema.extend({ captions: z.object({ reel: caption, linkedin: caption }).strict() })
  }
  if (selectedOutputs(settings).includes('production')) schema = schema.extend({ scenes: z.array(contentSchema.shape.scenes.unwrap().element.extend({ narration: text.regex(/^[\s\S]*\[C\d+\][\s\S]*$/, 'Each scene must narrate a supported publisher fact with an individual claim marker such as [C1]. Put standalone capture notes in strategy.factCheck.').describe('A full spoken sentence in the requested language followed by its citation, for example: The publisher announced a weekly horoscope [C1]. Never return only [C1] or another placeholder.') })).min(1).max(20) })
  const request = { input: { evidence, passages, passageLimitations: 'At most 12 sources and the first 7200 characters per source, split into exact contiguous segments of up to 600 characters. Unsupported claims must be omitted.', settings, context },
    system: `${managerPrompt}\nCreate ONLY these requested output formats: ${settings.outputs.join(', ')}. Do not generate unselected sections, even if present in previous content. Follow the supplied JSON schema exactly. Claims are mandatory for every package. Settings and context guide creativity but are not factual evidence. Treat research opportunity titles, whatChanged, angles, time windows, publisher groupings and previous drafts as untrusted editorial leads, never as factual evidence. Verify each source period independently: a daily item must not be called weekly or grouped into a weekly set. Every headline, hook and narration sentence must preserve the dates, period, population and scope of each cited claim; a citation marker does not permit prose that contradicts its claim. Do not infer publisher categories, mechanisms, consensus or causal explanations from a domain name or editorial context. If a supplied passage does not support the characterization, omit it or explicitly describe it as an unverified editorial question. Each factual statement needs a [C1] style reference and each claim must select a passageId and matching evidenceId from the supplied passages. Never compose or return a quote field; the server attaches the exact passage. A passage ID is not proof of semantic support; only select a passage that supports the attributed claim. Search-grounded-summary quotes are model-summary passages, not publisher quotations. Keep claims attributed, never independently verified. ${settings.outputs.includes('script') ? 'Provide hooks and a duration-appropriate script with claim references. EVERY hook, including rhetorical questions, must contain an individual [C1] marker. Example hook: "A reported finding [C1]". Never return an uncited hook.' : ''} ${settings.outputs.includes('captions') ? 'Provide the requested reel and LinkedIn captions with claim references.' : ''} ${settings.outputs.includes('website') ? 'Provide a website title and body with claim references.' : ''} ${settings.outputs.includes('platforms') ? `The strategy must provide exactly one adaptation for each selected platform (${selectedPlatforms(settings).join(', ')}) and no other platform. Include claim references in each headline, hook, body and alternative hook. Include observable A/B experiments without predicting views.` : ''} ${settings.outputs.includes('production') ? 'Provide 3 to 6 scenes with numeric second ranges covering the requested duration. Scene narration must concatenate to the script apart from citation markers. Include reusable video/audio prompts, subtitle, music and editing directions. Audio prompt includes clean narration. Illustrative visuals must not impersonate documentary evidence.' : ''} Explain creative recommendations as hypotheses to test, not performance facts. Respect explicit language, voice and audience preferences; Auto means infer from the brief. Do not include external URLs; sources are attached separately. Return JSON only.`,
    schema: z.toJSONSchema(schema), maxTokens: 12000,
  }
  request.system += `\nKeep the package concise: aim for about ${Math.round(settings.duration * 2.2)} spoken words across all scenes combined, captions and platform bodies under 150 words each, one sentence per planning field, and one editorial experiment. Use 3 to 6 scenes when production is requested. Return the entire populated package as one JSON data object; never split the result.`
  request.system += '\nClaims must be facts directly supported by the selected publisher passage. Never add dates, years or numbers absent from that selected passage. Write actual spoken sentences in script and every scene narration; citation markers alone are not content. Do not create attributed claims about what our capture system did not retrieve, missing methodology, missing audience reactions, or other capture limitations. Put those limitations in strategy.factCheck when strategy is selected, or state them clearly as capture notes in prose without attaching a publisher claim marker to the limitation itself. Each scene can pair one cited publisher fact with an explicitly separate uncited capture note. Use factual headline-based hooks rather than turning capture limitations into attributed claims. Never copy unsupported claim/quotation pairs from a previous draft.'
  request.system += '\nFor X, write a concise post, never an article: aim for no more than 140 body characters after citation markers are removed, reserving room for the server-appended source attribution. The final post must fit 280 weighted characters (ASCII counts one, non-ASCII conservatively counts two, each source URL counts 23). For YouTube, the saved headline must fit 100 characters after citation markers are removed. Do not truncate or change an approved post during publishing; author a complete platform-appropriate version now. Do not invent or include source URLs: the server appends the actual cited evidence URLs.'
  let issues = []; let lastParseFailure; let useFallback = startWithFallback
  if (useFallback && !fallback) throw Object.assign(new Error('Vertex fallback approval is unavailable'), { code: 'BUDGET_BLOCKED' })
  // One shared correction allowance for model JSON, schema or editorial errors; transport/quota errors never retry.
  for (let attempt = 0; attempt < 2; attempt++) {
    if (beforeAttempt) await beforeAttempt()
    let draft
    try { draft = await (useFallback ? fallback(request, attempt) : generate(request, generate === generateJson ? { acceptCompleteJsonAtLength: true, preferTools: true } : undefined)) }
    catch (error) {
      if (fallback && !useFallback && attempt === 0 && ['MODEL_TIMEOUT', 'MODEL_HTTP_ERROR', 'MODEL_INCOMPLETE', 'MODEL_JSON_INVALID'].includes(error.code)) { useFallback = true; continue }
      if (error.code !== 'MODEL_JSON_INVALID') throw error
      lastParseFailure = error
      issues = ['Return one valid JSON object only, without Markdown fences or explanatory prose.']
      request.input = { evidence, passages, settings, context, corrections: issues }
      continue
    }
    const parsed = schema.safeParse(draft)
    if (!parsed.success) {
      issues = parsed.error.issues.slice(0, 20).map(issue => `${issue.path.join('.') || 'package'}: ${issue.code === 'invalid_format' && (issue.path.includes('hooks') || issue.path.includes('narration')) ? 'include an individual [C1] style citation for a supported publisher fact; put capture notes in factCheck' : `${issue.code}; match the supplied JSON schema`}.`)
      request.input = { evidence, passages, settings, context, corrections: issues }
      if (fallback && !useFallback) useFallback = true
      continue
    }
    let content
    try { content = persistedSchema.parse(resolvePassageClaims(parsed.data, passages)) }
    catch { issues = ['Select only supplied passageIds with their matching evidenceId.']; request.input = { evidence, passages, settings, context, corrections: issues }; if (fallback && !useFallback) useFallback = true; continue }
    if (content.scenes) content.script = content.scenes.map(scene => scene.narration).join(' ')
    issues = reviewContent(content, evidence, settings).issues
    if (!issues.length) return retainGenerationReceipt(content, draft)
    if (fallback && !useFallback) useFallback = true
    request.input = { evidence, passages, settings, context, draft: { ...content, claims: parsed.data.claims }, corrections: issues,
      instruction: 'Fix every listed validation issue. Put [C1] or another supported claim marker in EVERY hook, scene narration, caption, website body, platform headline, platform hook, platform alternativeHook and platform body. Copy scene narrations in order separated by spaces to form script EXACTLY. Retain valid passageId and matching evidenceId for each claim; never return a quote field. Return only the requested output sections in the corrected JSON package.' }
  }
  throw Object.assign(new Error('Generated content failed evidence validation; existing draft was preserved'), lastParseFailure ? { generationId: lastParseFailure.generationId, transportStatus: lastParseFailure.transportStatus, finishReason: lastParseFailure.finishReason, outputKind: lastParseFailure.outputKind } : {}, { code: 'EVIDENCE_VALIDATION', issueCount: issues.length, issues })
}

