import test from 'node:test'
import assert from 'node:assert/strict'
import { PGlite } from '@electric-sql/pglite'
import { createRepository } from '../storage/repository.js'
import { reserveFreeOperation } from '../budget/free-operation.js'
import { costScopeHash } from '../budget/policy.js'
import { contentHash } from '../studio/approval.js'
import { runContentJob, recoverRejectedGeneration } from '../studio/job-worker.js'
import { createHash } from 'node:crypto'

test('generation budget integrity survives real PostgreSQL jsonb key reordering', async () => {
  const db = new PGlite(), storage = createRepository(':memory:')
  const roundtrip = async value => value == null ? value : (await db.query('select $1::jsonb value', [JSON.stringify(value)])).rows[0].value
  const repository = { ...storage, studioGet: async (...args) => roundtrip(storage.studioGet(...args)), studioJobGet: async (...args) => roundtrip(storage.studioJobGet(...args)), budgetGet: async (...args) => roundtrip(storage.budgetGet(...args)) }
  try {
    storage.studioPut('alice','package','draft',{settings:{outputs:['website'],platform:'X'},content:null,evidence:[{id:'E1',excerpt:'The publisher announced a preview.',hash:'source'}],status:'draft'},0)
    const draft = await repository.studioGet('alice','package','draft')
    const scope = { packageId:'draft',revision:draft.revision,instruction:'',operation:'generation',actorUid:'alice',contentHash:contentHash(draft),generationProvider:'free' }
    const reserved = await storage.studioJobReserve('alice','jsonb-job','a'.repeat(64),10,scope)
    const cost = await reserveFreeOperation(repository,'alice','jsonb-job',scope)
    const persistedScope = await roundtrip(scope), persistedQuote = await roundtrip(cost.quote)
    const legacyHash = createHash('sha256').update(JSON.stringify({scope,quote:cost.quote})).digest('hex')
    const reorderedLegacyHash = createHash('sha256').update(JSON.stringify({scope:persistedScope,quote:persistedQuote})).digest('hex')
    assert.notEqual(legacyHash,reorderedLegacyHash,'fixture reproduces the production hash mismatch')
    assert.equal(costScopeHash(scope,cost.quote),costScopeHash(persistedScope,persistedQuote))
    assert.notEqual(costScopeHash(scope,cost.quote),costScopeHash({...persistedScope,actorUid:'mallory'},persistedQuote))
    await storage.studioPut('alice','package','draft',{...draft,jobId:reserved.job.id,status:'generating'},draft.revision)
    await storage.studioJobUpdate('alice',reserved.job.id,{status:'reserved',ready:true},reserved.job.revision,'reserved')
    let calls=0
    const result=await runContentJob({repository,uid:'alice',requestId:reserved.job.id,generate:async()=>{calls++;return {website:{title:'Preview [C1]',body:'The publisher announced a preview [C1].'},claims:[{id:'C1',text:'The publisher announced a preview.',evidenceId:'E1',quote:'The publisher announced a preview.',status:'attributed'}]}}})
    assert.equal(result.status,'completed');assert.equal(calls,1)
    assert.equal((await repository.studioGet('alice','package','draft')).status,'completed')
  } finally {storage.close();await db.close()}
})

test('a confirmed pre-dispatch failure marks the package failed and safely reconciles old stuck packages', async () => {
 const repository=createRepository(':memory:')
 try {
  const draft=repository.studioPut('alice','package','draft',{settings:{outputs:['website'],platform:'X'},content:null,evidence:[],status:'draft'},0)
  const scope={packageId:'draft',revision:draft.revision,operation:'generation',actorUid:'alice',contentHash:contentHash(draft)}
  const {job}=await repository.studioJobReserve('alice','blocked-job','a'.repeat(64),10,scope)
  await reserveFreeOperation(repository,'alice',job.id,scope)
  repository.studioPut('alice','package','draft',{...draft,jobId:job.id,status:'generating'},draft.revision)
  await repository.studioJobUpdate('alice',job.id,{status:'reserved',ready:true},job.revision,'reserved')
  // Corrupting the quote must still fail closed before any provider call.
  const get=repository.budgetGet;repository.budgetGet=async(...args)=>{const cost=await get(...args);return cost?.status==='reserved'?{...cost,scopeHash:'incorrect'}:cost}
  let calls=0
  assert.equal((await runContentJob({repository,uid:'alice',requestId:job.id,generate:async()=>{calls++}})).status,'failed')
  assert.equal(calls,0)
  const failed=await repository.studioGet('alice','package','draft');assert.equal(failed.status,'failed')
  const stuck=repository.studioPut('alice','package','draft',{...failed,status:'generating',error:null},failed.revision)
  assert.equal((await recoverRejectedGeneration({repository,uid:'alice',packageId:'draft',revision:stuck.revision})).status,'failed')
  const cost=await get('alice',job.id);assert.equal(cost.status,'cancelled')
  repository.budgetGet=async(...args)=>{const value=await get(...args);return value?{...value,status:'dispatch_unknown'}:value}
  await assert.rejects(recoverRejectedGeneration({repository,uid:'alice',packageId:'draft',revision:(await repository.studioGet('alice','package','draft')).revision}),/reconciliation/)
 } finally {repository.close()}
})
