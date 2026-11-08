import test from 'node:test'
import assert from 'node:assert/strict'
import { researchChanges } from '../studio/research-changes.js'

test('refresh diff distinguishes repeats, changed evidence and duplicates without claiming semantic novelty', () => {
  const topic = { title: 'A preview', whatChanged: 'A publisher announced a preview.', evidenceIds: ['E1'] }
  const evidence = [{ id: 'E1', url: 'https://example.com', hash: 'one' }]
  const previous = { id: 'previous', opportunities: [topic], evidence }
  const current = { opportunities: [{ ...topic, title: '  A PREVIEW ' }, topic, { ...topic, title: 'A different development' }], evidence }
  const result = researchChanges(current, previous)
  assert.equal(result.previousReportId, 'previous')
  assert.deepEqual(result.topics.map(value => value.status), ['repeated', 'duplicate-in-report', 'new-to-report'])
  assert.equal(result.topics[0].disposition, 'review-before-reusing')
  assert.equal(researchChanges({ opportunities: [topic], evidence: [{ ...evidence[0], hash: 'two' }] }, previous).topics[0].status, 'evidence-changed')
  assert.equal(researchChanges({ opportunities: [topic], evidence }, null).topics[0].status, 'new-to-report')
  assert.match(result.limitations, /Reworded duplicates may be missed/)
  assert.deepEqual(current.opportunities.length, 3)
})
