import { Router } from 'express'
import { z } from 'zod'
import { createHash } from 'node:crypto'
import { mediaConfig, generateMedia, refreshVideo } from './provider.js'
import { saveMediaFile, readMediaFile, signedMediaUrl } from './files.js'

const schema = z.object({ kind: z.enum(['image', 'audio', 'video']), prompt: z.string().trim().min(10).max(4000), requestId: z.string().uuid(), confirmCost: z.literal(true) }).strict()
const publicAsset = ({ operation: _operation, ...asset }) => asset
const assetId = (uid, requestId) => {
  const hash = createHash('sha256').update(`${uid}:${requestId}`).digest('hex')
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`
}

export function createMediaRouter({ repository, auth, generate = generateMedia, refresh = refreshVideo, saveFile = saveMediaFile, readFile = readMediaFile, config = mediaConfig }) {
  const router = Router()
  router.get('/api/studio/media/config', (_req, res) => res.json(config()))
  const protect = [auth, (_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next() }]
  router.get('/api/studio/packages/:id/assets', ...protect, async (req, res) => {
    if (!await repository.studioGet(req.identity.uid, 'package', req.params.id)) return res.status(404).json({ error: 'Content package not found' })
    const assets = (await repository.studioList(req.identity.uid, 'asset')).filter(asset => asset.packageId === req.params.id)
    res.json({ assets: assets.map(publicAsset) })
  })
  async function finish(uid, asset, result) {
    if (result.operation) return repository.studioPut(uid, 'asset', asset.id, { ...asset, operation: result.operation }, asset.revision)
    await saveFile(asset.id, result.bytes, result.mime)
    return repository.studioPut(uid, 'asset', asset.id, { ...asset, status: 'completed', mime: result.mime, bytes: result.bytes.length, operation: null }, asset.revision)
  }
  router.post('/api/studio/packages/:id/assets', ...protect, async (req, res) => {
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: 'Choose media, enter a prompt, and confirm the estimated cost.' })
    const input = parsed.data; const uid = req.identity.uid
    const pack = await repository.studioGet(uid, 'package', req.params.id)
    if (!pack) return res.status(404).json({ error: 'Content package not found' })
    if (!pack.content) return res.status(422).json({ error: 'Generate and save a script before producing assets.' })
    const id = assetId(uid, input.requestId)
    const previous = await repository.studioGet(uid, 'asset', id)
    if (previous) {
      if (previous.packageId !== pack.id || previous.kind !== input.kind || previous.prompt !== input.prompt) return res.status(409).json({ error: 'Request identifier already used for different media.' })
      return res.json(publicAsset(previous))
    }
    const capability = config()[input.kind]
    if (!capability?.enabled) return res.status(503).json({ error: 'This media provider is not configured. Production requires a model, a cost estimate, and private asset storage.' })
    // Separate quota bucket: media usage never consumes content-writing allowance.
    const reservation = await repository.studioReserve(`${uid}:media`, input.requestId, 10)
    if (!reservation.reserved) return res.status(409).json({ error: 'This request was already submitted. Reload assets before retrying.' })
    const asset = await repository.studioPut(uid, 'asset', id, { packageId: pack.id, packageRevision: pack.revision, kind: input.kind, prompt: input.prompt, estimatedUsd: capability.estimatedUsd, status: 'running', error: null }, 0)
    try {
      res.status(201).json(publicAsset(await finish(uid, asset, await generate(input.kind, input.prompt))))
    } catch {
      const failed = await repository.studioPut(uid, 'asset', id, { ...asset, status: 'failed', error: 'Media generation or storage failed. Provider usage may still have been charged; retry creates a new request.' }, asset.revision)
      res.status(502).json(publicAsset(failed))
    }
  })
  router.post('/api/studio/assets/:id/refresh', ...protect, async (req, res) => {
    const uid = req.identity.uid; const asset = await repository.studioGet(uid, 'asset', req.params.id)
    if (!asset) return res.status(404).json({ error: 'Asset not found' })
    if (asset.status !== 'running' || !asset.operation) return res.json(publicAsset(asset))
    try { res.json(publicAsset(await finish(uid, asset, await refresh(asset.operation)))) }
    catch (error) {
      if (error.code === 'STUDIO_CONFLICT') return res.status(409).json({ error: 'Asset changed; reload before polling again.' })
      if (error.code === 'MEDIA_TERMINAL' || [400, 403, 404].includes(Number(error.status))) {
        const failed = await repository.studioPut(uid, 'asset', asset.id, { ...asset, status: 'failed', operation: null, error: 'Video generation failed or returned no downloadable output. Provider usage may still have been charged.' }, asset.revision)
        return res.status(502).json(publicAsset(failed))
      }
      // A transport failure does not prove a long-running provider job failed.
      res.status(502).json({ error: 'Provider status is unavailable. Retry status refresh; no new generation was started.' })
    }
  })
  router.get('/api/studio/assets/:id/file', ...protect, async (req, res) => {
    const asset = await repository.studioGet(req.identity.uid, 'asset', req.params.id)
    if (!asset || asset.status !== 'completed') return res.status(404).json({ error: 'Completed asset not found' })
    const signedUrl = await signedMediaUrl(asset.id)
    if (signedUrl) return res.redirect(302, signedUrl)
    res.setHeader('Content-Type', asset.mime)
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.send(await readFile(asset.id))
  })
  router.use((error, _req, res, next) => {
    if (error.code === 'STUDIO_QUOTA') return res.status(429).json({ error: 'Daily media limit reached (10 requests).' })
    if (error.code === 'STUDIO_CONFLICT') return res.status(409).json({ error: 'Asset changed. Reload before retrying.' })
    next(error)
  })
  return router
}
