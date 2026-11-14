import { createHash } from 'node:crypto'
import { analyzeCompletePackage } from './complete-package-router.js'
import { buildCompletePackage } from './complete-package.js'

export async function prepareAutomaticCompletePackage({ repository, owner, actor, pack, analyze = analyzeCompletePackage, config }) {
  try {
  const saved = await repository.studioGet(owner, 'complete_context', pack.id)
  const context = saved?.context
  if (!pack.content || context?.autoAnalyze !== true || !context.objective || !context.brand || !Object.values(context.productionTools || {}).some(value => typeof value === 'string' && value.trim())) return { status: 'not_requested', reason: 'Automatic production analysis needs a saved objective, brand direction, approved tool and explicit automatic-analysis setting.' }
  const complete = await buildCompletePackage(repository, owner, pack)
  if (['running', 'reserved', 'dispatch_unknown'].includes(complete.analysis.status) || complete.analysis.status === 'completed' && complete.analysis.inputHash === complete.inputHash) return { status: complete.analysis.status, reason: 'The current saved attempt is reused; no second analysis was started.' }
  const digest = createHash('sha256').update(JSON.stringify([owner, pack.id, complete.inputHash])).digest('hex')
  const requestId = `${digest.slice(0, 8)}-${digest.slice(8, 12)}-5${digest.slice(13, 16)}-8${digest.slice(17, 20)}-${digest.slice(20, 32)}`
    const result = await analyze({ repository, owner, actor, pack, input: { requestId, contentHash: complete.contentHash, contextRevision: complete.contextRevision }, ...(config ? { config } : {}) })
    return { status: result.body?.analysis?.status || result.body?.completePackage?.analysis?.status || 'blocked', reason: result.body?.error || null }
  } catch {
    return { status: 'blocked', reason: 'Automatic production analysis could not be admitted. Saved writing is preserved; inspect the complete-package analysis status before retrying.' }
  }
}
