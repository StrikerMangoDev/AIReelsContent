import { assertCapability } from './policy.js'

if (process.argv.length !== 3 || process.argv[2] !== '--once') throw new Error('Content worker requires explicit --once; no background scheduler is started.')
assertCapability('generation')
const { repository } = await import('./storage/index.js')
try {
  const { runPendingContentJobs } = await import('./studio/job-worker.js')
  for (const result of await runPendingContentJobs(repository)) console.log(JSON.stringify({ event: 'content_job', id: result.jobId, status: result.status }))
} finally { repository.close() }
