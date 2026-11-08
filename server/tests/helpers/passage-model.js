import { generateContent as generate } from '../../studio/content.js'
// Legacy saved-output fixtures are translated to the new model-only passage contract.
export function generateContent(evidence, settings, context, model, options) {
  return generate(evidence, settings, context, async request => {
    const draft = await model(request)
    if (!draft?.claims) return draft
    return { ...draft, claims: draft.claims.map(({ quote: _quote, ...claim }) => ({ ...claim, passageId: request.input.passages.find(passage => passage.evidenceId === claim.evidenceId)?.id })) }
  }, options)
}
