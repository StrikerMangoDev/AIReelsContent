let pending
export default async function handler(request, response) {
  try {
    pending ??= Promise.all([import('../server/http/app.js'), import('../server/storage/index.js'), import('../server/config/sources.js')])
      .then(([{ createApp }, { repository }, { sources }]) => createApp({ repository, sources }))
    const app = await pending
    return app(request, response)
  } catch (error) {
    pending = undefined
    // Record only diagnostic identifiers; SDK/config errors can contain secret values.
    console.error(JSON.stringify({ event: 'api_startup_failed', type: error.name, code: error.code || null, fields: error.issues?.map(issue => issue.path.join('.')) || [] }))
    response.status(503).json({ error: 'API startup failed. Check server runtime logs.' })
  }
}
