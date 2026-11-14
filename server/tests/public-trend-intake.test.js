import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { createRepository } from '../storage/repository.js'
import { normalizeTrendCountry, fetchPublicTrendRss, parsePublicTrendRss, matchPublicTrendEntries, collectPublicTrendIntake } from '../automation/public-trend-intake.js'
import { workflowDestinationSchema } from '../studio/strategy-workflow.js'
import { buildCompletePackage } from '../studio/complete-package.js'

const now = new Date('2026-11-13T08:00:00Z')
const feed = `<?xml version="1.0"?><rss xmlns:ht="https://trends.google.com/trending/rss"><channel><title>Daily search trends</title><item><title>Claude Fable release</title><ht:approx_traffic>2K+</ht:approx_traffic><pubDate>Fri, 13 Nov 2026 07:00:00 GMT</pubDate><ht:news_item><ht:news_item_title>Publisher announces Claude Fable</ht:news_item_title><ht:news_item_url>https://example.com/article</ht:news_item_url></ht:news_item></item><item><title>Football final</title><ht:approx_traffic>100,000+</ht:approx_traffic><pubDate>Fri, 13 Nov 2026 06:00:00 GMT</pubDate></item></channel></rss>`
function fixture(country = 'India', platform = 'X') {
  const repository = createRepository(':memory:')
  const profile = repository.studioPut('alice', 'account_profile', `profile-${platform}`, { accountId: `account-${platform}`, platform, enabled: true, automationConsent: true, automaticPolicy: { version: 'account-automation-v1', scope: 'research-generation-and-social-publishing', consentedBy: 'alice' } }, 0)
  const pack = repository.studioPut('alice', 'package', `pack-${platform}`, { title: 'Claude Fable release', settings: { platform }, content: null }, 0)
  repository.studioPut('alice', 'complete_context', pack.id, { context: { country, workflow: { version: 'strategy-workflow-v1', destinations: [workflowDestinationSchema.parse({ platform, accountId: profile.accountId })] } } }, 0)
  return { repository, owner: 'alice', profile, pack, actorUid: 'alice', now }
}

test('country normalization requires a real explicit country and never infers a global/default feed', () => {
  assert.equal(normalizeTrendCountry('India'), 'IN'); assert.equal(normalizeTrendCountry('in'), 'IN')
  assert.equal(normalizeTrendCountry('United States'), 'US'); assert.equal(normalizeTrendCountry('UK'), 'GB')
  for (const value of ['', undefined, 'Global', 'worldwide', 'Europe', 'ZZ', 'https://localhost', 'made up country', '__proto__', 'constructor', 'toString']) assert.equal(normalizeTrendCountry(value), null)
})

test('official RSS preserves approximate buckets and observed news metadata without inferring search growth', () => {
  const result = parsePublicTrendRss(feed, { country: 'IN', now })
  assert.equal(result.entries.length, 2)
  const entry = result.entries[0]
  assert.equal(entry.query, 'Claude Fable release'); assert.equal(entry.approximateTraffic, '2K+')
  assert.equal(entry.news[0].url, 'https://example.com/article'); assert.equal(entry.news[0].provenance, 'feed_metadata_not_fetched')
  assert.ok(result.limitations.some(value => /cannot establish growth/.test(value)))
  assert.equal(entry.growth, undefined); assert.equal(entry.searchVolume, undefined)
  assert.equal(matchPublicTrendEntries('Claude Fable release', result.entries).length, 1)
  assert.equal(matchPublicTrendEntries('AI technology model update', result.entries).length, 0)
  assert.equal(matchPublicTrendEntries('Football coding model', result.entries).length, 0)
  assert.equal(matchPublicTrendEntries('Claude another different feature', result.entries).length, 0)
  assert.throws(() => parsePublicTrendRss('<!DOCTYPE rss><rss><channel/></rss>', { country: 'IN', now }))
  assert.equal(parsePublicTrendRss(feed.replaceAll('07:00:00', '09:00:00'), { country: 'IN', now }).entries.length, 1, 'Future-dated entries never become current signals')
})

test('RSS transport pins public DNS and rejects redirects, private addresses, non-XML and oversized bodies', async () => {
  await assert.rejects(fetchPublicTrendRss('Global'))
  await assert.rejects(fetchPublicTrendRss('IN', { resolve: async () => [{ address: '127.0.0.1', family: 4 }] }), /public address/)
  for (const kind of ['redirect', 'nonxml', 'oversize', 'valid']) {
    let calls = 0
    const request = (url, options, callback) => {
      calls++; assert.equal(url.hostname, 'trends.google.com'); assert.equal(url.search, '?geo=IN')
      options.lookup('trends.google.com', { all: true }, (_error, addresses) => assert.equal(addresses[0].address, '1.1.1.1'))
      const outgoing = new EventEmitter()
      outgoing.destroy = error => { outgoing.emit('error', error || new Error('Destroyed')); outgoing.emit('close') }
      outgoing.end = () => queueMicrotask(() => {
        const incoming = new PassThrough(); incoming.statusCode = kind === 'redirect' ? 302 : 200; incoming.headers = { 'content-type': kind === 'nonxml' ? 'text/html' : 'text/xml', location: 'https://private.invalid' }
        callback(incoming); incoming.end(kind === 'oversize' ? 'x'.repeat(1024 * 1024 + 1) : feed); outgoing.emit('close')
      })
      return outgoing
    }
    const action = fetchPublicTrendRss('IN', { resolve: async () => [{ address: '1.1.1.1', family: 4 }], request })
    if (kind === 'valid') assert.equal((await action).xml, feed)
    else await assert.rejects(action)
    assert.equal(calls, 1, 'No redirect, news fetch or retry follows')
  }
})

