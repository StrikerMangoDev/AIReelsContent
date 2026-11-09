// Inspect post-punctuation citations with the sentence they immediately follow.
// This normalizes an inspection copy only; saved and published prose is untouched.
export function citationSentences(body) {
  return body.replace(/([.!?])\s*((?:\[C\d+\][ \t]*)+)/g, (_match, punctuation, markers) => ` ${markers.trim()}${punctuation} `).split(/(?<=[.!?])\s+/)
}
