import test from 'node:test'
import assert from 'node:assert/strict'
import { createRepository } from '../storage/repository.js'
import { reserveFreeOperation } from '../budget/free-operation.js'
import { contentHash } from '../studio/approval.js'
import { runContentJob } from '../studio/job-worker.js'

const evidence = [{ id: 'E1', title: 'Publisher preview', url: 'https://example.com/preview', publisher: 'example.com', retrievedAt: new Date().toISOString(), hash: 'source-hash', excerpt: 'The publisher announced a preview. Availability is limited to invited testers. The announcement does not establish broad public availability or independently tested performance.' }]
const content = { website: { title: 'Publisher preview [C1]', body: 'The publisher announced a preview [C1].' }, claims: [{ id: 'C1', text: 'The publisher announced a preview.', evidenceId: 'E1', quote: 'The publisher announced a preview.', status: 'attributed' }] }

async function queue(repository, id, savedContent = null) {
  const draft = repository.studioPut('alice', 'package', id, { settings: { industry: 'Science', audience: 'Curious professionals', language: 'English', tone: 'Clear', outputs: ['website'], platform: 'X' }, evidence, content: savedContent, status: 'draft' }, 0)
  const scope = { packageId: id, revision: draft.revision, operation: 'generation', actorUid: 'alice', contentHash: contentHash(draft) }
  const { job } = await repository.studioJobReserve('alice', `job-${id}`, 'a'.repeat(64), 10, scope)
  await reserveFreeOperation(repository, 'alice', job.id, scope)
  repository.studioPut('alice', 'package', id, { ...draft, jobId: job.id, status: 'generating', independentReview: null, approval: null }, draft.revision)
  repository.studioJobUpdate('alice', job.id, { ready: true, status: 'reserved' }, job.revision, 'reserved')
  return job
}

test('worker records actual generation assurance once and rejected output preserves the previous draft', async () => {
  const repository = createRepository(':memory:')
  let calls = 0
  try {
    const job = await queue(repository, 'success')
    const outcome = await runContentJob({ repository, uid: 'alice', requestId: job.id, generate: async () => { calls++; return content } })
    assert.equal(outcome.status, 'completed')
    const saved = repository.studioGet('alice', 'package', 'success')
    assert.equal(saved.assurance.contentHash, contentHash(saved))
    assert.ok(saved.assurance.stageResults.some(stage => stage.runId === job.id))
    assert.ok(saved.assurance.stageResults.some(stage => stage.stage === 'generation' && stage.runId === job.id))
    assert.equal(saved.independentReview, null)
    assert.equal(saved.approval, null)
    assert.deepEqual(saved.content, content)
    assert.equal((await runContentJob({ repository, uid: 'alice', requestId: job.id, generate: async () => { calls++; return content } })).status, 'skipped')
    assert.equal(calls, 1)
    const failedJob = await queue(repository, 'rejected', content)
    const rejected = await runContentJob({ repository, uid: 'alice', requestId: failedJob.id, generate: async () => ({ ...content, website: { title: 'No citation', body: 'Unsupported statement [C99].' } }) })
    assert.equal(rejected.status, 'failed')
    assert.equal(rejected.diagnostics.code, 'EVIDENCE_VALIDATION')
    assert.ok(rejected.diagnostics.issueCount > 0)
    const failed = repository.studioGet('alice', 'package', 'rejected')
    assert.deepEqual(failed.content, content)
    assert.equal(failed.assurance, undefined)
    assert.equal(failed.approval, null)
    assert.equal(repository.budgetGet('alice', failedJob.id).status, 'dispatch_unknown')
  } finally { repository.close() }
})
