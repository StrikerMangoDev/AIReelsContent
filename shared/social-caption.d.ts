import type { StudioContent, StudioPackage } from '../src/services/studio-api'
type CaptionPackage = { content?: StudioContent | null; evidence?: StudioPackage['evidence'] }
export function cleanCaption(text: unknown): string
export function xWeightedLength(text: string): number
export function socialSourceUrls(pack: CaptionPackage, platform: string): string[]
export function renderSocialCaption(pack: CaptionPackage, platform: string): string
