# Find new ideas refinement

Applied the fixed v2.0 brand to a focused single-column form. Removed the decorative side panel, uppercase slogan and oversized marketing question. The sequence is topic → optional editable description/AI help → Find ideas → optional research preferences and audience/reference links. Examples only fill the topic; they do not dispatch research. Existing duplicate audits, score thresholds, request idempotency, confirmation, workspace access and cost controls are preserved.

Country, topic scope, language and refresh options remain available through Change preferences, with the current scope visible when collapsed. Collapsed settings are disabled at the native fieldset level so invisible required controls cannot trap submission. The existing explicit country check opens preferences and explains missing national coverage. Updated shared preference placeholders to suit any subject rather than assume AI content.

Feedback now includes a small progress indicator, a clear minimum-length hint and a shorter unavailable-comparison state offering saved categories. No speculative match is treated as permission to create a category.

Validation: 23 focused Find ideas/intake tests pass, covering the 8/9 duplicate threshold, editable AI-help responses with a simulated provider, cancellation of stale results, explicit creation/research confirmation and hidden-field behaviour. TypeScript and Vite production build pass. Browser checks cover desktop examples, optional description, preferences, a News duplicate check and its saved-category link, plus phone layouts at 390px and 320px. Expanded preferences have no horizontal page overflow at the tested widths.

Live-provider limit: the News check returned comparison unavailable and offered the existing category, which opened successfully. No live AI-help success or new research/generation is claimed by this pass; provider-assisted success/failure branches were exercised by automated tests. No deployment, paid-service enablement or new category creation was performed.

Screenshots: D:/AIReelsContent/validation/find-ideas-simple-desktop.png and find-ideas-simple-mobile.png.
