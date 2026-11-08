import test from 'node:test'
import assert from 'node:assert/strict'
import { vercelJobDispatcher } from '../../api/[...path].js'

test('Vercel retains exactly the admitted durable job without scanning or blocking admission', async () => {
  const repository = {}; const retained = []; const calls = []
  let complete
  const dispatch = vercelJobDispatcher(repository, promise => retained.push(promise), input => {
    calls.push(input)
    return new Promise(resolve => { complete = resolve })
  })
  assert.equal(dispatch({ uid: 'owner', requestId: 'admitted-job' }), undefined)
  assert.deepEqual(calls, [{ repository, uid: 'owner', requestId: 'admitted-job' }])
  assert.equal(retained.length, 1)
  complete({ status: 'completed' })
  await retained[0]
})
