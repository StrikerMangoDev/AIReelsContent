import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { reviewContent } from '../studio/content.js'

test('text storyboards preserve narration and citations without inventing content or exceeding scene limits', async () => {
  const source = await readFile(new URL('../../src/services/storyboard.ts', import.meta.url), 'utf8')
  const exports = {}
  runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports })
  for (const script of ['One source [C1]. Another source [C2]. Read both.', Array.from({ length: 25 }, (_, i) => `Claim ${i} [C1].`).join(' '), 'Single sentence [C1]']) {
    const scenes = exports.storyboardFromScript(script)
    assert.equal(scenes.map(scene => scene.narration).join(' '), script)
    assert.ok(scenes.length <= 20)
    assert.ok(scenes.every(scene => scene.onScreen === scene.narration))
  }
  assert.equal(exports.storyboardFromScript('  ').length, 0)
  const settings = { outputs: ['script', 'production'], platform: 'Instagram', audience: 'Readers', language: 'English', voice: 'Female' }
  const evidence = [{ id: 'E1', excerpt: 'A source published a weekly horoscope.' }]
  const content = { script: 'A source published a weekly horoscope [C1]. Read the original before sharing.', hooks: ['A weekly headline [C1]'], claims: [{ id: 'C1', text: 'A source published a weekly horoscope.', evidenceId: 'E1', quote: evidence[0].excerpt, status: 'attributed' }] }
  const prepared = exports.prepareStoryboard(content, settings)
  assert.equal(prepared.script, content.script)
  assert.equal(prepared.claims, content.claims)
  assert.deepEqual(reviewContent(prepared, evidence, settings).issues, [])
})
