import { runContentJob } from './job-worker.js'

// Opt-in local convenience, never a scheduler or a scan of durable pending jobs.
function localDispatcher({ repository, enabled, host, nodeEnv, vercel, run = runContentJob, report = () => {} }, operation) {
  if (enabled !== 'true' || !['127.0.0.1', '::1', 'localhost'].includes(host) || nodeEnv === 'production' || vercel) return undefined
  let tail = Promise.resolve()
  return ({ uid, requestId }) => {
    tail = tail.then(() => new Promise(resolve => setImmediate(resolve))).then(async () => {
      const job = await repository.studioJobGet(uid, requestId)
      if (job?.status !== 'reserved' || job.ready !== true || job.scope?.operation !== operation || job.scope?.purpose === 'idea-assistance') return
      const result = await run({ repository, uid, requestId })
      report({ event: `local_${operation}_job`, jobId: requestId, status: result.status, code: result.code, diagnostics: result.diagnostics })
    }).catch(() => { report({ event: `local_${operation}_dispatch_failed`, jobId: requestId }) })
    // Admission returns immediately; polling reads the durable worker state.
  }
}

export const localResearchDispatcher = options => localDispatcher(options, 'research')
export const localGenerationDispatcher = options => localDispatcher(options, 'generation')
