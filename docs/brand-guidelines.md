# AIReelsContent brand guidelines

Version 2.0 · Approved and fixed by the owner · 8 November 2026

Brand identity changes require the owner's explicit approval. All chats and agents modifying this project must follow this document, as required by the root AGENTS.md. Screen-level implementation can improve usability while retaining these shared brand rules.

Supersedes version 1.0. Selected direction: **The creator's editorial desk** — deep ink, confident cobalt, pale sea-glass accents and generous white reading surfaces. This is a finalized design specification, not a claim that the product screens have already been redesigned.

Visual specimen: [Brand board HTML](../../validation/brand-board-v2.html) and [reviewed desktop image](../../validation/brand-board-v2.png). The board is an illustrative design artifact; its controls are not functional product controls. Desktop appearance was reviewed in Chrome. Primary pair contrast: white/cobalt 7.71:1, ink/white 14.51:1, secondary/canvas 5.86:1, white/active navigation 10.10:1. These checks do not certify the future screens as accessible.

This is the source of truth for the next screen-by-screen redesign. It defines design intent; existing screens have not yet been migrated or certified against it. The owner delegated selection of the direction. No product rename, new capability, purchased asset, deployment or cloud change is included.

## 1. Position and promise

AIReelsContent helps creators, small businesses and content teams turn researched topics into editable social content. It supports beginners who need a clear starting point as well as teams reusing saved research. It must work equally well for AI, astrology, news, comedy and other subjects.

Core promise: **From researched ideas to content you can use.**

Public description: Find relevant ideas, understand their sources, and create content for your channels in one workspace.

Lead with the user's content and next action. AI is an assistant inside the workflow. Do not promise virality, guaranteed reach, universal factual accuracy, free generation or automatic publishing that the product does not provide. Astrology interpretations must not be presented as established scientific predictions.

Personality: clear, capable, approachable and creative. Confidence comes from readable information, visible sources and predictable controls. Avoid robotic language, inflated promises and long explanations of internal systems.

## 2. Identity and brand presence

- Canonical product name: **AIReelsContent**. Primary visible wordmark: **AIReels** in Plus Jakarta Sans 700, with **Content** directly below in Source Sans 3 600. Accessible name remains AIReelsContent. Do not introduce alternate names across pages.
- Use a typography-led identity. Retire the violet rounded-square signal-bars lockup during migration. Do not replace it with a generic AI sparkle, robot or brain. A standalone favicon can be developed as a separate asset; no new pictorial symbol is needed to begin the interface redesign.
- Standard treatment: ink wordmark with cobalt Content descriptor on white. Reversed treatment: white wordmark and pale sea-glass descriptor on ink. No gradients inside the wordmark.
- Minimum wordmark width: 112px, normally 136px in navigation. Clear space equals the height of the capital C in Content on every side. Never stretch, outline, rotate or add a glow.
- Marketing and the signed-in product share fonts, palette, icon style and voice. Marketing can use larger composition and genuine product previews. Working screens prioritize content and controls.
- Logo originality, trademark and name availability have not been legally checked. This is a visual identity specification, not a trademark clearance.

## 3. Visual direction

**The creator's editorial desk.** The memorable elements are an ink-coloured navigation rail, crisp cobalt actions, broad white reading areas and short sea-glass source strips. Topic imagery supplies the creative variety; the application frame remains calm.

White surfaces sit on a subtle cool-grey canvas. The deep-ink sidebar provides orientation; a narrow pale-cobalt edge and lighter ink background identify the active destination, with white text. Source labels use dark teal on pale sea-glass. These three treatments are the recurring visual signature. Avoid decorative gradients, dashboard hero slogans, oversized status panels, background animation, deep nested cards and dense walls of instructional copy.

Do not apply marketing-page hero layouts to Topic Library, Studio or Planner. Longer content deserves space; ordinary settings should remain compact.

## 4. Colour system

