import test from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import { once } from 'node:events'
import { randomUUID } from 'node:crypto'
import { createRepository } from '../storage/repository.js'
import { createCompletePackageRouter } from '../studio/complete-package-router.js'
import { contentHash } from '../studio/approval.js'

const platforms = ['X', 'Instagram', 'YouTube', 'Facebook', 'LinkedIn']
const evidence = { id: 'E1', url: 'https://example.com/preview', title: 'A limited model preview', publisher: 'example.com', excerpt: 'The publisher announced a limited model preview. The announcement describes limited availability and does not provide independent capability testing.', hash: 'controlled-source-capture', retrievedAt: new Date().toISOString(), type: 'retrieved-source', limitations: ['Controlled source fixture; not live research.'] }

function savedPackage(repository, owner, id = 'five-platform-package') {
  const script = 'The publisher announced a limited model preview [C1].'
  return repository.studioPut(owner, 'package', id, {
    title: 'Limited model preview', createdBy: owner, status: 'completed', editorialStatus: 'needs_review',
    settings: { industry: 'AI', audience: 'Professionals learning AI', language: 'English', tone: 'Clear and factual', platform: platforms.join(','), duration: 30, voice: 'Auto', outputs: ['script', 'captions', 'website', 'platforms', 'production'] },
    evidence: [evidence], review: { issues: [] },
    content: {
      script, hooks: ['A limited preview was announced [C1].'],
      scenes: [{ timing: '0:00–0:30', narration: script, onScreen: 'Limited model preview', visualPrompt: 'A labelled illustrative model preview diagram.', voiceDirection: 'Read clearly and preserve the qualification limited.' }],
      captions: { reel: script, linkedin: script }, website: { title: 'A limited preview [C1]', body: script },
      claims: [{ id: 'C1', text: 'The publisher announced a limited model preview', evidenceId: 'E1', quote: evidence.excerpt, status: 'attributed' }],
      strategy: { angle: 'Explain preview limitations', audience: 'AI learners', whyNow: 'Publisher announcement', factCheck: 'Check the original announcement', language: 'English', languageReason: 'Requested language', voice: 'Female', voiceReason: 'Controlled production fixture', delivery: 'Clear narration', keywords: ['model preview'],
        platforms: platforms.map(platform => ({ platform, headline: `${platform} limited preview [C1]`, hook: 'A preview was announced [C1].', body: `${platform}: ${script}`, cta: 'Read the original source.', hashtags: ['AI'], thumbnail: 'A labelled model diagram', format: ['YouTube', 'Instagram', 'Facebook'].includes(platform) ? 'video' : 'image', retentionPlan: 'Explain the qualification first.', alternativeHook: 'Limited availability [C1].', testPlan: 'Compare the opening against comparable account posts.' })),
        production: { videoPrompt: 'Illustrate the supplied announcement; do not portray testing results.', audioPrompt: 'Read the exact supplied narration.', musicDirection: 'Use no music unless rights and suitability are confirmed.', subtitleStyle: 'Readable sentence-case subtitles.', editingNotes: 'Preserve all source qualifications.' },
        experiments: [{ variable: 'Opening', variantA: 'Preview first', variantB: 'Limitations first', metric: 'Average percentage viewed', decisionRule: 'Compare similar posts at a matched age; no performance guarantee.' }],
      },
    },
  }, 0)
}

async function fixture(run) {
  const repository = createRepository(':memory:')
  const pack = savedPackage(repository, 'alice')
  for (const platform of platforms) repository.studioPut('alice', 'account_profile', platform, { accountId: `account-${platform}`, platform, audience: `${platform} audience`, tone: 'Clear', enabled: true }, 0)
  let calls = 0
  const app = express(); app.use(express.json())
  app.use('/api/studio', createCompletePackageRouter({ repository, auth: (req, _res, next) => { req.identity = { uid: req.headers.authorization || 'alice' }; next() }, config: { STUDIO_DAILY_GENERATIONS: 10, LLM_MODEL: 'nvidia/controlled-fixture:free' }, generate: async request => {
    calls++
    return { summary: 'Controlled five-platform planning fixture; no measured performance is claimed.', decisions: request.input.selectedPlatforms.flatMap(platform => request.input.requiredParameters.map(parameter => ({ id: `${platform}-${parameter}`, platform, parameter, value: ({ format: ['YouTube', 'Instagram', 'Facebook'].includes(platform) ? 'video' : 'image', language: 'English', tone: 'Clear and factual', duration: '30', aspectRatio: '9:16', visualStyle: 'Labelled editorial diagram', audioApproach: 'Clear narration', coverApproach: 'Readable labelled diagram', cta: 'Read the original source.', postingSlot: 'Unavailable', successMetric: 'Average percentage viewed', testVariable: 'Opening hook' })[parameter] || 'Unavailable', method: 'hypothesis', evidenceIds: ['E1'], metricIds: [], rationale: 'An explicit planning hypothesis, not evidence of audience response.', alternatives: [], confidence: 'low', missing: ['Comparable historical account results are unavailable.'] }))) }
  } }))
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening')
  const call = (path = '', method = 'GET', body, actor = 'alice') => fetch(`http://127.0.0.1:${server.address().port}/api/studio/packages/${pack.id}/complete-package${path}`, { method, headers: { Authorization: actor, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) })
  try { await run({ repository, pack, call, calls: () => calls }) } finally { await new Promise(resolve => server.close(resolve)); repository.close() }
}

