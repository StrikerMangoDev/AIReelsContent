import type { StudioPackage } from './studio-api'
import type { ContentFormat } from './studio-package'
import { contentMarkdown } from '../pages/app/ContentPreview'
import { productionHandoffs, productionHandoffMarkdown } from './production-handoff'

export const exportFormats = [
  { id: 'md', mark: 'MD', label: 'Markdown', description: 'Editable content & notes', mime: 'text/markdown' },
  { id: 'json', mark: 'JSON', label: 'JSON data', description: 'Structured selected content', mime: 'application/json' },
  { id: 'txt', mark: 'TXT', label: 'Plain text', description: 'Simple, portable copy', mime: 'text/plain' },
  { id: 'docx', mark: 'DOC', label: 'Word (.docx)', description: 'Office-compatible document', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
  { id: 'html', mark: 'HTML', label: 'HTML', description: 'Readable web document', mime: 'text/html' },
  { id: 'zip', mark: 'ZIP', label: 'All files', description: 'All five formats in one ZIP', mime: 'application/zip' },
] as const
export type ExportFormat = typeof exportFormats[number]['id']
export const exportSections = [
  { id: 'main', label: 'Main content', description: 'All saved posts, scripts, slides & articles' },
  { id: 'sources', label: 'Sources & citations', description: 'Required: source records & claim references' },
  { id: 'brief', label: 'Creative brief', description: 'Audience, angle & delivery' },
  { id: 'keywords', label: 'Keywords & hashtags', description: 'Saved publishing metadata' },
  { id: 'alternatives', label: 'Copy alternatives', description: 'Other hooks & planned experiments' },
  { id: 'production', label: 'Production notes', description: 'Visual directions & team handoff prompts' },
] as const
export type ExportSection = typeof exportSections[number]['id']
export const allExportSections: ExportSection[] = exportSections.map(section => section.id)
export const defaultExportSections: ExportSection[] = ['main', 'sources', 'brief', 'keywords']
export type ValidatedExport = { manifest: Record<string, unknown>; package: StudioPackage }

function includedSections(selected: readonly ExportSection[]) {
  // Provenance stays with every format, including a notes-only selection.
  return allExportSections.filter(id => id === 'sources' || selected.includes(id))
}

function selectedPackage(pack: StudioPackage, selected: readonly ExportSection[]) {
  if (!pack.content || allExportSections.every(id => selected.includes(id))) return pack
  const content = pack.content
  const strategy = content.strategy
  const has = (id: ExportSection) => selected.includes(id)
  return { ...pack, content: {
    claims: content.claims,
    ...(has('main') ? { script: content.script, captions: content.captions, website: content.website } : {}),
    ...(has('alternatives') ? { hooks: content.hooks } : {}),
    ...(has('main') || has('production') ? { scenes: content.scenes?.map(scene => ({
      timing: scene.timing,
      ...(has('main') ? { narration: scene.narration, onScreen: scene.onScreen } : {}),
      ...(has('production') ? { visualPrompt: scene.visualPrompt, voiceDirection: scene.voiceDirection } : {}),
    })) } : {}),
    ...(strategy ? { strategy: {
      factCheck: strategy.factCheck,
      ...(has('brief') ? { angle: strategy.angle, whyNow: strategy.whyNow, audience: strategy.audience, language: strategy.language, languageReason: strategy.languageReason, voice: strategy.voice, voiceReason: strategy.voiceReason, delivery: strategy.delivery } : {}),
      ...(has('keywords') ? { keywords: strategy.keywords } : {}),
      ...(has('alternatives') ? { experiments: strategy.experiments } : {}),
      ...(has('production') ? { production: strategy.production } : {}),
      platforms: strategy.platforms?.map(post => ({ platform: post.platform, format: post.format,
        ...(has('main') ? { headline: post.headline, hook: post.hook, body: post.body, cta: post.cta } : {}),
        ...(has('keywords') ? { hashtags: post.hashtags } : {}),
        ...(has('alternatives') ? { alternativeHook: post.alternativeHook, retentionPlan: post.retentionPlan, testPlan: post.testPlan } : {}),
        ...(has('production') ? { thumbnail: post.thumbnail } : {}),
      })),
    } } : {}),
  } }
}

export function exportDocument(pack: StudioPackage, format: ContentFormat, selected: readonly ExportSection[]) {
  if (!pack.content) throw new Error('Saved content is unavailable.')
  const sections = includedSections(selected)
  return `${contentMarkdown(pack.title, pack.content, pack.evidence, sections)}\n\n${sections.includes('production') ? productionHandoffMarkdown(pack, format) + '\n\n' : ''}## Saved version\n\nRevision ${pack.revision}. This export does not publish your content. Automated checks do not guarantee factual accuracy.`
}

export function exportData(exported: ValidatedExport, format: ContentFormat, selected: readonly ExportSection[]) {
  const sections = includedSections(selected)
  return { ...exported, package: selectedPackage(exported.package, sections),
    exportSelection: { sections, contentFormat: format, manifestScope: 'The manifest describes the complete saved package before section selection.' },
    ...(sections.includes('production') ? { productionHandoffs: productionHandoffs(exported.package, format) } : {}),
  }
}

const escapeMarkup = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
const plainText = (markdown: string) => markdown.replace(/^#{1,6} /gm, '')

function htmlDocument(title: string, markdown: string) {
  const body = markdown.split('\n').map(line => {
    const heading = /^(#{1,3}) (.*)$/.exec(line)
    return heading ? `<h${heading[1].length}>${escapeMarkup(heading[2])}</h${heading[1].length}>` : line ? `<p>${escapeMarkup(line)}</p>` : ''
  }).join('\n')
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>${escapeMarkup(title)}</title><style>body{max-width:72ch;margin:40px auto;padding:0 24px;font:16px/1.6 Arial,sans-serif;color:#142c38;background:white}h1,h2,h3{line-height:1.3}h2{margin-top:32px}p{white-space:pre-wrap;overflow-wrap:anywhere}</style></head><body>${body}</body></html>`
}

async function wordDocument(markdown: string) {
  const { zipSync, strToU8 } = await import('fflate')
  // Text-only DOCX: generated media belongs to the separate production workflow.
  const paragraphs = markdown.split('\n').map(line => {
    const heading = /^(#{1,3}) (.*)$/.exec(line)
    // XML 1.0 forbids these controls even when escaped.
    // eslint-disable-next-line no-control-regex
    const text = (heading ? heading[2] : line).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    return `<w:p><w:pPr><w:spacing w:after="120"/></w:pPr><w:r>${heading ? `<w:rPr><w:b/><w:sz w:val="${heading[1].length === 1 ? 36 : 28}"/></w:rPr>` : ''}<w:t xml:space="preserve">${escapeMarkup(text)}</w:t></w:r></w:p>`
  }).join('')
  return zipSync({
    '[Content_Types].xml': strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'),
    '_rels/.rels': strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'),
    'word/document.xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/></w:sectPr></w:body></w:document>`),
  })
}

export async function buildExportFile(exported: ValidatedExport, contentFormat: ContentFormat, format: ExportFormat, selected: readonly ExportSection[] = allExportSections) {
  const choice = exportFormats.find(entry => entry.id === format)
  if (!choice) throw new Error('Choose an available export format.')
  const data = exportData(exported, contentFormat, selected)
  const json = JSON.stringify(data, null, 2)
  const markdown = `${exportDocument(exported.package, contentFormat, selected)}\n\n## Export manifest\n\n${JSON.stringify(exported.manifest, null, 2)}\n\nManifest scope: the complete saved package before section selection.`
  const text = plainText(markdown)
  const html = htmlDocument(exported.package.title, markdown)
  let contents: BlobPart = format === 'md' ? markdown : format === 'json' ? json : format === 'html' ? html : text
  if (format === 'docx' || format === 'zip') {
    const document = await wordDocument(markdown)
    if (format === 'docx') contents = new Uint8Array(document).buffer
    else {
      const { zipSync, strToU8 } = await import('fflate')
      contents = new Uint8Array(zipSync({ 'content.md': strToU8(markdown), 'content.json': strToU8(json), 'content.txt': strToU8(text), 'content.html': strToU8(html), 'content.docx': document })).buffer
    }
  }
  return new Blob([contents], { type: choice.mime })
}
