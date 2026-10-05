import { z } from 'zod';

const PLATFORMS = ['meta', 'google'];
const text = (max) => z.string().trim().max(max);
const amount = z.union([z.coerce.number().nonnegative().max(1000000000), z.null()]).optional().default(null);

export const businessProfileSchema = z.object({
  businessName: text(160).min(2),
  category: text(80).min(2),
  offering: text(800).min(10),
  locations: z.array(text(80).min(2)).min(1).max(15),
  audience: text(600).optional().default(''),
  usps: z.array(text(160).min(2)).max(8).optional().default([]),
  website: z.union([z.string().trim().url().max(300), z.literal('')]).optional().default(''),
  languages: z.array(text(30).min(2)).max(5).optional().default([]),
  competitors: z.array(text(120).min(2)).max(5).optional().default([]),
  goal: z.enum(['leads', 'sales', 'traffic', 'awareness']),
  platforms: z.array(z.enum(PLATFORMS)).min(1).max(2),
  currency: z.string().trim().regex(/^[A-Z]{3}$/).optional().default('INR'),
  priceMin: amount,
  priceMax: amount,
  avgLeadValue: amount,
  targetCpl: amount,
  monthlyBudget: amount,
  notes: text(800).optional().default('')
});

const audienceSchema = z.object({
  platform: z.enum(PLATFORMS),
  name: text(80).min(2),
  description: text(400).min(5),
  locations: z.array(text(80).min(2)).max(10).default([]),
  ageMin: z.number().int().min(18).max(65).nullable().optional(),
  ageMax: z.number().int().min(18).max(65).nullable().optional(),
  interests: z.array(text(60).min(2)).max(10).default([])
});

const baseStrategy = z.object({
  summary: text(800).min(20),
  platforms: z.array(z.object({
    platform: z.enum(PLATFORMS),
    budgetSharePct: z.number().min(0).max(100),
    objective: text(60).min(2),
    why: text(400).min(5)
  })).min(1).max(2),
  audiences: z.array(audienceSchema).min(1).max(6),
  keywords: z.array(z.object({ text: text(80).min(2), matchType: z.enum(['EXACT', 'PHRASE', 'BROAD']) })).max(30).default([]),
  negativeKeywords: z.array(text(80).min(2)).max(20).default([]),
  angles: z.array(z.object({ name: text(60).min(2), message: text(300).min(5) })).min(2).max(6),
  headlines: z.array(text(40).min(5)).min(3).max(10),
  primaryTexts: z.array(text(300).min(20)).min(2).max(5),
  tests: z.array(z.object({
    hypothesis: text(300).min(5),
    variantA: text(160).min(2),
    variantB: text(160).min(2),
    metric: z.enum(['ctr', 'cost_per_result', 'lead_quality'])
  })).max(4).default([]),
  risks: z.array(text(240).min(5)).max(6).default([])
});

export function strategySchemaFor(profile) {
  const allowed = new Set(profile.platforms);
  return baseStrategy.superRefine((value, ctx) => {
    const seen = new Set();
    for (const [index, row] of value.platforms.entries()) {
      if (!allowed.has(row.platform)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['platforms', index, 'platform'], message: `Use only ${[...allowed].join(' and ')}.` });
      }
      if (seen.has(row.platform)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['platforms', index, 'platform'], message: 'Each platform once.' });
      }
      seen.add(row.platform);
    }
    const share = value.platforms.reduce((sum, row) => sum + row.budgetSharePct, 0);
    if (Math.abs(share - 100) > 1) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['platforms'], message: `budgetSharePct must add up to 100 (now ${share}).` });
    }
    value.audiences.forEach((row, index) => {
      if (!allowed.has(row.platform)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['audiences', index, 'platform'], message: `Use only ${[...allowed].join(' and ')}.` });
      }
      if (row.ageMin != null && row.ageMax != null && row.ageMin > row.ageMax) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['audiences', index, 'ageMin'], message: 'ageMin must not be above ageMax.' });
      }
    });
    if (allowed.has('google') && value.keywords.length < 5) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['keywords'], message: 'Give at least 5 Google keywords.' });
    }
    if (!allowed.has('google') && value.keywords.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['keywords'], message: 'Leave keywords empty when Google is not used.' });
    }
  });
}

export const metaCreativeSchema = z.object({
  variants: z.array(z.object({
    headline: text(40).min(5),
    primaryText: text(300).min(20)
  })).min(2).max(3)
});

export const googleCreativeSchema = z.object({
  headlines: z.array(text(30).min(3)).min(8).max(15),
  descriptions: z.array(text(90).min(10)).min(2).max(4),
  path1: text(15).optional().default(''),
  path2: text(15).optional().default('')
}).superRefine((value, ctx) => {
  const unique = new Set(value.headlines.map((item) => item.toLowerCase()));
  if (unique.size !== value.headlines.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['headlines'], message: 'Headlines must all be different.' });
  }
});

export const OBJECTIVE_FOR_GOAL = {
  leads: { objective: 'OUTCOME_LEADS', conversion: 'instant_form' },
  sales: { objective: 'OUTCOME_SALES', conversion: 'website' },
  traffic: { objective: 'OUTCOME_TRAFFIC', conversion: 'website' },
  awareness: { objective: 'OUTCOME_AWARENESS', conversion: 'website' }
};

export const launchEditSchema = z.object({
  dailyBudget: z.coerce.number().positive().max(100000000).optional(),
  link: z.union([z.string().trim().url().max(500), z.literal('')]).optional(),
  pageId: z.union([z.string().regex(/^\d{5,20}$/), z.literal('')]).optional(),
  specialCategory: z.enum(['none', 'HOUSING', 'EMPLOYMENT', 'CREDIT', 'ISSUES_ELECTIONS_POLITICS']).optional(),
  metaVariants: metaCreativeSchema.shape.variants.optional(),
  googleHeadlines: z.array(text(30).min(3)).min(3).max(15).optional(),
  googleDescriptions: z.array(text(90).min(10)).min(2).max(4).optional(),
  keywords: z.array(z.object({ text: text(80).min(2), matchType: z.enum(['EXACT', 'PHRASE', 'BROAD']) })).min(1).max(50).optional(),
  negatives: z.array(text(80).min(2)).max(50).optional()
});

export function budgetPlan(profile, strategy) {
  if (!(Number(profile.monthlyBudget) > 0)) return null;
  const monthly = Number(profile.monthlyBudget);
  return {
    currency: profile.currency,
    monthly,
    platforms: strategy.platforms.map((row) => ({
      platform: row.platform,
      monthly: Math.round((monthly * row.budgetSharePct) / 100),
      daily: Math.round((monthly * row.budgetSharePct) / 100 / 30)
    }))
  };
}
