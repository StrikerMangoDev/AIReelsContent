import test from 'node:test'
import assert from 'node:assert/strict'
import { safeRedirect } from '../../src/services/safe-redirect.ts'

test('auth return destinations preserve reviewer routes and reject external or unrelated paths', () => {
  for (const path of ['/studio', '/studio/package-1', '/studio-review/owner/package-1', '/dashboard?tab=saved', '/ideas', '/ideas/category-1', '/ideas/category-1/edit', '/find-ideas', '/planning', '/workspaces', '/']) assert.equal(safeRedirect(path), path)
  for (const path of [null, 'https://example.com', '//example.com', '/\\example.com', '/studio/../../admin', '/studioevil', '/ideasevil', '/ideas/a/b/c', '/find-ideasevil', '/login', '/studio\n', '/studio-review/owner']) assert.equal(safeRedirect(path), '/')
})
