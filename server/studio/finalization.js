import { z } from 'zod'

export const finalizationPolicy = Object.freeze({ version: 'content-finalization-v1', dimensions: ['relevance', 'originality', 'clarity', 'hookStrength', 'brandFit', 'factualAccuracy', 'cta'], minimumOverall: 8, minimumDimension: 6, minimumFactualAccuracy: 8 })
const rating = z.object({ score: z.number().min(0).max(10), note: z.string().trim().min(20).max(1500), evidenceIds: z.array(z.string().min(1).max(100)).min(1).max(12).refine(ids => new Set(ids).size === ids.length, 'Use distinct source IDs') }).strict()
export const ratingsSchema = z.object(Object.fromEntries(finalizationPolicy.dimensions.map(key => [key, rating]))).strict()

export function assessQuality(ratings, evidence) {
  const parsed = ratingsSchema.safeParse(ratings)
  if (!parsed.success) return null
  const sourceIds = new Set((evidence || []).map(source => source.id))
  if (Object.values(parsed.data).some(value => value.evidenceIds.some(id => !sourceIds.has(id)))) return null
  const scores = Object.values(parsed.data).map(value => value.score)
  const overall = scores.reduce((sum, score) => sum + score, 0) / scores.length
  return { policyVersion: finalizationPolicy.version, ratings: parsed.data, overall, eligible: overall >= finalizationPolicy.minimumOverall && scores.every(score => score >= finalizationPolicy.minimumDimension) && parsed.data.factualAccuracy.score >= finalizationPolicy.minimumFactualAccuracy }
}
