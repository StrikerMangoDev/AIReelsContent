import { load } from 'cheerio'

// Postiz sanitizes stored content as HTML; compare decoded prose and actual link targets.
export function postizContentMatches(expected, observed) {
  if (typeof expected !== 'string' || typeof observed !== 'string') return false
  const doc = load(observed, {}, false)
  if (doc('script,style,iframe,object,embed,img,form').length) return false
  const urls = new Set([...expected.matchAll(/https:\/\/\S+/g)].map(match => { try { return new URL(match[0]).href } catch { return null } }))
  if (doc('a').toArray().some(link => { try { return !urls.has(new URL(doc(link).attr('href')).href) } catch { return true } })) return false
  doc('br').replaceWith('\n')
  // The Postiz editor serializes each line, including blank lines, as a paragraph.
  const nodes = doc.root().contents().toArray()
  const editorText = nodes.length && nodes.every(node => node.type === 'tag' && node.name === 'p') ? nodes.map(node => doc(node).text()).join('\n') : null
  doc('p,div,h1,h2,h3').each((_index, element) => { doc(element).after('\n\n') })
  doc('li').each((_index, element) => { doc(element).after('\n') })
  const text = doc.root().text().replace(/\r\n/g, '\n').replace(/\n\n$/, '')
  const approved = expected.replace(/\r\n/g, '\n')
  return text === approved || editorText === approved
}
