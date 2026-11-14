import { independentlyReviewed, approvedVersion } from './approval.js'
import { assessAssurance, buildAssurance } from './assurance.js'
import { reviewContent } from './content.js'
import { workspaceRole } from './workspaces.js'
import { contentContract, savedAlignmentCurrent } from './content-alignment.js'
import { workflowGenerationContext } from './strategy-workflow.js'

// Re-evaluate permissions and source approvals at every release boundary.
export async function assessRelease(repository, owner, value, { requireApproval = true, policy = 'independent-release' } = {}) {
  const ownerDownload = policy === 'owner-download'
  // Owner downloads rerun deterministic checks; unknown human judgments stay unknown.
  const snapshot = ownerDownload ? buildAssurance(value, { actorId: owner, stage: 'owner-download' }) : value.assurance
  const assurance = assessAssurance({ ...value, assurance: snapshot }, { requireIndependentReview: !ownerDownload })
  const issues = [...assurance.issues]
  if (value.strategyAlignment) {
    const saved = await repository.studioGet(owner, 'complete_context', value.id)
    let current = false
    try { current = savedAlignmentCurrent(value, contentContract(value.settings, { ...value.researchContext, topicTitle: value.title, strategyWorkflow: workflowGenerationContext(saved?.context || {}) })) } catch { /* Changed or incomplete strategy cannot retain a passing assessment. */ }
    if (!current) issues.push('The audience-question and goal check is stale. Generate and check the current content and strategy before downloading or publishing.')
  }
  if (value.status === 'generating' || value.status === 'dispatch_unknown') issues.push('Generation must finish before release.')
  if (reviewContent(value.content, value.evidence, value.settings).issues.length) issues.push('Resolve content and citation validation issues.')
  if (ownerDownload && value.review?.issues?.length) issues.push(...value.review.issues)
  if (!ownerDownload && (value.reviewerId === owner || !independentlyReviewed(value))) issues.push('A current independent review of this exact version is required.')
  if (requireApproval && !approvedVersion(value)) issues.push('Separate owner approval of this version is required.')
  if (owner.startsWith('ws:')) {
    if (!ownerDownload && !['owner', 'editor', 'reviewer'].includes(await workspaceRole(repository, owner, value.reviewerId))) issues.push('The reviewer no longer has workspace access.')
    if (requireApproval && !['owner', 'editor'].includes(await workspaceRole(repository, owner, value.approval?.approvedBy))) issues.push('The approver no longer has editing access.')
  }
  for (const [index, sourceId] of (value.sourceIds || []).entries()) {
    const source = await repository.studioGet(owner, 'library_source', sourceId)
    if (!source || source.reviewStatus !== 'approved' || source.evidence.hash !== value.evidence[index]?.hash) issues.push('A library source changed or is no longer approved.')
  }
  return { eligible: issues.length === 0, issues: [...new Set(issues)], assurance, ...(ownerDownload ? { assuranceSnapshot: snapshot } : {}) }
}
