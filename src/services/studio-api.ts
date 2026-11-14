import { authHeaders } from '@/services/firebase'
import { activeWorkspace, workspaceIdentity } from './workspace-session'
export type OutputFormat = 'script' | 'captions' | 'website' | 'platforms' | 'production'
export type StudioProfile = { industry: string; audience: string; language: string; tone: string; platform: string; duration: number; voice?: 'Auto' | 'Female' | 'Male'; outputs?: OutputFormat[] }
export type ContentStrategy = { angle: string; audience: string; whyNow: string; factCheck: string; language: 'English' | 'Hindi' | 'Hinglish'; languageReason: string; voice: 'Female' | 'Male'; voiceReason: string; delivery: string; keywords: string[]; platforms?: { platform: 'Facebook' | 'Instagram' | 'X' | 'LinkedIn' | 'YouTube'; headline: string; hook: string; body: string; cta: string; hashtags: string[]; thumbnail: string; format: string; retentionPlan: string; alternativeHook: string; testPlan: string }[]; production?: { videoPrompt: string; audioPrompt: string; musicDirection: string; subtitleStyle: string; editingNotes: string }; experiments?: { variable: string; variantA: string; variantB: string; metric: string; decisionRule: string }[] }
export type StudioContent = { hooks?: string[]; script?: string; scenes?: { timing: string; narration: string; onScreen: string; visualPrompt: string; voiceDirection: string }[]; captions?: { reel: string; linkedin: string }; website?: { title: string; body: string }; claims: { id: string; text: string; evidenceId: string; quote: string; status: string }[]; strategy?: ContentStrategy }
export const qualityDimensions = { relevance: 'Audience relevance', originality: 'Originality', clarity: 'Clarity', hookStrength: 'Hook strength', brandFit: 'Brand fit', factualAccuracy: 'Factual support', cta: 'Call to action' } as const
export type QualityDimension = keyof typeof qualityDimensions
export type QualityRating = { score: number; note: string; evidenceIds: string[] }
export type ContentQuality = { policyVersion: string; ratings: Record<QualityDimension, QualityRating>; overall: number; eligible: boolean }
export type StudioPackage = { researchId?: string; opportunityIndex?: number; researchContext?: { brief: string; opportunity: { title: string; whatChanged: string; angle: string }; researchedAt: string }; approval?: { method?: string; approvedBy?: string; approvedAt?: string; contentHash?: string } | null; sourceIds?: string[]; jobId?: string; jobStatus?: string; reviewerId?: string; independentReview?: {status: string; reviewerId?: string; contentHash?: string; expiresAt?: string; quality?: ContentQuality} | null; id: string; title: string; articleId?: string; settings: StudioProfile; evidence: { id: string; url: string; title: string; publisher: string; excerpt: string; retrievedAt: string; publishedAt?: string; type: string; limitations: string[] }[]; content: StudioContent | null; status: string; editorialStatus: string; revision: number; review: { issues: string[] } | null; error?: string; createdAt: string; updatedAt: string }
export type StudioConfig = { industries: string[]; capabilities: { generation: boolean; research?: boolean; media: boolean; publishing: boolean; researchScheduling?: boolean; vertexFallback?: boolean }; dailyGenerationLimit: number }
export async function studioAuthHeaders(): Promise<Record<string, string>> {
  const workspace = activeWorkspace(); const actor = workspaceIdentity()
  const headers = await authHeaders()
  if (actor !== workspaceIdentity()) throw new Error('Account changed. Review your inputs before retrying.')
  return { ...headers, 'X-Workspace-Id': workspace, ...(actor ? { 'X-Actor-Id': actor } : {}) }
}
export async function studioRequest<T>(path: string, body?: unknown, method = 'GET', authenticated = true, signal?: AbortSignal): Promise<T> {
  const headers = authenticated ? await studioAuthHeaders() : {}
  signal?.throwIfAborted()
  const response = await fetch(`/api/studio${path}`, { method, signal, headers: { Accept: 'application/json', ...headers, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) }, ...(body !==undefined ? { body: JSON.stringify(body) } : {}) })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    const message = typeof data.error === 'string' ? data.error : typeof data.message === 'string' ? data.message : `Request failed (${response.status}). Please retry.`
    const details = Array.isArray(data.issues) ? data.issues : Array.isArray(data.details) ? data.details : []
    const issues = details.slice(0, 5).flatMap((issue: { message?: unknown }) => typeof issue?.message === 'string' ? [issue.message] : [])
    throw Object.assign(new Error([message, ...new Set(issues)].join('. ')), { status: response.status })
  }
  return data as T
}

export async function studioAssetBlob(id: string, signal?: AbortSignal): Promise<Blob> {
  const actor = workspaceIdentity(); const workspace = activeWorkspace()
  const headers = await studioAuthHeaders()
  signal?.throwIfAborted()
  if (actor !== workspaceIdentity() || workspace !== activeWorkspace()) throw new Error('Workspace changed. Try again in your current workspace.')
  const response = await fetch(`/api/studio/assets/${encodeURIComponent(id)}/file`, { headers, signal })
  if (!response.ok) throw new Error('Could not load this generated asset. Check access and try again.')
  const blob = await response.blob()
  signal?.throwIfAborted()
  if (actor !== workspaceIdentity() || workspace !== activeWorkspace()) throw new Error('Workspace changed. Try again in your current workspace.')
  return blob
}

// Only saved-data reads retry; mutations may already have been accepted by the server.
export async function studioRead<T>(path: string, authenticated = true): Promise<T> {
  const actor = workspaceIdentity(); const workspace = activeWorkspace()
  for (let attempt = 0; ; attempt++) {
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      if (authenticated && (actor !== workspaceIdentity() || workspace !== activeWorkspace())) throw new Error('Workspace changed. Try again in your current workspace.')
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => { const error = new Error('Loading took too long. Please try again.'); error.name = 'TimeoutError'; controller.abort(error); reject(error) }, 12000)
      })
      const data = await Promise.race([studioRequest<T>(path, undefined, 'GET', authenticated, controller.signal), timeout])
      if (authenticated && (actor !== workspaceIdentity() || workspace !== activeWorkspace())) throw new Error('Workspace changed. Try again in your current workspace.')
      return data
    } catch (cause) {
      const error = cause as { name?: string; status?: number }
      if (attempt >= 1 || !(error.name === 'TypeError' || error.name === 'TimeoutError' || [500, 502, 503, 504].includes(error.status || 0))) throw cause
      await new Promise(resolve => setTimeout(resolve, 500))
    } finally { clearTimeout(timer) }
  }
}

