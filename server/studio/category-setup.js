import { z } from 'zod'
export const categorySetupFields = {
  coverage: z.enum(['international', 'national', 'both']).default('international'),
  country: z.string().trim().max(100).default(''),
  topics: z.array(z.string().trim().min(1).max(100)).max(12).default([]),
  intent: z.string().trim().max(1500).default(''),
  exclusions: z.string().trim().max(500).default(''),
  refreshIntervalDays: z.number().int().min(1).max(30).default(7),
}
export const validCountry = value => value.coverage === 'international' || Boolean(value.country?.trim())