test('all five platform packs pass context, admitted analysis, prompt handoff and owner export without rewriting saved copy', () => fixture(async ({ repository, pack, call, calls }) => {
  const originalHash = contentHash(pack)
  let response = await call(); assert.equal(response.status, 200)
  let complete = await response.json()
  assert.equal(complete.sections.length, 16)
  assert.deepEqual(new Set(complete.platforms.filter(item => item.selected).map(item => item.platform)), new Set(platforms))
  assert.equal(calls(), 0, 'GET must not generate, publish or spend')
  response = await call('/context', 'PUT', { expectedRevision: 0, context: { objective: 'Explain the limitations of the publisher announcement.', brand: 'Ink and cobalt. Label all generated diagrams as illustrative.', timezone: 'Asia/Kolkata', platformAccounts: platforms.map(platform => ({ platform, accountId: `account-${platform}` })), productionTools: { graphics: 'Approved graphics tool', video: 'Approved video tool', voice: 'Approved narration tool', music: 'Approved music tool', editor: 'Approved editing tool' } } })
  assert.equal(response.status, 200, await response.clone().text()); complete = await response.json()
  const requestId = randomUUID()
  response = await call('/analyze', 'POST', { requestId, contentHash: complete.contentHash, contextRevision: complete.contextRevision })
  assert.equal(response.status, 200, await response.clone().text()); complete = await response.json()
  assert.equal(complete.analysis.status, 'completed')
  assert.equal(calls(), 1)
  for (const platform of platforms) {
    const prompt = complete.prompts.find(item => item.platform === platform && item.kind === 'main-image')
    assert.ok(prompt, `${platform} has a distinct graphic prompt`)
    assert.ok(prompt.prompt.includes(`${platform} limited preview`), `${platform} prompt uses its own saved headline`)
    assert.ok(prompt.prompt.includes('Ink and cobalt'), 'Resolved brand direction is included')
    assert.ok(!prompt.exactText.includes('[C1]'), 'Public text is separate from internal claim markers')
  }
  response = await call('/analyze', 'POST', { requestId, contentHash: complete.contentHash, contextRevision: complete.contextRevision })
  assert.equal(response.status, 200); assert.equal(calls(), 1, 'Replaying one request cannot dispatch twice')
  response = await call('/download'); assert.equal(response.status, 200, await response.clone().text())
  const exported = await response.json()
  assert.equal(exported.manifest.scope, 'internal-complete-package')
  assert.equal(exported.completePackage.sections.length, 16)
  assert.equal(contentHash(repository.studioGet('alice', 'package', pack.id)), originalHash)
  assert.equal((await call('', 'GET', undefined, 'outsider')).status, 404)
  response = await call('/context', 'PUT', { expectedRevision: complete.contextRevision, context: { ...complete.context, objective: 'A changed objective invalidates old production decisions.' } })
  assert.equal(response.status, 200); complete = await response.json()
  assert.equal(complete.analysis.status, 'stale')
  assert.equal(complete.decisions.length, 0)
  assert.ok(complete.prompts.every(item => item.status !== 'ready'), 'Stale AI choices cannot masquerade as production-ready prompts')
}))

test('the complete-package HTTP routes are mounted in the real application', async () => {
  const { createApp } = await import('../http/app.js')
  const repository = createRepository(':memory:')
  const pack = savedPackage(repository, 'alice')
  const app = createApp({ repository, sources: [], verifyIdentity: async () => ({ uid: 'alice' }) })
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening')
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/studio/packages/${pack.id}/complete-package`, { headers: { Authorization: 'Bearer controlled-fixture-token' } })
    assert.equal(response.status, 200)
    assert.equal((await response.json()).sections.length, 16)
  } finally { await new Promise(resolve => server.close(resolve)); repository.close() }
})
