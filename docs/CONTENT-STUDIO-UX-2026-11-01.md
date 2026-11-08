# Content Studio editor redesign

## Audit

The previous editor hid content types in a dropdown, gave secondary tools equal prominence to the main workflow, showed different platform captions together, and used small scrolling textareas beside an oversized empty preview. Slide selection in the editor and preview was disconnected. Large headings and repeated explanatory copy pushed useful content below the fold.

## Implementation plan and result

1. Keep three main steps: Setup, Edit & preview, Download. Place sources, revisions, media and history in a labeled supporting-tools control.
2. Expose Caption, Carousel, Script, Hooks and Keywords as visible buttons with plain-language descriptions. Retain optional article, post and planning content when present.
3. Show one caption version at a time, with larger labeled fields, character counts and copy actions. Preserve citation markers in the saved draft; copy and preview use the existing clean-copy helper.
4. Link numbered slide selectors to preview navigation. Keep the preview clearly labeled as a text layout, not a generated image or live Instagram post.
5. Use a compact desktop editor/preview split and a mobile Edit content / See preview switch. Preserve existing validation, generation confirmation, save and download handlers.

Implemented without new dependencies, provider calls, paid services or deployment.

## References

- Original local n8n product: `D:/Old/spiritual-media-os/components/output/OutputTabs.tsx`, `OutputDigest.tsx` and `PlatformCaptions.tsx`. Source inspected for named outputs, digest and copy patterns; old application was not run.
- Buffer composer: https://buffer.com/resources/buffer-vs-later/
- Planable composer: https://help.planable.io/hc/en-us/articles/21715290660508-Create-a-post
- Buffer platform preview: https://support.buffer.com/article/561-using-twitter-with-buffer

Reference screenshots were inspected. No third-party visual assets were copied.

## Local verification

- TypeScript/Vite build passed.
- Six focused UI/download tests passed, including controlled carousel synchronization, scene bounds, platform-caption isolation, generation confirmation and server-approved export handling.
- Signed-in Chrome tested against existing astrology draft `d36437f271d2625f38162f2c415a1bf2`.
- Selecting slide 2 updated the editor and preview; preview Next selected slide 3 in the editor.
- Copy action displayed success. Browser clipboard readback did not expose the copied value, so clipboard payload was not independently verified.
- Mobile viewport 390 x 844: section controls, editor/preview switching and download navigation checked. Document width 375 with viewport width 390; no horizontal overflow.
- Actual Markdown and JSON downloads completed from the existing content; no regeneration needed for the UI test.
- Screenshots: `D:/AIReelsContent/validation/studio-redesign-desktop.png` and `studio-redesign-mobile.png`.

## Limits

Mobile testing used a Chrome viewport, not physical hardware. Automatic citation checks do not establish factual accuracy. Carousel preview remains a storyboard until image assets exist. No deployment or new paid-service activation.