| Token role | Hex | Use |
|---|---|---|
| Brand / primary action | `#2344C7` | Main action and links |
| Primary hover | `#1935A3` | Hover/pressed primary controls |
| Primary soft | `#EDF1FF` | Selected controls, with cobalt text and visible state |
| Brand ink / navigation | `#142C38` | Sidebar and identity anchor |
| Navigation active surface | `#254653` | Active navigation row with white text and cobalt edge |
| Navigation active edge | `#A8BBFF` | Visible active marker against dark navigation |
| Sea-glass accent | `#D7EEE8` | Small source strips and editorial accents, with ink/teal text |
| Canvas | `#F6F8FA` | Page background |
| Surface | `#FFFFFF` | Editor, menus, dialogs and content surfaces |
| Main text | `#142C38` | Titles, body text and form labels |
| Secondary text | `#566176` | Supporting information and timestamps |
| Divider | `#DCE2EB` | Decorative separation; not a sole input boundary |
| Control boundary | `#7F8AA0` | Input outlines when the boundary identifies the control |
| Source information | `#0F766E` | Source links and evidence section labels |
| Source background | `#F0FDFA` | Source context, with dark teal text |
| Ready / success | `#187548` | Successful completion, always accompanied by a label/icon |
| Success background | `#ECFDF3` | Compact success notices |
| Needs attention | `#92400E` | Actionable warning text |
| Warning background | `#FFFBEB` | Usage warnings or incomplete information |
| Error | `#B42318` | Errors and destructive actions |
| Error background | `#FEF3F2` | Field and operation failures |

Pair white text with cobalt or ink; pair dark semantic text with its light semantic background. Use white sidebar labels and sea-glass secondary labels; dark muted text is for light surfaces only. Never use the divider grey for meaningful text. Never communicate readiness, risk or selected state using colour alone.

Colour roles are stable. Cobalt means primary interaction, teal means source context, green means an operation is ready, amber means attention and red means failure. Teal or green must never imply a source's claims are proven true. Keep the reading area predominantly neutral; cobalt is for a next action or active state, not every heading. Topic identity comes primarily from its image and title, not a random colour per category. Social platform brand colours stay inside platform identifiers.

Colour is a support system, not the content hierarchy. Headings, labels, grouping and spacing must explain what a section does even in greyscale.

## 5. Typography

New pairing: **Plus Jakarta Sans** for the wordmark and headings; **Source Sans 3** for reading, controls and navigation. The compact geometric heading face provides identity; the humanist body face supports long captions and source excerpts. Use Arial/system sans-serif as fallback. Do not add a third font. Self-host licensed WOFF2 subsets with font-display: swap during migration; retain both SIL Open Font License notices. Until migration, the existing fonts are legacy implementation, not an alternative brand option.

| Role | Desktop | Mobile | Weight / line height |
|---|---|---|---|
| Marketing headline | 48–56px | 32–36px | 700 / 1.12 |
| Page title | 32px | 26px | 700 / 1.2 |
| Section title | 22px | 20px | 600 / 1.3 |
| Content card title | 18px | 18px | 600 / 1.4 |
| Body and input text | 16px | 16px | 400 / 1.6 |
| Buttons and navigation | 15px | 15px | 600 / 1.4 |
| Supporting metadata | 14px | 14px | 400–500 / 1.5 |

Use sentence case. Avoid tracked uppercase labels above every heading. Keep reading columns around 60–75 characters. Show full draft titles in the editor; library cards may clamp titles to two lines if the full title is accessible through opening or expanding the item. Long words and URLs wrap without widening the screen.

In Studio's read view use 17–18px Source Sans 3 with 1.65 line height. Compact metadata remains 14px. Headings use a modest -0.02em tracking at 28px and above; body text uses normal tracking. Small labels must never compensate for poor grouping.

## 6. Layout, spacing and components

