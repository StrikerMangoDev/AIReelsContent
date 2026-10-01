import { authHeaders } from '@/services/firebase'
export type StudioProfile = { industry: string; audience: string; language: string; tone: string; platform: string; duration: number }
export type StudioContent = { hooks: string[]; script: string; scenes: { timing: string; narration: string; onScreen: string; visualPrompt: string; voiceDirection: string }[]; captions: { reel: string; linkedin: string }; website: { title: string; body: string }; claims: { id: string; text: string; evidenceId: string; quote: string; status: string }[] }
export type StudioPackage = { id: string; title: string; articleId?: string; settings: StudioProfile; evidence: { id: string; url: string; title: string; publisher: string; excerpt: string; retrievedAt: string; publishedAt?: string; type: string; limitations: string[] }[]; content: StudioContent | null; status: string; editorialStatus: string; revision: number; review: { issues: string[] } | null; error?: string; createdAt: string; updatedAt: string }
export type StudioConfig = { industries: string[]; capabilities: { generation: boolean; media: boolean; publishing: boolean }; dailyGenerationLimit: number }
export async function studioRequest<T>(path: string, body?: unknown, method = 'GET', authenticated = true): Promise<T> {
  const response = await fetch(`/api/studio${path}`, { method, headers: { Accept: 'application/json', ...(authenticated ? await authHeaders() : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : typeof data.message === 'string' ? data.message : `Request failed (${response.status}). Please retry.`)
  return data as T
}
