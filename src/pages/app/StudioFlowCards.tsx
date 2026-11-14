import { ArrowRight, Clapperboard, ClipboardCheck, Compass, Download, FileText, History, Layers3, Link2, ListChecks, Send, Sparkles } from 'lucide-react'
import { Link } from 'react-router-dom'

export function StudioStartCards({ articleOpen, onArticleToggle }: { articleOpen: boolean; onArticleToggle: () => void }) {
  return <section className="studio-home-create" aria-labelledby="studio-create-title">
    <header className="studio-home-section-heading"><div><h2 id="studio-create-title">Create new content</h2><p>Choose where your content starts.</p></div></header>
    <div className="studio-home-start-options">
      <article className="studio-home-start-option"><span className="studio-home-option-icon"><Compass size={24} aria-hidden="true" /></span><div><h3>From a researched idea</h3><p>Browse topics and their saved sources, then choose an idea to develop.</p></div><Link to="/ideas" className="studio-home-primary">Browse ideas<ArrowRight size={18} aria-hidden="true" /></Link></article>
      <article className="studio-home-start-option"><span className="studio-home-option-icon"><Link2 size={24} aria-hidden="true" /></span><div><h3>From an article</h3><p>Bring a public article link to prepare a source-backed content brief.</p></div><button type="button" className="studio-home-secondary" aria-expanded={articleOpen} aria-controls="studio-source-entry" onClick={onArticleToggle}>{articleOpen ? 'Close article form' : 'Add article link'}<ArrowRight size={18} aria-hidden="true" /></button></article>
    </div>
    <p className="studio-home-create-note">Next: choose your audience, platforms and formats in Setup.</p>
  </section>
}

export function StudioWorkspaceGuide({ hasContent, hasWebsite, onOpen }: { hasContent: boolean; hasWebsite: boolean; onOpen: (panel: string, view?: string) => void }) {
  const groups = [
    { title: 'Plan & research', Icon: Compass, description: 'The audience, goal and evidence behind this content.', links: [
      { label: 'Content brief', panel: 'package', view: 'brief' },
      { label: 'Strategy workflow', panel: 'package', view: 'workflow' },
      { label: 'AI recommendations', panel: 'package', view: 'decisions', needsContent: true },
    ] },
    { title: 'Production kit', Icon: Clapperboard, description: 'Directions for graphics, video, voice and editing.', links: [
      { label: 'Production brief & media', panel: 'production', needsContent: true },
      { label: 'External prompts', panel: 'package', view: 'prompts', needsContent: true },
      { label: 'Team tasks & assets', panel: 'package', view: 'team' },
    ] },
    ...(hasWebsite ? [{ title: 'Website SEO', Icon: FileText, description: 'Research, page checks and search performance.', links: [
      { label: 'Website SEO workflow', panel: 'package', view: 'seo' },
    ] }] : []),
    { title: 'Sources & review', Icon: ClipboardCheck, description: 'Source passages, content checks and disclosures.', links: [
      { label: 'Sources & citation checks', panel: 'sources', needsContent: true },
      { label: 'Rules & disclosures', panel: 'package', view: 'rules' },
    ] },
    { title: 'Publishing & results', Icon: Send, description: 'Account plans, publishing records and dated results.', links: [
      { label: 'Account plans & publishing', panel: 'publishing', needsContent: true },
      { label: 'Performance & learning', panel: 'package', view: 'results' },
      { label: 'Publication receipts', panel: 'package', view: 'posting' },
    ] },
    { title: 'Files & history', Icon: History, description: 'Saved writing, the internal package and earlier versions.', links: [
      { label: 'Download writing & production file', panel: 'download', needsContent: true },
      { label: 'Complete package export', panel: 'package', view: 'downloads', needsContent: true },
      { label: 'Version history', panel: 'history', needsContent: true },
    ] },
  ]
  return <section className="studio-flow-guide" aria-label="Content workspace guide">
    <div className="studio-flow-guide-heading"><div><h2>Your content workspace</h2><p>Follow the three steps. Open a supporting tool whenever you need it.</p></div><Layers3 size={24} aria-hidden="true" /></div>
    <ol className="studio-flow-path" aria-label="Content creation path">
      {[
        { title: 'Setup', detail: 'Choose your formats and audience.', panel: 'setup', Icon: ListChecks },
        { title: 'Edit & preview', detail: 'Shape the writing and production brief.', panel: 'write', Icon: FileText },
        { title: 'Download', detail: 'Take the saved content to your team.', panel: 'download', Icon: Download },
      ].map(({ title, detail, panel, Icon }, index) => <li key={panel}><button type="button" disabled={!hasContent && panel !== 'setup'} onClick={() => onOpen(panel)}><span className="studio-flow-path-number">{index + 1}</span><span className="studio-flow-path-copy"><strong>{title}</strong><span>{detail}</span></span><Icon size={23} aria-hidden="true" /></button>{index < 2 && <ArrowRight className="studio-flow-path-arrow" size={18} aria-hidden="true" />}</li>)}
    </ol>
    {!hasContent && <p className="studio-flow-availability"><Sparkles size={16} aria-hidden="true" />Generate your content in Setup to unlock editing, production prompts and downloads.</p>}
    <div className="studio-flow-tools">{groups.map(({ title, Icon, description, links }) => <section className="studio-flow-tool" key={title}>
      <div className="studio-flow-tool-heading"><Icon size={20} aria-hidden="true" /><h3>{title}</h3></div><p>{description}</p><div className="studio-flow-tool-links">{links.map(link => <button type="button" key={link.label} disabled={'needsContent' in link && link.needsContent && !hasContent} onClick={() => onOpen(link.panel, 'view' in link ? link.view : undefined)}>{link.label}<ArrowRight size={16} aria-hidden="true" /></button>)}</div>
    </section>)}</div>
  </section>
}
