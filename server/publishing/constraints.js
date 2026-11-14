import { cleanCaption, renderSocialCaption, xWeightedLength } from '../../shared/social-caption.js'
export { cleanCaption, xWeightedLength, socialSourceUrls, renderSocialCaption } from '../../shared/social-caption.js'

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