- Spacing scale: 4, 8, 12, 16, 24, 32 and 48px. Most related controls use 8–12px gaps; sections use 24–32px. Do not create large blank gaps to simulate a premium layout.
- Desktop sidebar: 232–248px. Page gutter: 32px desktop, 24px tablet, 16px phone. Content max width: 1360px; forms normally max 720px.
- Use radius 8px for controls, 12px for content surfaces and 16px only for large imagery. Pills are for short tags and statuses. Editorial content sections can sit directly on white with a small labelled divider; they do not all need cards.
- Default to borders or spacing; reserve subtle shadows for menus and floating layers. Do not put every paragraph in its own card.
- Primary controls: 44px minimum height. One prominent filled action per task region. Secondary actions are outlined or textual. Maintain an explicit label on every important action.
- Use the existing Lucide icon family, normally 20px at 1.75–2px stroke. Hide decorative icons from assistive technology; name icon-only controls. No emoji as structural navigation icons.
- Inputs have persistent labels, optional examples and error messages beside the affected control. Required and optional fields are explicit. Place advanced settings behind a single clearly named control.
- Disabled buttons always have a nearby reason and an available next step. Opacity alone is insufficient feedback.

## 7. Imagery and source policy

Use relevant, recognizable topic images on category cards at 16:9, with consistent cropping and image dimensions reserved while loading. Use smaller thumbnails in dense lists. A generic news category needs a broad editorial image, not a single unrelated vehicle or person.

Prefer existing suitable assets, documented licensed photography and simple topic illustrations. Generic robot art, glowing brains and decorative stock images are not the default for AI categories. Astrology imagery can use a tasteful chart or night sky without implying scientific proof.

Google Images is a discovery source, not a reuse licence. For every reused image preserve the creator, original URL, licence, retrieval date and required attribution. Check the actual item. Keep attribution readable through a labelled Image credits control; if the licence requires a visible credit, retain it. Never hide attribution solely to simplify the screen.

Use Envato or Freepik only when a specific licensed item improves the task. Verify its creator/provenance and account licence; these sites may also contain AI-generated assets. No stock imagery is selected or purchased by this guideline. Never remove a watermark or imply all search images are reusable.

## 8. Voice, labels and user communication

Write short sentences that explain the action, result or next step. Most sections need a title and at most one useful helper sentence. Preserve source limitations and financial information when relevant; move optional detail behind a clearly labelled control.

| Avoid | Use |
|---|---|
| Execute ideation pipeline | Find new ideas |
| Provider outcome requires reconciliation | No content received. Check the previous attempt before trying again. |
| Submit | Save category / Generate content / Download content |
| EVIDENCE_VALIDATION | A statement does not match its source. Your saved draft is safe. |
| Credibility verified | Sources linked / Citation checks passed, as applicable |

State what happened and what the person can do. Put an error beside the action that caused it. Technical diagnostics belong in optional troubleshooting detail. C1/C2 references remain internal citation identifiers; readers see View sources. Copy/download behaviour must preserve provenance according to the existing export contract.

## 9. Product flow expressed through the brand

Primary navigation: **Topic Library, Content Studio, Content Planner**. Find new ideas is a clear creation action. Keep Team & access and Usage & limits as secondary utilities; Top Ideas and Website Insights remain secondary destinations where implemented. Do not add marketing text to the sidebar.

- Topic Library is home after login. Lead with existing categories, useful imagery and search. Show the title, idea count, freshness and a clear next action. Keep workspace scope visible without a promotional footer.
- Category setup asks for the subject first. AI help can propose a name, intent and topics; the person can edit them. Region/country, topic coverage and refresh interval are clearly labelled. Reuse existing matching categories and saved research.
- Category ideas are easy to scan. Opening an idea continues its existing draft or opens Studio. Quick details and Save for later stay secondary. Never create a duplicate simply because someone opens the idea again.
- Studio uses Setup → Edit & preview → Download. Display content for reading first, with explicit Edit and Copy actions. Keep the matching preview beside the selected content on desktop and accessible through a clear toggle on phones. Distinguish post, caption, carousel and writing notes with labels and compact visual cues.
- Planner organizes saved ideas and drafts by work stage and optional date. A plan is not proof of a scheduled or published post. Use the existing product status mapping rather than inventing a parallel state system.
- Source and validation checks remain part of the workflow. Simpler presentation must not remove quote checks, citation provenance, access control or cost admission.

