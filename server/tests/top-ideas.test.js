import test from 'node:test'
import assert from 'node:assert/strict'
import { selectTopIdeas } from '../studio/top-ideas.js'
import express from 'express'
import { once } from 'node:events'
import { intelligenceRouter } from '../studio/intelligence.js'
const now = Date.parse('2026-11-02T12:00:00Z')
const report = (id, count = 12) => ({ id, nicheId: id, niche: { name: id, refreshIntervalDays: 7 }, researchedAt: '2026-11-01T12:00:00Z', evidence: [{ id: 'E1', url: 'https://example.com/article', excerpt: 'A sufficiently long saved publisher excerpt explaining the announcement.', type: 'publisher-excerpt', limitations: ['Excerpt only'] }], opportunities: Array.from({length: count}, (_,i) => ({ title: `${id} idea ${i}`, verification: 'reported', evidenceIds: ['E1'], angle: 'Explain the practical implications', whyItMatters: 'Useful for readers' })) })
test('shortlist is selective, bounded, deterministic and retains evidence', () => {
  const result = selectTopIdeas([report('a'),report('b'),report('c'),report('d'),report('e')],now)
  assert.equal(result.considered,60); assert.equal(result.ideas.length,12)
  assert.ok(result.ideas.every(idea => result.ideas.filter(other=>other.categoryId===idea.categoryId).length<=3))
  assert.deepEqual(result,selectTopIdeas([report('a'),report('b'),report('c'),report('d'),report('e')],now))
  assert.equal(result.ideas[0].sources[0].limitations[0],'Excerpt only')
})
test('rejects disputed and broken evidence; deduplicates titles across categories', () => {
  const a=report('a',4); a.opportunities[0].verification='disputed'; a.opportunities[1].evidenceIds=['missing']; a.opportunities[2].angle=''
  const b=report('b',1); b.opportunities[0].title=a.opportunities[3].title
  const result=selectTopIdeas([a,b],now)
  assert.equal(result.considered,5); assert.equal(result.ideas.length,1); assert.equal(result.ideas[0].index,3)
  a.evidence[0].url='http://example.com'; assert.equal(selectTopIdeas([a],now).ideas.length,0)
})
test('freshness prioritizes recent research; low support is not padded', () => {
  const old=report('old',1); old.researchedAt='2026-01-01T12:00:00Z'; old.evidence[0].type='search-grounded-summary'
  assert.equal(selectTopIdeas([old],now).ideas.length,0)
  old.evidence[0].type='publisher-excerpt'; const result=selectTopIdeas([old,report('fresh',1)],now)
  assert.equal(result.ideas[0].categoryId,'fresh'); assert.equal(result.ideas[0].fresh,true)
  assert.deepEqual(selectTopIdeas([],now),{ideas:[],considered:0,categoryCount:0})
})
test('top ideas reads only latest reports in the authenticated scope, without provider calls', async () => {
  const reads = []
  const repository = {
    async studioList(uid, kind) { reads.push([uid, kind]); return [{ id: 'category', reportId: 'latest' }, { id: 'empty' }] },
    async studioGet(uid, kind, id) { reads.push([uid, kind, id]); return kind === 'research' ? { ...report('latest'), researchedAt: new Date().toISOString() } : null },
  }
  const auth = (req, res, next) => { if (!req.headers.authorization) return res.sendStatus(401); req.identity = { uid: req.headers.authorization }; next() }
  const app = express(); app.use(intelligenceRouter({ repository, auth, research: () => assert.fail('No research call expected'), assist: () => assert.fail('No model call expected') }))
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening')
  try {
    const url = `http://127.0.0.1:${server.address().port}/top-ideas`
    assert.equal((await fetch(url)).status,401)
    const response = await fetch(url, {headers: {authorization: 'alice'}})
    assert.equal(response.status,200); assert.equal(response.headers.get('cache-control'),'no-store')
    const data = await response.json(); assert.equal(data.considered,12); assert.equal(data.role,'owner')
    assert.ok(reads.every(([uid]) => uid === 'alice'))
    assert.deepEqual(reads.filter(([,kind]) => kind === 'research'), [['alice','research','latest']])
  } finally { await new Promise(resolve => server.close(resolve)) }
})
