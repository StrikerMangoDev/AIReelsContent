import test from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { randomUUID } from 'node:crypto'
import { createApp } from '../http/app.js'
import { createRepository } from '../storage/repository.js'
import { attributeOrganizations } from '../config/organizations.js'
import { firebaseCredentials } from '../auth/firebase.js'

test('Firebase uses inline Google credentials without a credential file and preserves explicit Firebase precedence', () => {
  const google = JSON.stringify({ project_id: 'google-project', client_email: 'google@example.com' })
  const firebase = JSON.stringify({ project_id: 'firebase-project', client_email: 'firebase@example.com' })
  const noFile = () => { throw new Error('Must not read a credential file') }
  assert.deepEqual(firebaseCredentials({ GOOGLE_SERVICE_ACCOUNT_JSON: google }, noFile), JSON.parse(google))
  assert.deepEqual(firebaseCredentials({ FIREBASE_ADMIN_SERVICE_ACCOUNT_JSON: firebase, GOOGLE_SERVICE_ACCOUNT_JSON: google, FIREBASE_ADMIN_CREDENTIALS: 'unused' }, noFile), JSON.parse(firebase))
  const paths = []
  const read = (path, encoding) => { paths.push([path, encoding]); return firebase }
  assert.deepEqual(firebaseCredentials({ FIREBASE_ADMIN_CREDENTIALS: 'firebase.json', GOOGLE_SERVICE_ACCOUNT_JSON: google }, read), JSON.parse(firebase))
  firebaseCredentials({ GOOGLE_APPLICATION_CREDENTIALS: 'google.json' }, read)
  assert.deepEqual(paths, [['firebase.json', 'utf8'], ['google.json', 'utf8']])
  assert.throws(() => firebaseCredentials({ FIREBASE_ADMIN_SERVICE_ACCOUNT_JSON: 'invalid', GOOGLE_SERVICE_ACCOUNT_JSON: google }, noFile), SyntaxError)
})

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