## 10. Loading, errors and motion

Use skeletons shaped like the content being loaded. Keep saved data visible during a background refresh. Reserve image and preview space to avoid layout shifts. Avoid both a blank screen and a page-sized spinner for a small request.

For AI generation use honest stages such as Queued, Writing and Checking sources only when supported by the job state. No invented percentages, countdowns or promises of a completion time. Make clear that leaving the page does not start another attempt.

Prefer 120–180ms transitions for controls and modest state changes. Respect reduced-motion preferences. No continuous decorative animation in working screens.

## 11. Accessibility and responsive acceptance

Target WCAG 2.2 AA. Normal text requires at least 4.5:1 contrast; large text and meaningful graphical controls need the applicable 3:1 contrast. Product target sizes are at least 44×44px, a deliberate usability target above WCAG's 24px AA minimum with exceptions. Keep keyboard focus visible and unobscured.

Check desktop at 1440px, tablet at 768px and phone at 390px, plus 320px width and 200% zoom. No horizontal page scrolling; full controls and content remain usable. Source disclosure, editor selection, preview, error handling and downloads must be exercised with real content. Automated checks alone do not establish accessibility compliance or beginner usability.

## 12. Implementation order and quality gate

Apply to shared tokens, font assets, wordmark and shell first, then Topic Library, Find new ideas/category setup, category ideas, Studio setup/editor/preview/download, Planner, and finally utilities. Each screen uses these rules and is functionally checked before moving on. Brand colour changes must not change the external social-media template or platform-native preview by accident. Do not deploy a mixture of the legacy violet identity and this ink/cobalt identity across core screens.

Acceptance per screen: a new user can identify their location, the content's purpose and the next action; relevant information is visible; advanced detail is reachable; loading/error/empty/success states are readable; mobile and keyboard paths work; existing data, citations and budget behaviour are preserved.

Version this document when a shared design decision changes. Existing source components remain the implementation authority until the new tokens are applied; do not claim the current app already follows this guideline.

## 13. Research and reference record

Research performed 8 November 2026. These are references and design judgments, not claims that adopting their styling proves our usability.

| Source | Inspection | Principle adopted |
|---|---|---|
| [Buffer Create](https://buffer.com/create) | Public page visually inspected, including its featured workspace image | Clear content grouping, recognizable category imagery and restrained status tags |
| [Canva content planning](https://www.canva.com/solutions/content-planning-scheduling/) | Public page visually inspected, including its featured editor image | Content shown in context; strong preview helps explain the output |
| [Linear features](https://linear.app/features) | Public page visually inspected | Consistent type, restrained navigation and deliberate emphasis; its dark marketing treatment is not adopted for our working screens |
| [W3C WCAG 2.2](https://www.w3.org/TR/WCAG22/) | Official text reference | Contrast, keyboard/focus, target-size and reflow acceptance requirements |
| [Plus Jakarta Sans](https://github.com/tokotype/PlusJakartaSans) | Official repository text reference | New heading and wordmark family, under the SIL Open Font License |
| [Source Sans](https://github.com/adobe-fonts/source-sans/blob/release/LICENSE.md) | Official licence text reference | New reading/UI family, under the SIL Open Font License |

Reference visuals have not been copied or licensed as our assets. No competitor application login or complete competitor product audit was performed. Envato and Freepik remain optional sourcing channels, not reviewed/approved assets. Font self-hosting, any refined logo export, production screen migration, legal clearance and usability testing remain implementation work.
