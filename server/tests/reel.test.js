import test from 'node:test'
import assert from 'node:assert/strict'
import { captionTimeline, subtitles, validateNarration } from '../../src/services/reel.ts'

test('caption timing covers actual audio duration, removes citations and supports Hindi text', () => {
  const script = 'यह नया मॉडल [C1] अभी केवल एक परीक्षण है और हमें अधिक जानकारी चाहिए'
  const captions = captionTimeline(script, 12.5)
  assert.equal(captions[0].start, 0); assert.equal(captions.at(-1).end, 12.5)
  assert.equal(captions.map(item => item.text).join(' ').includes('[C1]'), false)
  for (let i = 1; i < captions.length; i++) assert.equal(captions[i - 1].end, captions[i].start)
  assert.match(subtitles(script, 12.5), /00:00:12,500/)
  assert.throws(() => captionTimeline('', 10)); assert.throws(() => captionTimeline('test', Infinity))
  assert.doesNotThrow(() => validateNarration('First [C1]. Second.', [{ narration: 'First.', onScreen: 'First' }, { narration: 'Second.', onScreen: 'Second' }]))
  assert.throws(() => validateNarration('Edited narration.', [{ narration: 'Old narration.', onScreen: 'Old' }]))
  assert.throws(() => validateNarration('Narration.', []))
})
