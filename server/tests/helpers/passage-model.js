import { generateContent as generate } from '../../studio/content.js'
export const alignmentFixture = async request => ({ judgments: request.input.targets.map(target => ({ target: target.target, questionId: target.question.id, verdict: 'answered', answerQuote: target.text, goalAligned: true, goalReason: 'Controlled evaluator fixture; not a live semantic assessment.', promiseFulfilled: true, intentSatisfied: true, reason: 'Controlled evaluator fixture for the source/ownership journey; actual semantics tested separately.' })) })
// Legacy saved-output fixtures are translated to the new model-only passage contract.
export function generateContent(evidence, settings, context, model, options) {
  return generate(evidence, settings, context, async request => {
    const draft = await model(request)
    if (!draft?.claims) return draft
    return { ...draft, claims: draft.claims.map(({ quote: _quote, ...claim }) => ({ ...claim, passageId: request.input.passages.find(passage => passage.evidenceId === claim.evidenceId)?.id })) }
  }, { evaluateAlignment: alignmentFixture, ...options })
}
