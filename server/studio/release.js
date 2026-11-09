import { independentlyReviewed, approvedVersion } from './approval.js'
import { assessAssurance } from './assurance.js'
import { reviewContent } from './content.js'
import { workspaceRole } from './workspaces.js'

// Re-evaluate permissions and source approvals at every release boundary.
export async function assessRelease(repository, owner, value, { requireApproval = true } = {}) {
  const assurance = assessAssurance(value)
  const issues = [...assurance.issues]
  if (value.status === 'generating' || value.status === 'dispatch_unknown') issues.push('Generation must finish before release.')
  if (reviewContent(value.content, value.evidence, value.settings).issues.length) issues.push('Resolve content and citation validation issues.')
  if (value.reviewerId === owner || !independentlyReviewed(value)) issues.push('A current independent review of this exact version is required.')
  if (requireApproval && !approvedVersion(value)) issues.push('Separate owner approval of this version is required.')
  if (owner.startsWith('ws:')) {
    if (!['owner', 'editor', 'reviewer'].includes(await workspaceRole(repository, owner, value.reviewerId))) issues.push('The reviewer no longer has workspace access.')
    if (requireApproval && !['owner', 'editor'].includes(await workspaceRole(repository, owner, value.approval?.approvedBy))) issues.push('The approver no longer has editing access.')
  }
  for (const [index, sourceId] of (value.sourceIds || []).entries()) {
    const source = await repository.studioGet(owner, 'library_source', sourceId)
    if (!source || source.reviewStatus !== 'approved' || source.evidence.hash !== value.evidence[index]?.hash) issues.push('A library source changed or is no longer approved.')
  }
  return { eligible: issues.length === 0, issues: [...new Set(issues)], assurance }
}
