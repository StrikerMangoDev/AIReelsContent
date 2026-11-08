import test from 'node:test'
import assert from 'node:assert/strict'
import { topicResearchDetails } from '../../src/services/topic-research-details.ts'

test('topic details keep keyword measurements missing and observed questions separate from suggestions', () => {
  const details = topicResearchDetails({ title: 'Model preview', keywords: ['preview', ' preview ', ''], observedQuestions: [{ text: 'Invented user question', evidenceIds: ['E1'] }] })
  assert.equal(details.keywords.length, 1)
  assert.equal(details.keywords[0].intent, null)
  assert.equal(details.keywords[0].searchVolume, null)
  assert.equal(details.keywords[0].intentStatus, 'not-researched')
  assert.deepEqual(details.observedQuestions.items, [])
  assert.equal(details.observedQuestions.status, 'unavailable')
  assert.equal(details.proposedQuestions.status, 'editorial-suggestions')
  assert.equal(details.proposedQuestions.items.length, 2)
  assert.ok(!JSON.stringify(details).includes('Invented user question'))
  assert.deepEqual(topicResearchDetails({ title: 'Empty' }).keywords, [])
})
