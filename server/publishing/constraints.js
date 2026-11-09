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

export function platformSettings(pack, account, assets) {
  const settings = { ...account.settings, __type: account.provider }
  const adaptation = pack.content?.strategy?.platforms?.find(item => item.platform === account.platform)
  const caption = renderSocialCaption(pack, account.platform)
  const fail = message => { throw Object.assign(new Error(message), { status: 422, publicMessage: message }) }
  const maximum = { LinkedIn: 3000, Instagram: 2200, YouTube: 5000, Facebook: 63206 }[account.platform]
  if (maximum && [...caption].length > maximum) fail(`The saved ${account.platform} caption and source links exceed its ${maximum}-character allowance. Revise the saved content before publishing.`)
  if (account.platform === 'X') {
    if (xWeightedLength(caption) > 280) fail('The saved X post exceeds its 280-character allowance. Revise the saved post before publishing.')
    if (assets.some(asset => asset.kind === 'video') ? assets.length !== 1 : assets.length > 4) fail('X accepts one video or up to four images for this integration.')
    settings.post_type = 'post'
    settings.who_can_reply_post = settings.who_can_reply_post || 'everyone'
  }
  if (account.platform === 'YouTube') {
    const title = cleanCaption(adaptation?.headline)
    if ([...title].length < 2 || [...title].length > 100) fail('Save an approved YouTube headline between 2 and 100 characters before publishing.')
    if (assets.length !== 1 || assets[0].kind !== 'video' || assets[0].mime !== 'video/mp4') fail('YouTube requires one completed MP4 video.')
    if (!['public', 'private', 'unlisted'].includes(settings.type) || !['yes', 'no'].includes(settings.selfDeclaredMadeForKids)) fail('Configure YouTube visibility and audience settings for this account.')
    settings.title = title
  }
  if (account.platform === 'Instagram') settings.post_type = settings.post_type || 'post'
  return settings
}