test('all five account intakes share a country cache, return valid source-backed trend patches and keep owner records private', async () => {
  const h = fixture(); let reads = 0
  try {
    for (const platform of ['X', 'Instagram', 'YouTube', 'Facebook', 'LinkedIn']) {
      const profile = h.repository.studioPut('alice', 'account_profile', `profile-${platform}`, { ...h.profile, platform, accountId: `account-${platform}` }, platform === 'X' ? h.profile.revision : 0)
      const pack = platform === 'X' ? h.pack : h.repository.studioPut('alice', 'package', `pack-${platform}`, { ...h.pack, id: `pack-${platform}` }, 0)
      if (platform !== 'X') h.repository.studioPut('alice', 'complete_context', pack.id, { context: { country: 'IN', workflow: { version: 'strategy-workflow-v1', destinations: [workflowDestinationSchema.parse({ platform, accountId: profile.accountId })] } } }, 0)
      const result = await collectPublicTrendIntake({ ...h, profile, pack, fetchRss: async () => { reads++; return { xml: feed } } })
      assert.equal(result.status, 'available'); assert.equal(result.record.country, 'IN')
      assert.equal(result.workflowPatch.trendDecision.mode, 'use_signal')
      const record = result.workflowPatch.researchRecord
      assert.equal(record.trend.periodStart, '2026-11-13T07:00:00.000Z'); assert.equal(record.trend.periodEnd, now.toISOString())
      assert.equal(workflowDestinationSchema.safeParse({ platform, accountId: profile.accountId, researchLog: [record], trendDecision: result.workflowPatch.trendDecision }).success, true)
      assert.equal(h.repository.studioList('outsider', 'public_trend_intake').length, 0)
    }
    assert.equal(reads, 1, 'One explicit-country RSS capture serves cached account reads')
  } finally { h.repository.close() }
})

test('unknown country and irrelevant or unavailable feeds preserve evergreen without invented trend signals', async () => {
  for (const variant of ['unknown', 'irrelevant', 'unavailable']) {
    const h = fixture(variant === 'unknown' ? 'Global' : 'IN'); let reads = 0
    try {
      const result = await collectPublicTrendIntake({ ...h, fetchRss: async () => { reads++; if (variant === 'unavailable') throw Error('Offline'); return { xml: feed.replaceAll('Claude Fable release', 'Unrelated tennis tournament') } } })
      assert.equal(result.workflowPatch, null); assert.equal(result.record.matches.length, 0)
      assert.equal(result.status, variant === 'irrelevant' ? 'not_relevant' : 'unavailable')
      assert.equal(reads, variant === 'unknown' ? 0 : 1)
    } finally { h.repository.close() }
  }
})

test('complete-package projection exposes only this package and selected account trend captures', async () => {
  const h = fixture('Global')
  try {
    const context = h.repository.studioGet('alice', 'complete_context', h.pack.id)
    h.repository.studioPut('alice', 'complete_context', h.pack.id, { ...context, context: { ...context.context, platformAccounts: [{ platform: 'X', accountId: h.profile.accountId }] } }, context.revision)
    const result = await collectPublicTrendIntake({ ...h, fetchRss: async () => assert.fail('No default country feed may be fetched') })
    h.repository.studioPut('alice', 'public_trend_intake', 'unrelated', { ...result.record, accountId: 'other-account', platform: 'Instagram' }, 0)
    const complete = await buildCompletePackage(h.repository, 'alice', { ...h.pack, evidence: [] }, now)
    assert.equal(complete.trendIntakes.length, 1)
    assert.equal(complete.trendIntakes[0].accountId, h.profile.accountId)
    assert.equal(complete.trendIntakes[0].country, null)
    assert.equal(complete.trendIntakes[0].status, 'unavailable')
    assert.ok(complete.sections.find(section => section.id === 'market').value.trendIntakes.length === 1)
  } finally { h.repository.close() }
})

test('consent revocation and concurrent context edits prevent adopting or recording outdated trend intake', async () => {
  for (const variant of ['consent', 'context']) {
    const h = fixture()
    try {
      const run = collectPublicTrendIntake({ ...h, fetchRss: async () => {
        if (variant === 'consent') h.repository.studioPut('alice', 'account_profile', h.profile.id, { ...h.profile, automationConsent: false }, h.profile.revision)
        else { const saved = h.repository.studioGet('alice', 'complete_context', h.pack.id); h.repository.studioPut('alice', 'complete_context', h.pack.id, { ...saved, context: { ...saved.context, country: 'US' } }, saved.revision) }
        return { xml: feed }
      } })
      if (variant === 'consent') await assert.rejects(run, /consent/)
      else assert.equal((await run).status, 'changed')
      assert.equal(h.repository.studioList('alice', 'public_trend_intake').length, 0)
    } finally { h.repository.close() }
  }
})
