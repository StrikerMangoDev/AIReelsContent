import test from 'node:test'
import assert from 'node:assert/strict'
import { nativePublishedUrl } from '../publishing/provider.js'
import { createPublishingService } from '../publishing/router.js'
import { createRepository } from '../storage/repository.js'

const examples = {
  X: ['https://x.com/creator/status/123', 'https://twitter.com/creator/status/123'],
  Instagram: ['https://www.instagram.com/reel/123/'],
  Facebook: ['https://www.facebook.com/creator/posts/123', 'https://fb.watch/123/'],
  YouTube: ['https://www.youtube.com/watch?v=123', 'https://youtu.be/123'],
  LinkedIn: ['https://www.linkedin.com/posts/creator-123'],
}

for (const [platform, urls] of Object.entries(examples)) test(`${platform} publication requires its own native HTTPS destination`, () => {
  for (const url of urls) assert.equal(nativePublishedUrl(platform, url), url)
  for (const [other, alternatives] of Object.entries(examples)) if (other !== platform) for (const url of alternatives) assert.equal(nativePublishedUrl(platform, url), null)
  const host = new URL(urls[0]).hostname
  for (const value of [null, '', 42, `http://${host}/post`, `https://${host}/`, `https://${host}/?post=123`, `https://${host}/#post`, `https://${host}.evil.test/post`, `https://${host}@evil.test/post`, `https://user:password@${host}/post`, `https://${host}:8443/post`, 'https://example.com/post', ` https://${host}/post`, 'not a URL']) assert.equal(nativePublishedUrl(platform, value), null)
})

test('unknown platforms cannot attest native publication', () => {
  assert.equal(nativePublishedUrl('Other', 'https://x.com/creator/status/123'), null)
})

test('provider PUBLISHED state alone cannot mark a nonnative receipt published on any platform', async () => {
  const repository = createRepository(':memory:')
  try {
    for (const [platform, urls] of Object.entries(examples)) {
      const accountId = `account-${platform}`
      repository.studioPut('alice', 'social_publication', platform, { platform, accountId, providerPostId: 'actual-provider-id', caption: 'Exact saved copy.', createdAt: new Date().toISOString(), status: 'submitted' }, 0)
      let releaseURL = 'https://example.com/arbitrary-post'
      const service = createPublishingService({ repository, config: () => ({ enabled: true, accounts: [{ ownerScope: 'alice', accountId, platform }] }), provider: { list: async () => [{ id: 'actual-provider-id', integration: { id: accountId }, content: 'Exact saved copy.', state: 'PUBLISHED', releaseURL }] } })
      let receipt = await service.refresh({ owner: 'alice', actorUid: 'alice', id: platform })
      assert.equal(receipt.providerState, 'PUBLISHED'); assert.equal(receipt.status, 'submitted'); assert.equal(receipt.releaseUrl, null)
      releaseURL = urls[0]
      receipt = await service.refresh({ owner: 'alice', actorUid: 'alice', id: platform })
      assert.equal(receipt.status, 'published'); assert.equal(receipt.releaseUrl, releaseURL)
    }
  } finally { repository.close() }
})
