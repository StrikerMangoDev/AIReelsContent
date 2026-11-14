import { evidencePassages, resolvePassageClaims } from './evidence-passages.js'
import { citationSentences } from './citation-sentences.js'
import { contentContract, reviewContentAlignment, retainContentAlignment } from './content-alignment.js'
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
const numericTokens = value => [...new Set([...String(value || '').matchAll(/(?<![\p{L}\p{N}_])\d+(?:\.\d+)?/gu)].map(match => match[0]))]
const missingNumberDetail = values => values.length ? ` Missing numeric tokens: ${values.slice(0, 4).map(value => value.slice(0, 20)).join(', ')}.` : ''
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

export function reviewContent(content, evidence, settings, context = {}) {
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
    const missing = numericTokens(claim.text).filter(value => !numericTokens(claim.quote).includes(value))
    if (missing.length) issues.push(`${claim.id}: use only dates and numbers stated in the selected publisher passage.${missingNumberDetail(missing)}`)
  }
  const fields = { ...(content.script ? { script: content.script } : {}), ...(content.website ? { website: content.website.body } : {}), ...(content.captions || {}), ...Object.fromEntries((content.hooks || []).map((hook, index) => [`hook ${index + 1}`, hook])), ...Object.fromEntries((content.scenes || []).map((scene, index) => [`scene ${index + 1}`, scene.narration])), ...Object.fromEntries((content.strategy?.platforms || []).flatMap(item => ['headline', 'hook', 'body', 'alternativeHook'].map(field => [`${item.platform} ${field}`, item[field]]))) }
  if (content.website?.title) fields['website title'] = content.website.title
  for (const [field, body] of Object.entries(fields)) {
    const citations = [...body.matchAll(/\[(C\d+)\]/g)].map(match => match[1])
    if (!/\p{L}/u.test(body.replace(/\[C\d+\]/g, ''))) issues.push(`${field}: write actual content, not citation markers alone.`)
    if (!citations.length && (field !== 'website title' || /(?<![\p{L}\p{N}_])\d/u.test(body))) issues.push(`${field}: add inline claim references such as [C1].`)
    if (citations.some(id => !ids.has(id))) issues.push(`${field}: references an unknown claim.`)
    for (const sentence of citationSentences(body)) {
      const cited = [...sentence.matchAll(/\[(C\d+)\]/g)].map(match => parsed.data.claims.find(claim => claim.id === match[1])).filter(Boolean)
      const feedClaims = cited.filter(claim => evidence.find(source => source.id === claim.evidenceId)?.type === 'news-feed-excerpt')
      const sentenceNumbers = [...sentence.replace(/\[C\d+\]/g, '').matchAll(/(?<![\p{L}\p{N}_])\d+(?:\.\d+)?/gu)]
      if (sentenceNumbers.length && !cited.length) issues.push(`${field}: numeric statements need their own valid claim marker and supporting selected quotation.`)
      if (cited.length) {
        const quotedNumbers = new Set(cited.flatMap(claim => [...claim.quote.matchAll(/(?<![\p{L}\p{N}_])\d+(?:\.\d+)?/gu)].map(match => match[0])))
        const missing = [...new Set(sentenceNumbers.filter(match => !quotedNumbers.has(match[0])).map(match => match[0]))]
        if (missing.length) issues.push(`${field}: use only dates and numbers supported by the cited publisher passages.${missingNumberDetail(missing)}`)
      }
      if (feedClaims.length && cited.length === feedClaims.length) {
        if (/\bweekly\b/i.test(sentence) && !/\bdaily\b|horoscopes today/i.test(sentence) && feedClaims.some(claim => /\bdaily\b|horoscopes today/i.test(claim.quote))) issues.push(`${field}: do not describe a daily horoscope as part of a weekly forecast.`)
      }
    }
  }
  if (context.automationAccountId) {
    const words = value => cleanCaption(value || '').split(/\s+/u).filter(Boolean).length
    if (content.claims.length > 3) issues.push('Automation: use no more than 3 source-backed claims.')
    if (content.claims.reduce((total, claim) => total + words(claim.text), 0) > 48) issues.push('Automation: keep all claim text within 48 words combined.')
    if (content.website && [...cleanCaption(content.website.title)].length > 65) issues.push('Automation: keep the website title within 65 characters.')
    if (content.website && words(content.website.body) > 180) issues.push('Automation: keep the website body within 180 words.')
    for (const item of content.strategy?.platforms || []) {
      if ([...cleanCaption(item.headline)].length > 65) issues.push(`Automation ${item.platform}: keep the headline within 65 characters.`)
      if (words(item.body) > 150) issues.push(`Automation ${item.platform}: keep the platform body within 150 words.`)
      if (item.platform === 'X' && [...cleanCaption(item.body)].length > 140) issues.push('Automation X: keep the body within 140 characters after citation markers are removed.')
      if (item.platform === 'X' && !/[.!?。！？।…]["'”’)]?$/u.test(cleanCaption(item.body).trim())) issues.push('Automation X: finish the body with a complete sentence and terminal punctuation; never cut off a word or sentence to meet the length limit.')
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

export async function generateContent(evidence, settings, context = {}, generate = generateJson, { beforeAttempt, fallback, startWithFallback = false, evaluateAlignment = generateJson } = {}) {
  settings = settingsSchema.parse(settings)
  const contract = contentContract(settings, context)
  const persistedSchema = generationSchema(settings)
  const passages = evidencePassages(evidence).map(passage => ({ ...passage, allowedNumbers: numericTokens(passage.quote) }))
  if (!passages.length) throw Object.assign(new Error('No readable evidence passages'), { code: 'EVIDENCE_VALIDATION' })
  const compactX = Boolean(context.automationAccountId && selectedPlatforms(settings).length === 1 && selectedPlatforms(settings)[0] === 'X')
  let schema = persistedSchema.extend({ claims: z.array(z.object({ id: z.string().regex(/^C\d+$/), text: context.automationAccountId ? text.max(100) : text, evidenceId: z.string().max(50), passageId: z.string().regex(/^P[0-9a-f]{24}$/), status: z.literal('attributed') }).strict()).min(1).max(compactX ? 1 : context.automationAccountId ? 2 : 30) })
  if (context.automationAccountId) {
    if (settings.outputs.includes('website')) schema = schema.extend({ website: schema.shape.website.extend({ title: text.max(65) }) })
    if (settings.outputs.includes('platforms')) {
      const post = schema.shape.strategy.shape.platforms.element
      const variants = selectedPlatforms(settings).map(platform => post.extend({ platform: z.literal(platform), headline: text.max(65), body: platform === 'X' ? text.max(140) : text }))
      schema = schema.extend({ strategy: schema.shape.strategy.extend({ platforms: z.array(variants.length === 1 ? variants[0] : z.discriminatedUnion('platform', variants)).min(variants.length).max(variants.length) }) })
    }
  }
  if (!context.automationAccountId && selectedOutputs(settings).includes('platforms')) {
    const post = schema.shape.strategy.shape.platforms.element
    const variants = selectedPlatforms(settings).map(platform => platform === 'X' ? post.extend({ platform: z.literal(platform), body: text.max(180) }) : post.extend({ platform: z.literal(platform) }))
    schema = schema.extend({ strategy: schema.shape.strategy.extend({ platforms: z.array(variants.length === 1 ? variants[0] : z.discriminatedUnion('platform', variants)).min(variants.length).max(variants.length) }) })
  }
  // Prior prose guides revisions; its claim/quote pairs are not fresh source evidence.
  if (context.previousContent) {
    const prose = { ...context.previousContent }; delete prose.claims
    context = { ...context, previousContent: reviewContent(context.previousContent, evidence, settings, context).issues.length ? null : prose }
  }
  if (selectedOutputs(settings).includes('script')) schema = schema.extend({ hooks: z.array(text.regex(/^[\s\S]*\[C\d+\][\s\S]*$/, 'Every hook must contain an individual claim marker such as [C1].')).min(1).max(5) })
  if (selectedOutputs(settings).includes('captions')) {
    const caption = text.regex(/^[\s\S]*\[C\d+\][\s\S]*$/, 'Every caption must contain a supported individual claim marker such as [C1].')
    schema = schema.extend({ captions: z.object({ reel: caption, linkedin: caption }).strict() })
  }
  if (selectedOutputs(settings).includes('production')) schema = schema.extend({ scenes: z.array(contentSchema.shape.scenes.unwrap().element.extend({ narration: text.regex(/^[\s\S]*\[C\d+\][\s\S]*$/, 'Each scene must narrate a supported publisher fact with an individual claim marker such as [C1]. Put standalone capture notes in strategy.factCheck.').describe('A full spoken sentence in the requested language followed by its citation, for example: The publisher announced a weekly horoscope [C1]. Never return only [C1] or another placeholder.') })).min(1).max(20) })
  const sourceMetadata = evidence.slice(0, 12).map(({ id, title, url, publisher, type, publishedAt, retrievedAt, limitations }) => ({ id, title, url, publisher, type, publishedAt, retrievedAt, limitations }))
  const baseInput = { evidence: sourceMetadata, passages, passageLimitations: 'Only the supplied passages are eligible claim quotations. Source metadata and titles are context, not additional quotable text. At most 12 sources and the first 7200 characters per source, split into exact contiguous segments of up to 600 characters. Unsupported claims must be omitted.', settings, context, ...(contract ? { contentContract: contract } : {}) }
  const sourceBoundCorrection = (draft, corrections) => {
    const claims = schema.shape.claims.safeParse(draft?.claims)
    if (!claims.success) return null
    try {
      const resolved = resolvePassageClaims({ claims: claims.data }, passages)
      if (reviewContent(resolved, evidence, undefined, context).issues.length) return null
      const selectedIds = new Set(claims.data.map(item => item.passageId))
      const selectedEvidence = new Set(claims.data.map(item => item.evidenceId))
      const creative = Object.fromEntries(['automationAccountId', 'brief', 'outputConstraint', 'revisionInstruction'].filter(key => context[key] !== undefined).map(key => [key, context[key]]))
      if (context.strategyWorkflow) creative.strategyWorkflow = { version: context.strategyWorkflow.version, objective: context.strategyWorkflow.objective, brand: context.strategyWorkflow.brand, ...(context.strategyWorkflow.websiteSeo ? { websiteSeo: context.strategyWorkflow.websiteSeo } : {}), destinations: (context.strategyWorkflow.destinations || []).map(({ platform, accountId, goal, audienceQuestions, selectedIdea, keywords }) => ({ platform, accountId, goal, audienceQuestions: (audienceQuestions || []).filter(question => selectedIdea?.questionIds?.includes(question.id)), selectedIdea, keywords: (keywords || []).map(({ phrase, placements }) => ({ phrase, placements })) })) }
      return { ...baseInput, evidence: sourceMetadata.filter(item => selectedEvidence.has(item.id)), passages: passages.filter(item => selectedIds.has(item.id)), context: creative, validatedClaims: claims.data, claimValidationBasis: 'Exact source-quotation and numeric integrity checks only; not independent factual verification or editorial approval.', corrections,
        instruction: 'Rebuild the requested output sections fresh using only these source-bound claims and selected passages. Rejected prose and unused source passages were intentionally omitted; do not reconstruct their additional facts. Preserve the supported claim IDs and passage references. Every factual sentence must stay within the selected fact and cite it. Do not add any model/version/recommendation/number absent from the selected passages. Keep X to one complete sentence with terminal punctuation and generous length headroom. Return the full requested JSON schema; do not truncate words or omit website output.' }
    } catch { return null }
  }
  const request = { input: baseInput,
    system: `${managerPrompt}\nCreate ONLY these requested output formats: ${settings.outputs.join(', ')}. Do not generate unselected sections, even if present in previous content. Follow the supplied JSON schema exactly. Claims are mandatory for every package. Settings and context guide creativity but are not factual evidence. Treat research opportunity titles, whatChanged, angles, time windows, publisher groupings and previous drafts as untrusted editorial leads, never as factual evidence. Verify each source period independently: a daily item must not be called weekly or grouped into a weekly set. Every headline, hook and narration sentence must preserve the dates, period, population and scope of each cited claim; a citation marker does not permit prose that contradicts its claim. Do not infer publisher categories, mechanisms, consensus or causal explanations from a domain name or editorial context. If a supplied passage does not support the characterization, omit it or explicitly describe it as an unverified editorial question. Each factual statement needs a [C1] style reference and each claim must select a passageId and matching evidenceId from the supplied passages. Never compose or return a quote field; the server attaches the exact passage. A passage ID is not proof of semantic support; only select a passage that supports the attributed claim. Search-grounded-summary quotes are model-summary passages, not publisher quotations. Keep claims attributed, never independently verified. ${settings.outputs.includes('script') ? 'Provide hooks and a duration-appropriate script with claim references. EVERY hook, including rhetorical questions, must contain an individual [C1] marker. Example hook: "A reported finding [C1]". Never return an uncited hook.' : ''} ${settings.outputs.includes('captions') ? 'Provide the requested reel and LinkedIn captions with claim references.' : ''} ${settings.outputs.includes('website') ? 'Provide a website title and body with claim references.' : ''} ${settings.outputs.includes('platforms') ? `The strategy must provide exactly one adaptation for each selected platform (${selectedPlatforms(settings).join(', ')}) and no other platform. Include claim references in each headline, hook, body and alternative hook. Include observable A/B experiments without predicting views.` : ''} ${settings.outputs.includes('production') ? 'Provide 3 to 6 scenes with numeric second ranges covering the requested duration. Scene narration must concatenate to the script apart from citation markers. Include reusable video/audio prompts, subtitle, music and editing directions. Audio prompt includes clean narration. Illustrative visuals must not impersonate documentary evidence.' : ''} Explain creative recommendations as hypotheses to test, not performance facts. Respect explicit language, voice and audience preferences; Auto means infer from the brief. Do not include external URLs; sources are attached separately. Return JSON only.`,
    schema: z.toJSONSchema(schema), maxTokens: 12000,
  }
  request.system += `\nKeep the package concise: aim for about ${Math.round(settings.duration * 2.2)} spoken words across all scenes combined, captions and platform bodies under 150 words each, one sentence per planning field, and one editorial experiment. Use 3 to 6 scenes when production is requested. Return the entire populated package as one JSON data object; never split the result.`
  request.system += '\nThis request writes one saved source-backed topic, not a research briefing. Do not create a ten-topic collection or apply research-only topic-count targets. Adapt only the selected topic to the requested outputs while preserving source attribution and qualifications.'
  if (contract) request.system += '\nSTRATEGY CONTRACT: contentContract remains the editorial requirement on EVERY attempt. Each delivered post body, caption, script and website article must directly answer its selected audience question, fulfill the angle/opening promise and serve the goal/target action. Never substitute a generic related update. If captured passages cannot answer the question, explicitly explain what cannot be established in PUBLIC text; do not invent an answer. A source-limited response must address that exact question. Website writing must fulfill primary search intent and the research-linked outline; keywords alone are not coverage. Planning notes do not replace the audience-facing answer. Never invent research, competitors, metrics or approval.'
  request.system += '\nClaims must be facts directly supported by the selected publisher passage. Never add dates, years or numbers absent from that selected passage. Write actual spoken sentences in script and every scene narration; citation markers alone are not content. Do not create attributed claims about what our capture system did not retrieve, missing methodology, missing audience reactions, or other capture limitations. Put those limitations in strategy.factCheck when strategy is selected, or state them clearly as capture notes in prose without attaching a publisher claim marker to the limitation itself. Each scene can pair one cited publisher fact with an explicitly separate uncited capture note. Use factual headline-based hooks rather than turning capture limitations into attributed claims. Never copy unsupported claim/quotation pairs from a previous draft.'
  request.system += '\nMODEL VERSIONS ARE NUMBERS TOO: each passage has allowedNumbers. Before writing a claim, choose its passage, then use ONLY numeric tokens in that selected passage. A version in a source title, another passage, context or another claim cannot support this claim. If a passage names unversioned models, keep those names unversioned in that claim and every sentence citing it; alternatively select a passage that explicitly supports both the version and the same factual statement. Do not add a release version to a claim simply because it appears elsewhere on the page. Do not move a numeric token to another sentence without a supporting marker. Never borrow unrelated benchmark, price, duration or model numbers. Omitting unnecessary versions is safer than implying support that is absent.'
  request.system += '\nFor X, write a concise post, never an article: aim for no more than 140 body characters after citation markers are removed, reserving room for the server-appended source attribution. The final post must fit 280 weighted characters (ASCII counts one, non-ASCII conservatively counts two, each source URL counts 23). For YouTube, the saved headline must fit 100 characters after citation markers are removed. Do not truncate or change an approved post during publishing; author a complete platform-appropriate version now. Do not invent or include source URLs: the server appends the actual cited evidence URLs.'
  if (context.automationAccountId) request.system += '\nAUTOMATION OUTPUT CONTRACT: Write one compact update, never a long briefing. Generate at most 2 atomic claims, preferably 10–14 words each and no more than 28 words combined as a drafting target. One claim = one simple supported fact; put additional qualifications in the saved prose with its matching citation. The saved-content hard limit remains 48 words across all claim text combined; do not aim at that boundary. Aim for website body 60–90 words and platform body 40–60 words; for X aim for at most 100 body characters after citation markers are removed, not 100 words. Keep every website title and platform headline within 65 characters, website body within 180 words, each platform body within 150 words, and X body within 140 characters after citation markers are removed. These are validation limits, not optional targets. Preserve the requested video duration; never promise a longer duration in a headline. Omit peripheral claims and unsupported numbers instead of expanding the package. Select the smallest useful set of directly supported facts and preserve their qualifications.'
  if (context.automationAccountId) request.system += '\nThe model output schema is deliberately tighter than saved-content limits: each claim text is at most 100 characters; every title/headline is at most 65 characters INCLUDING its citation markers; X body is at most 140 characters INCLUDING citation markers. Draft well below those maxima. All factual website and platform sentences must paraphrase only the one or two claims you actually selected, with each sentence\'s own matching marker. Do not add additional article facts, recommendations, other model names/versions, pricing or benchmarks that are not in those selected claims. A short website update is complete; do not pad it to a target word count. Keep honest capture notes in factCheck; lack of independent validation is not a claim that independent results do not exist.'
  if (compactX && !contract) request.system += '\nSINGLE-FACT X UPDATE: select exactly ONE atomic claim. Write the X body as one complete factual sentence, aiming for 80 characters of prose, with its [C1] marker and terminal punctuation. Aim for a factual headline of 45 characters before its marker, leaving headroom below the schema ceiling. Include no second fact, second sentence, CTA or independent-results caveat in the body; the CTA has its own field. Do not fill the 140-character schema allowance: it is a ceiling, not a target. Never cut a word, leave an unfinished recommendation or truncate a sentence to fit. Keep any website writing limited to that same one selected fact and its attribution; no other model recommendation or version may be added.'
  if (compactX && contract) request.system += '\nSTRATEGY-LED X UPDATE: use the one directly supported claim that answers the selected question, not a generic announcement. Keep the complete answer within the existing 140-character limit with its citation and punctuation. Omit repeated product names or versions when unnecessary. If the question cannot be answered, a precise statement of that source limitation must take priority over an unrelated announcement; never invent an answer or truncate it to fit. The website must answer the same question with the same qualifications.'
  let issues = []; let lastParseFailure; let useFallback = startWithFallback; let preferTools = true
  if (useFallback && !fallback) throw Object.assign(new Error('Vertex fallback approval is unavailable'), { code: 'BUDGET_BLOCKED' })
  // One shared correction allowance for model JSON, schema or editorial errors; transport/quota errors never retry.
  for (let attempt = 0; attempt < 2; attempt++) {
    if (beforeAttempt) await beforeAttempt()
    let draft
    try { draft = await (useFallback ? fallback(request, attempt) : generate(request, generate === generateJson ? { acceptCompleteJsonAtLength: true, preferTools } : undefined)) }
    catch (error) {
      if (attempt === 0 && !useFallback && error.code === 'MODEL_INCOMPLETE' && error.finishReason === 'tool_calls' && error.toolCallCount > 1) {
        preferTools = false
        request.input = { ...baseInput, corrections: ['Return the whole populated package as one JSON data object, not separate tool calls for individual sections.'] }
        continue
      }
      if (fallback && !useFallback && attempt === 0 && ['MODEL_TIMEOUT', 'MODEL_HTTP_ERROR', 'MODEL_INCOMPLETE', 'MODEL_JSON_INVALID'].includes(error.code)) { useFallback = true; continue }
      if (error.code !== 'MODEL_JSON_INVALID') throw error
      lastParseFailure = error
      issues = ['Return one valid JSON object only, without Markdown fences or explanatory prose.']
      request.input = { ...baseInput, corrections: issues }
      continue
    }
    const parsed = schema.safeParse(draft)
    if (!parsed.success) {
      issues = parsed.error.issues.slice(0, 20).map(issue => `${issue.path.join('.') || 'package'}: ${issue.code === 'invalid_format' && (issue.path.includes('hooks') || issue.path.includes('narration')) ? 'include an individual [C1] style citation for a supported publisher fact; put capture notes in factCheck' : issue.code === 'too_big' ? `use at most ${issue.maximum} ${issue.origin === 'string' ? 'characters including citation markers' : 'items'}; rewrite concisely without truncating approved copy` : `${issue.code}; match the supplied JSON schema`}.`)
      request.input = sourceBoundCorrection(draft, issues) || { ...baseInput, corrections: issues }
      if (fallback && !useFallback) useFallback = true
      continue
    }
    let content
    try { content = persistedSchema.parse(resolvePassageClaims(parsed.data, request.input.passages)) }
    catch { issues = ['Select only supplied passageIds with their matching evidenceId.']; request.input = { ...baseInput, corrections: issues }; if (fallback && !useFallback) useFallback = true; continue }
    if (content.scenes) content.script = content.scenes.map(scene => scene.narration).join(' ')
    issues = reviewContent(content, evidence, settings, context).issues
    let alignmentFeedback
    if (!issues.length && contract) {
      const assessment = await reviewContentAlignment(content, contract, { generate: evaluateAlignment, beforeAttempt })
      issues = assessment.issues
      alignmentFeedback = assessment.judgments
      if (!issues.length) return retainContentAlignment(retainGenerationReceipt(content, draft), assessment)
    }
    if (!issues.length) return retainGenerationReceipt(content, draft)
    if (fallback && !useFallback) useFallback = true
    request.input = sourceBoundCorrection(parsed.data, issues) || { ...baseInput, draft: { ...content, claims: parsed.data.claims }, corrections: issues,
      claimNumberChecks: parsed.data.claims.map(claim => { const passage = passages.find(item => item.id === claim.passageId && item.evidenceId === claim.evidenceId); return { claimId: claim.id, passageId: claim.passageId, allowedNumbers: passage?.allowedNumbers || [], unsupportedNumbers: numericTokens(claim.text).filter(value => !passage?.allowedNumbers.includes(value)) } }),
      instruction: 'Fix every listed validation issue, including the exact missing numeric tokens. If a selected passage lacks a version or date, remove it from that claim AND every sentence citing the claim, or choose a passage supporting the complete fact with that numeric token. Use allowedNumbers and claimNumberChecks; titles and other passages cannot rescue a mismatch. Keep atomic claims and the shorter drafting targets. Put [C1] or another supported claim marker in EVERY hook, scene narration, caption, website body, platform headline, platform hook, platform alternativeHook and platform body. Copy scene narrations in order separated by spaces to form script EXACTLY. Retain valid passageId and matching evidenceId for each claim; never return a quote field. Return only the requested output sections in the corrected JSON package.' }
    if (alignmentFeedback) {
      // An off-topic first draft may have selected the wrong passages; let the repair find the answer in the original evidence.
      request.input = { ...baseInput, corrections: issues, instruction: 'Rebuild the requested sections from the original supplied passages. Select new source-bound claims where needed to answer the question. Every delivered caption and body must contain its own substantive answer or specific source limitation; a teaser question is insufficient. Return the full requested JSON schema.' }
      request.input.alignmentFeedback = alignmentFeedback
      request.input.instruction += ' STRATEGY REPAIR: fix the specific failed target/question in alignmentFeedback. Put the answer or precise source limitation in that target body, not only the headline, CTA or factCheck. When evidence cannot explain restrictions/access, state that those restrictions/access cannot be established from this quote. A generic announcement plus a generic disclaimer is not an answer. For compact X, prioritize the actual question over repeating long product names; never exceed the existing platform limits.'
    }
  }
  throw Object.assign(new Error('Generated content failed evidence validation; existing draft was preserved'), lastParseFailure ? { generationId: lastParseFailure.generationId, transportStatus: lastParseFailure.transportStatus, finishReason: lastParseFailure.finishReason, outputKind: lastParseFailure.outputKind } : {}, { code: 'EVIDENCE_VALIDATION', issueCount: issues.length, issues })
}

