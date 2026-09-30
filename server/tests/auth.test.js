import test from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { randomUUID } from 'node:crypto'
import { createApp } from '../http/app.js'
import { createRepository } from '../storage/repository.js'
import { attributeOrganizations } from '../config/organizations.js'

test('admin APIs enforce verified identity and analytics requires explicit consent', async () => {
  const repository = createRepository(':memory:')
  const server = createApp({ repository, sources: [], verifyIdentity: async token => ({ uid: token, email: token === 'user' ? 'reader@example.com' : 'yeshaswi3@gmail.com', email_verified: token !== 'unverified' }) }).listen(0,'127.0.0.1')
  await once(server,'listening')
  const base = `http://127.0.0.1:${server.address().port}`
  try {
    assert.equal((await fetch(`${base}/api/admin/overview`)).status,401)
    for (const token of ['user','unverified']) assert.equal((await fetch(`${base}/api/admin/overview`,{headers:{Authorization:`Bearer ${token}`}})).status,403)
    assert.equal((await fetch(`${base}/api/admin/overview`,{headers:{Authorization:'Bearer verified'}})).status,200)
    const event = {sessionId:randomUUID(),type:'page_view',path:'/dashboard'}
    const send = value => fetch(`${base}/api/events`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)})
    assert.equal((await send(event)).status,400)
    assert.equal((await send({...event,consent:true,role:'admin'})).status,400)
    assert.equal((await send({...event,consent:true})).status,202)
    assert.equal(repository.adminOverview().sessions,1)
  } finally { await new Promise(resolve=>server.close(resolve)); repository.close() }
})
test('organization attribution never infers geography from the publisher alone',()=>{
  assert.deepEqual(attributeOrganizations({title:'A new model',sourceName:'NVIDIA',regions:[]}).regions,[])
  const article = attributeOrganizations({title:'NVIDIA announces new chips',regions:[]})
  assert.deepEqual(article.regions,['United States'])
  assert.equal(article.regionBasis,'organization')
})
