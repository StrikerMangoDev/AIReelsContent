import { createHash } from 'node:crypto'

export function evidencePassages(evidence) {
  return evidence.slice(0, 12).flatMap(source => {
    const excerpt = String(source.excerpt || '')
    const passages = []
    // Exclude URL tokens without joining their surrounding text into invented quotations.
    let offset = 0
    const ranges = []
    for (const match of excerpt.slice(0, 7200).matchAll(/https?:\/\/\S+/gi)) { ranges.push([offset, match.index]); offset = match.index + match[0].length }
    ranges.push([offset, Math.min(excerpt.length, 7200)])
    for (const [begin, end] of ranges) for (let start = begin; start < end && passages.length < 12; start += 600) {
      const quote = excerpt.slice(start, Math.min(start + 600, end))
      if (quote.trim().length < 12) continue
      const id = `P${createHash('sha256').update(JSON.stringify([source.id, start, quote])).digest('hex').slice(0, 24)}`
      passages.push({ id, evidenceId: source.id, quote })
    }
    return passages
  })
}
export function resolvePassageClaims(draft, passages) {
  const claims = draft.claims.map(claim => {
    const passage = passages.find(value => value.id === claim.passageId)
    if (!passage || passage.evidenceId !== claim.evidenceId) throw new Error('Select an allowed passage belonging to the stated evidence source.')
    const fields = { ...claim }; delete fields.passageId
    return { ...fields, evidenceId: passage.evidenceId, quote: passage.quote }
  })
  // Only narrative/creative strings are normalized. Claim text and quotes stay untouched.
  const normalize = value => typeof value === 'string' ? value.replace(/\[C\d+(?:,\s*C\d+)+\]/g, group => group.slice(1, -1).split(/,\s*/).map(id => `[${id}]`).join(' ')) : Array.isArray(value) ? value.map(normalize) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key, child]) => [key, normalize(child)])) : value
  const prose = { ...draft }; delete prose.claims
  return { ...normalize(prose), claims }
}
