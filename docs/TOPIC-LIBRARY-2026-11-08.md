# Topic Library refinement

Applied the fixed v2.0 brand to a simpler category card: relevant cover, category title, saved idea count, short update date and explicit navigation action. Removed research-prompt text from the library cards; full saved briefs remain unchanged. Added a direct Clear search recovery action. Adjusted responsive card width, spacing, borders, image ratio and keyboard focus. Required third-party creator/licence credits remain visible in a compact line.

Root cause of the News/car image: unrestricted one-word news search accepted incidental metadata matches, and successful results were reused indefinitely. Generic News/headlines/journalism now uses the more specific journalism newsroom query. Its different cache key avoids reusing the prior car image. Existing old asset bytes are retained; no user records are deleted. Failed licensed-image searches retain a relevant local newspaper cover, updated to the approved ink/cobalt/sea-glass palette. No claim that every dynamic subject has a guaranteed suitable photo.

Checks: TypeScript and Vite build pass. Eight focused image, library and home-navigation checks pass, including rights/host validation, free-search bounds, shared cache reuse, fallback, search recovery and skeleton state. Browser checks cover the saved News category and its ten saved ideas, search/no-match/clear, desktop and phone rendering. No AI generation was triggered.

Broader-check limit: the older category-detail case in research-library-ui.test.js has a pre-existing incomplete mock for CategorySetupFields and asserts an earlier detail flow. Its focused library-render case was updated for the current empty-state wording and 16:9 image dimensions and passes; the unrelated detail-case mock was left unchanged. This pass does not claim that entire historical test file or the full application test suite passes.

No deployment or new paid service. Image lookup remains a bounded public Wikimedia lookup with existing reuse-rights checks. Mobile/desktop screenshots are in D:/AIReelsContent/validation/topic-library-simple-*.png.
