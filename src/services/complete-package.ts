import { studioRead, studioRequest } from './studio-api'

export const packagePlatforms = ['X', 'Instagram', 'YouTube', 'Facebook', 'LinkedIn'] as const
export type PackagePlatform = typeof packagePlatforms[number]
export type PackageValue = null | boolean | number | string | PackageValue[] | { [key: string]: PackageValue }
export type MetricObservation = {
  observationId: string; accountId: string; postId: string; publicationId?: string; platform: PackagePlatform; format: string; distribution: 'organic' | 'paid'; publishedAt: string; measuredAt: string; windowKind?: 'lifetime' | 'period'; periodStart?: string; periodEnd?: string; definitionVersion?: string;
  source: { kind: 'manual' | 'provider'; label: string; url?: string }; metrics: Partial<Record<'reach' | 'impressions' | 'views' | 'likes' | 'comments' | 'shares' | 'saves' | 'clicks' | 'conversions' | 'averageWatchSeconds' | 'durationSeconds', number | null>>
}
export type StrategyDestination = {
  platform: PackagePlatform; accountId: string;
  goal?: { primary: 'reach' | 'trust' | 'engagement' | 'traffic' | 'conversion'; kpi: string; targetAction: string; reviewAfterHours: number; reviewDueAt?: string };
  audienceQuestions?: { id: string; question: string; source: 'comment' | 'dm' | 'faq' | 'poll' | 'search' | 'consultation' | 'community' | 'editorial-hypothesis'; occurrences: number; audience: string; observedAt: string; sourceUrl?: string; anonymized: boolean; hypothesis?: boolean; basisNote?: string }[];
  researchLog?: { id: string; type: 'audience' | 'competitor' | 'trend' | 'fact' | 'poll'; url: string; observedAt: string; observation: string; interpretation: string; response: string; confidence: 'low' | 'medium' | 'high'; hypothesis: boolean; trend?: { query: string; region: string; periodStart: string; periodEnd: string; recheckAt: string }; questionIds: string[] }[];
  candidates?: { id: string; topic: string; angle: string; rationale: string; researchIds: string[]; questionIds: string[]; selected: boolean; scores: { topicFit: number; audienceUsefulness: number; brandFit: number; evidence: number; timing: number; effort: number; risk: number } }[];
  keywords?: { phrase: string; placements: ('spoken' | 'on-screen' | 'caption' | 'title')[]; rationale: string; researchIds: string[] }[];
  trendDecision?: { mode: 'use_signal' | 'not_relevant'; reason: string };
  expertReview?: { required: boolean; status: 'not_required' | 'pending' | 'approved' | 'rejected'; reviewer?: string; reviewedAt?: string; contentHash?: string; note?: string };
  community?: { owner: string; responseGuidance: string; escalationOwner: string; escalationRules: string; cases: { id: string; kind: 'question' | 'spam' | 'abuse' | 'booking' | 'sensitive'; summary: string; status: 'open' | 'answered' | 'escalated' | 'closed'; owner: string; note: string; anonymized: boolean }[] };
  checklist?: { originalityChecked: boolean; hookFulfilled: boolean; phonePreviewChecked: boolean; soundOffChecked: boolean; linksChecked: boolean; livePostInspected: boolean; sensitiveEventCheckedAt?: string; liveUrl?: string; contentHash?: string };
  learnings?: { id: string; action: 'repeat' | 'change' | 'stop' | 'test' | 'investigate'; topic: string; observation: string; nextAction: string; variable?: string; metricIds: string[]; reviewedAt: string; reviewer: string; status: 'proposed' | 'adopted'; basis: 'hypothesis' | 'measured'; reviewWindowHours: number }[];
}
export type StrategyWorkflow = { version: 'strategy-workflow-v1'; destinations: StrategyDestination[] }
export type StrategyWorkflowReport = {
  version: string; status: string; limitations: string[];
  destinations: { platform: PackagePlatform; accountId: string; status: string; issues: string[]; steps: { id: string; title: string; status: string; detail: string }[]; candidates: (NonNullable<StrategyDestination['candidates']>[number] & { score: number; maxScore: number; formula: string })[]; learnings: (NonNullable<StrategyDestination['learnings']>[number] & { eligibleForAutomation: boolean; reason: string })[]; machineAssessment?: { method: string; contentHash: string; manifestHash: string; checkedAt: string; expiresAt: string; checks: Record<string, boolean>; limitations: string[] } | null }[];
}
export type WebsiteSeoWorkflow = {
  version: 'website-seo-v1'; enabled: boolean; siteUrl?: string;
  business?: { objectives: string; audience: string; industry: string };
  pages: { id: string; url: string; purpose: string; primaryKeywordId?: string; supportingKeywordIds: string[]; cluster?: string; pillarUrl?: string; action: 'create' | 'update' | 'merge' | 'keep'; rationale: string }[];
  competitors: { id: string; url: string; kind: 'direct' | 'indirect'; observation: string; gap: string; observedAt: string; sourceUrl: string }[];
  keywords: { id: string; phrase: string; intent: 'informational' | 'commercial' | 'transactional' | 'navigational'; role: 'primary' | 'supporting'; cluster?: string; volume?: number; difficulty?: number; cpc?: number; currency?: string; provider: string; sourceUrl: string; observedAt: string; region: string; period: string }[];
  research: { id: string; url: string; kind: 'serp' | 'question' | 'expert' | 'official' | 'community'; observation: string; gap?: string; observedAt: string }[];
  outline: { id: string; level: 1 | 2 | 3; text: string; researchIds: string[] }[];
  calendar: { id: string; pageId: string; dueDate: string; owner: string; status: 'planned' | 'writing' | 'review' | 'published' }[];
  checks?: { contentHash: string; originality: 'not_checked' | 'reported_checked'; intentSatisfied: boolean; addedValue: boolean; note: string };
  publication?: { pageUrl: string; status: 'not_connected' | 'draft' | 'published_reported'; cms?: string; publishedAt?: string; receiptUrl?: string; sitemapUrl?: string; indexing: 'not_checked' | 'requested_reported' | 'indexed_reported' | 'not_indexed_reported'; inspectedAt?: string; inspectionSourceUrl?: string };
  metrics: { id: string; pageUrl: string; query?: string; segment: string; source: 'search_console' | 'ga4' | 'reported'; sourceUrl: string; periodStart: string; periodEnd: string; observedAt: string; clicks?: number; impressions?: number; position?: number; organicSessions?: number; conversions?: number }[];
  decisions: { id: string; pageId: string; action: 'refresh' | 'expand' | 'merge' | 'keep' | 'investigate'; reason: string; metricIds: string[]; status: 'proposed' | 'adopted' }[];
}
export type WebsiteSeoReport = {
  version: string; applicable: boolean; status: string; steps: { id: string; title: string; status: string; reason: string }[];
  conflicts: { phrase: string; pageUrls: string[] }[]; keywordPriority: { keywordId: string; score: number | null; maxScore: number; rationale: string }[];
  performance: PackageValue[]; refreshRecommendations: PackageValue[]; audits: PackageValue[];
  connections: { id: string; status: string; reason: string }[]; limitations: string[];
}
export type PackageContext = {
  seoWorkflow?: WebsiteSeoWorkflow;
  workflow?: StrategyWorkflow;
  objective?: string; brand?: string; accountId?: string; country?: string; format?: string; timezone?: string; targetDate?: string; budgetUsd?: number; rightsNote?: string; autoAnalyze?: boolean; attestations?: Record<string, boolean>;
  platformAccounts?: { platform: PackagePlatform; accountId: string }[];
  platformAttestations?: { platform: PackagePlatform; accountId: string; attestations: Record<string, boolean> }[];
  marketObservations?: { id: string; url: string; observedAt: string; summary: string }[];
  metrics?: MetricObservation[];
  website?: { slug?: string; seoTitle?: string; metaDescription?: string; canonicalUrl?: string; internalLinks?: { label: string; url: string }[]; heroAlt?: string; heroAspectRatio?: string };
  productionTools?: { graphics?: string; video?: string; voice?: string; music?: string; editor?: string };
  assetReferences?: { id: string; url: string; role: string; rightsNote: string }[];
  teamTasks?: { id: string; team: string; task: string; expectedDeliverable: string; status: 'waiting' | 'working' | 'checking' | 'ready' | 'blocked'; assignee?: string; dueAt?: string }[]
}
export type PackageDecision = { id?: string; platform: string; parameter: string; value: PackageValue; method: string; evidenceIds: string[]; metricIds: string[]; rationale: string; alternatives: PackageValue[]; confidence: string; missing: string[] }
export type PackagePrompt = { id: string; platform: string; kind: string; title: string; tool: string; prompt: string; exactText: string; attachments: PackageValue[]; settings: { aspectRatio?: string; duration?: string; durationSeconds?: number; width?: number; height?: number; format?: string; filename?: string }; constraints: string[]; acceptance: string[]; sourceDecisionIds: string[]; sources?: { id: string; url: string; title: string }[]; missing?: string[]; status: string; reason: string }
export type CompletePackage = {
  seoWorkflow?: WebsiteSeoReport;
  workflow?: StrategyWorkflowReport;
  trendIntakes?: { id: string; status: string; reason: string; country: string | null; accountId: string; platform: string; topic: string; sourceUrl: string | null; capturedAt: string; expiresAt: string; freshness: string; matches: { id: string; query: string; approximateTraffic: string | null; publishedAt: string; matchBasis: string }[]; limitations: string[] }[];
  version: string; packageId: string; revision: number; contentHash: string; inputHash: string; contextRevision: number; context: PackageContext;
  sections: { id: string; title: string; status: string; value: PackageValue; reason: string }[];
  platforms: { platform: string; selected: boolean; status: string; reason: string; content: PackageValue }[];
  accounts?: { accountId: string; name: string; platform: string; audience?: string; tone?: string; language?: string; timezone?: string; contentPillars?: string[]; weeklyBrief?: string }[];
  decisions: PackageDecision[]; prompts: PackagePrompt[]; analytics: { observations: PackageValue[]; comparisons: PackageValue[]; [key: string]: PackageValue };
  rules: PackageValue[]; tasks: PackageValue[]; assets: PackageValue[]; publications: PackageValue[];
  analysis?: { status: string; stale: boolean; requestId?: string; generatedAt?: string; model?: string; inputHash?: string; error?: string }
}
const path = (id: string) => `/packages/${encodeURIComponent(id)}/complete-package`
export const readCompletePackage = (id: string) => studioRead<CompletePackage>(path(id))
export const savePackageContext = (id: string, expectedRevision: number, context: PackageContext) => studioRequest<CompletePackage>(`${path(id)}/context`, { expectedRevision, context }, 'PUT')
export const auditWebsiteSeo = (id: string, expectedRevision: number, pageUrl: string) => studioRequest<CompletePackage>(`${path(id)}/seo-audit`, { expectedRevision, pageUrl }, 'POST')
export const analyzeCompletePackage = (id: string, requestId: string, contentHash: string, contextRevision: number) => studioRequest<CompletePackage>(`${path(id)}/analyze`, { requestId, contentHash, contextRevision }, 'POST')
export const recoverCompleteAnalysis = (id: string, requestId: string, contentHash: string, contextRevision: number, acknowledgeUnknownOutcome = false) => studioRequest<CompletePackage>(`${path(id)}/recover-analysis`, { requestId, contentHash, contextRevision, acknowledgeUnknownOutcome }, 'POST')
export const readPackageDownload = (id: string) => studioRead<{ manifest: PackageValue; completePackage: CompletePackage }>(`${path(id)}/download`)
export type PackageMetricsConfig = { configured: boolean; reason?: string; eligiblePublications: { id: string; platform: string; accountId: string; releaseUrl?: string; providerPostId?: string }[] }
export const readPackageMetricsConfig = (id: string) => studioRead<PackageMetricsConfig>(`${path(id)}/metrics/config`)
export const syncPackageMetrics = (id: string, publicationId: string, days: number) => studioRequest<{ snapshot: PackageValue }>(`${path(id)}/metrics/sync`, { publicationId, days }, 'POST')

export function externalPromptMarkdown(prompts: PackagePrompt[]) {
  return prompts.map(card => `## ${card.platform} · ${card.title}\n\nPrompt ID: ${card.id}\n\nStatus: ${card.status}${card.reason ? ` — ${card.reason}` : ''}\n\nTool: ${card.tool}\n\n${card.prompt || 'No usable prompt available.'}\n\n${card.exactText ? `Exact text / narration:\n${card.exactText}\n\n` : ''}Settings:\n${Object.entries(card.settings || {}).map(([key, value]) => `${key}: ${value}`).join('\n')}\n\nAttachments:\n${card.attachments.map(value => typeof value === 'string' ? value : JSON.stringify(value)).join('\n')}\n\nConstraints:\n${card.constraints.join('\n')}\n\nAcceptance:\n${card.acceptance.join('\n')}\n\nDecision references: ${card.sourceDecisionIds.join(', ') || 'Unavailable'}\n\nSource provenance:\n${(card.sources || []).map(source => `${source.id}: ${source.title} — ${source.url}`).join('\n') || 'Unavailable'}\n\nMissing requirements:\n${(card.missing || []).join('\n') || 'None recorded'}`).join('\n\n')
}
