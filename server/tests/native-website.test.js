import test from 'node:test'
import assert from 'node:assert/strict'
import { nativeWebsiteDestination } from '../studio/native-website.js'
import { capabilityAllowed } from '../policy.js'
import { buildSeoWorkflow } from '../studio/seo-workflow.js'

test('native website publishing requires its exact opt-in and grants no other capability', () => {
  for (const flag of [undefined, false, true, 'false', 'TRUE', '1']) {
    assert.equal(nativeWebsiteDestination({ CONTENT_NATIVE_WEBSITE_PUBLISHING: flag }).status, 'disabled')
  }
  const config = { CONTENT_NATIVE_WEBSITE_PUBLISHING: 'true' }
  assert.equal(nativeWebsiteDestination(config).status, 'available')
  assert.equal(nativeWebsiteDestination(config).automatic, false)
  assert.equal(capabilityAllowed('generation', config), false)
  assert.equal(capabilityAllowed('media', config), false)
})

test('SEO exposes native destination without inventing publication or external connections', () => {
  const report = buildSeoWorkflow({ settings: { outputs: ['website'] } })
  assert.ok(report.connections.find(item => item.id === 'native_website'))
  for (const id of ['cms', 'search_console', 'ga4', 'keyword_provider']) {
    assert.equal(report.connections.find(item => item.id === id).status, 'not_connected')
  }
  assert.equal(report.status, 'not_started')
  assert.equal(report.publication, undefined)
})
