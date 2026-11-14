export const cleanCaption = text => String(text || '').replace(/\s*\[C\d+\]/g, '').trim()

// X shortens URLs to 23 characters; non-ASCII prose remains conservatively weighted.
export const xWeightedLength = text => [...cleanCaption(text).replace(/https?:\/\/\S+/g, 'x'.repeat(23))].reduce((length, character) => length + (character.codePointAt(0) <= 0x7f ? 1 : 2), 0)

function savedBody(pack, platform) {
  return String(pack.content?.strategy?.platforms?.find(item => item.platform === platform)?.body || (platform === 'LinkedIn' ? pack.content?.captions?.linkedin : platform === 'Instagram' ? pack.content?.captions?.reel : '') || '')
}

export function socialSourceUrls(pack, platform) {
  const ids = new Set([...savedBody(pack, platform).matchAll(/\[(C\d+)\]/g)].map(match => match[1]))
  const urls = []
  for (const claim of pack.content?.claims || []) {
    if (!ids.has(claim.id)) continue
    const source = pack.evidence?.find(source => source.id === claim.evidenceId)
    try {
      const url = new URL(source?.url)
      if (url.protocol !== 'https:' || url.username || url.password || urls.includes(url.href)) continue
      urls.push(url.href)
    } catch { /* Missing or malformed source URLs cannot become public attribution. */ }
  }
  return urls.slice(0, platform === 'X' ? 1 : 2)
}

export function renderSocialCaption(pack, platform) {
  const body = cleanCaption(savedBody(pack, platform)); const urls = socialSourceUrls(pack, platform)
  return urls.length ? `${body}\n\n${urls.length === 1 ? 'Source' : 'Sources'}: ${urls.join('\n')}` : body
}

