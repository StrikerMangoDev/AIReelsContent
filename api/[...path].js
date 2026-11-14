import { waitUntil } from '@vercel/functions'
import { runContentJob } from '../server/studio/job-worker.js'
import { dispatchAutomation } from './automation.js'

export function vercelJobDispatcher(repository, retain = waitUntil, run = runContentJob) {
  return ({ uid, requestId }) => {
    // Retain only this admitted job; the durable worker enforces membership, claim and budget checks.
    retain(run({ repository, uid, requestId }).catch(error => {
      console.error(JSON.stringify({ event: 'vercel_job_failed', jobId: requestId, code: error.code || null }))
    }))
  }
}

// Vercel adds the catch-all path as query metadata; it is not an application filter.
export function apiRequestUrl(requestUrl) {
  const url = new URL(requestUrl, 'http://localhost')
  const paths = url.searchParams.getAll('path')
  if (paths.length === 1 && paths[0] === url.pathname.replace(/^\/api\//, '')) url.searchParams.delete('path')
  return url.pathname + url.search
}

let pending
export default async function handler(request, response) {
  try {
    request.url = apiRequestUrl(request.url)
    pending ??= Promise.all([import('../server/http/app.js'), import('../server/storage/index.js'), import('../server/config/sources.js')])
      .then(([{ createApp }, { repository }, { sources }]) => {
        const dispatch = vercelJobDispatcher(repository)
        return createApp({ repository, sources, onResearchAdmitted: dispatch, onGenerationAdmitted: dispatch, onAutomationAdmitted: input => dispatchAutomation(input, repository) })
      })
    const app = await pending
    return app(request, response)
  } catch (error) {
    pending = undefined
    // Record only diagnostic identifiers; SDK/config errors can contain secret values.
    console.error(JSON.stringify({ event: 'api_startup_failed', type: error.name, code: error.code || null, fields: error.issues?.map(issue => issue.path.join('.')) || [] }))
    response.status(503).json({ error: 'API startup failed. Check server runtime logs.' })
  }
}
