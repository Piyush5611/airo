import { z } from 'zod';
import { businessProfileSchema, launchEditSchema } from '../domain/adsAgent.js';
import { SECTOR_KEYS } from '../domain/sectors.js';

const body = (shape) => z.object({ body: z.object(shape), query: z.any(), params: z.any() });
const params = (shape) => z.object({ body: z.any(), query: z.any(), params: z.object(shape) });

export const loginSchema = body({
  email: z.string().email(),
  password: z.string().min(8).max(200),
  remember: z.boolean().optional()
});

export const forgotSchema = body({ email: z.string().email() });

export const resetSchema = body({
  token: z.string().min(20),
  password: z.string().min(8).max(200)
});

export const switchSchema = body({ organizationId: z.number().int().positive() });

export const leadCreateSchema = body({
  fullName: z.string().min(2).max(160),
  phone: z.string().min(8).max(32),
  email: z.union([z.string().email(), z.literal('')]).optional(),
  project: z.string().min(2).max(120),
  city: z.string().max(80).optional(),
  sourceId: z.number().int().positive().optional(),
  intent: z.enum(['low', 'medium', 'high']).optional(),
  score: z.number().int().min(0).max(100).optional(),
  budgetInr: z.number().nonnegative().optional(),
  configuration: z.string().max(40).optional(),
  notesSummary: z.string().max(400).optional()
});

export const leadUpdateSchema = body({
  status: z.enum(['new', 'contacted', 'qualified', 'site_visit', 'negotiation', 'booked', 'lost', 'unqualified']).optional(),
  score: z.number().int().min(0).max(100).optional(),
  intent: z.enum(['low', 'medium', 'high']).optional(),
  project: z.string().min(2).max(120).optional(),
  notesSummary: z.string().max(400).optional(),
  dealValueInr: z.union([z.number().nonnegative().max(100000000000), z.null()]).optional()
});

export const assignSchema = body({ userId: z.number().int().positive() });

export const idParams = params({ id: z.coerce.number().int().positive() });

const spendCap = z.union([z.coerce.number().positive().max(1000000000), z.null()]).optional();

export const adsAgentSettingsSchema = body({
  mode: z.enum(['off', 'recommend', 'approve', 'auto']),
  dailySpendCap: spendCap,
  monthlySpendCap: spendCap,
  maxBudgetChangePct: z.coerce.number().int().min(1).max(100),
  maxActionsPerDay: z.coerce.number().int().min(0).max(50),
  minSpendForDecision: z.coerce.number().min(0).max(100000000),
  killSwitch: z.boolean()
});

export const businessProfileBody = body(businessProfileSchema.shape);

export const launchCreateSchema = body({
  strategyId: z.number().int().positive(),
  platform: z.enum(['meta', 'google']),
  connectionId: z.number().int().positive().optional()
});

export const launchEditBody = idParams.merge(body(launchEditSchema.shape));

export const launchPausedBody = idParams.merge(body({
  imageBase64: z.string().min(100).max(4000000).optional()
}));

export const adsAgentSyncSchema = body({
  range: z.enum(['LAST_7_DAYS', 'LAST_30_DAYS']).optional()
});

const adEditBody = z.object({
  name: z.string().trim().min(1).max(180).optional(),
  status: z.enum(['ACTIVE', 'PAUSED', 'ENABLED', 'REMOVED']).optional(),
  budget: z.coerce.number().positive().max(1000000000).optional(),
  endDate: z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.literal('')]).optional(),
  ageMin: z.coerce.number().int().min(13).max(65).optional(),
  ageMax: z.coerce.number().int().min(13).max(65).optional(),
  gender: z.enum(['all', 'men', 'women']).optional(),
  cities: z.array(z.object({
    key: z.string().regex(/^\d{1,20}$/),
    name: z.string().max(160).optional(),
    radius: z.coerce.number().min(0).max(80).optional(),
    distanceUnit: z.enum(['kilometer', 'mile']).optional()
  })).max(50).optional(),
  interests: z.array(z.object({ id: z.string().regex(/^\d{1,25}$/), name: z.string().max(160) })).max(50).optional(),
  headline: z.string().max(255).optional(),
  text: z.string().max(2000).optional(),
  link: z.string().url().max(500).optional(),
  cta: z.string().regex(/^[A-Z_]{2,40}$/).optional(),
  cpcBid: z.coerce.number().positive().max(1000000).optional(),
  bidding: z.enum(['MAXIMIZE_CLICKS', 'MAXIMIZE_CONVERSIONS', 'MANUAL_CPC']).optional(),
  locations: z.array(z.string().regex(/^\d{1,20}$/)).max(50).optional(),
  headlines: z.array(z.string().trim().min(1).max(30)).min(3).max(15).optional(),
  descriptions: z.array(z.string().trim().min(1).max(90)).min(2).max(4).optional(),
  finalUrl: z.string().url().max(500).optional(),
  path1: z.string().max(15).optional(),
  path2: z.string().max(15).optional(),
  keywords: z.array(z.object({ text: z.string().trim().min(1).max(80), matchType: z.enum(['BROAD', 'PHRASE', 'EXACT']) })).min(1).max(50).optional()
});

const editParams = (kinds) => z.object({
  id: z.coerce.number().int().positive(),
  kind: z.enum(kinds),
  itemId: z.string().regex(/^\d{1,25}(~\d{1,25})?$/)
});

export const metaItemEdit = z.object({ body: adEditBody, query: z.any(), params: editParams(['campaign', 'adset', 'ad']) });
export const googleItemEdit = z.object({ body: adEditBody, query: z.any(), params: editParams(['campaign', 'ad_group', 'keyword', 'keywords', 'ad']) });

export const campaignParams = params({ id: z.coerce.number().int().positive(), campaignId: z.string().regex(/^\d{1,25}$/) });

const callEmployee = z.object({
  employeeId: z.union([z.string(), z.number()]).transform(String).pipe(z.string().min(1).max(40)),
  employeeName: z.string().trim().min(1).max(160)
});

export const callTeamsSchema = z.object({
  params: z.object({ id: z.coerce.number().int().positive() }),
  query: z.any(),
  body: z.object({
    heads: z.array(z.object({
      headEmployeeId: z.union([z.string(), z.number()]).transform(String).pipe(z.string().min(1).max(40)),
      headName: z.string().trim().min(1).max(160),
      members: z.array(callEmployee).max(500)
    })).max(100)
  })
});

export const taskSchema = body({
  title: z.string().min(2).max(180),
  dueAt: z.string().optional(),
  relatedType: z.string().max(40).optional(),
  relatedId: z.number().int().positive().optional()
});

export const moveSchema = body({
  stageId: z.number().int().positive(),
  lostReason: z.string().max(160).optional()
});

export const connectSchema = body({
  providerKey: z.string().min(2).max(64),
  accountLabel: z.string().max(160).optional()
});

export const nexcallKeySchema = body({
  apiKey: z.string().min(8).max(500),
  baseUrl: z.string().url().max(200).optional()
});

export const providerApiSchema = body({
  providerKey: z.string().min(2).max(64),
  accountLabel: z.string().max(160).optional(),
  apiKey: z.string().min(8).max(2000),
  accountId: z.string().max(160).optional(),
  baseUrl: z.union([z.string().url().max(200), z.literal('')]).optional()
});

export const metaCampaignSchema = body({
  name: z.string().min(2).max(180),
  objective: z.enum(['OUTCOME_LEADS', 'OUTCOME_TRAFFIC', 'OUTCOME_AWARENESS', 'OUTCOME_SALES']),
  dailyBudget: z.number().positive().max(100000000),
  status: z.enum(['PAUSED', 'ACTIVE'])
});

export const metaEditSchema = body({
  campaignId: z.string().regex(/^\d{5,20}$/),
  name: z.string().min(2).max(180),
  dailyBudget: z.number().positive().max(100000000).optional(),
  status: z.enum(['PAUSED', 'ACTIVE'])
});

export const metaStatusSchema = body({
  campaignId: z.string().regex(/^\d{5,20}$/),
  status: z.enum(['PAUSED', 'ACTIVE'])
});

const optionalId = z.union([z.string().regex(/^\d{5,20}$/), z.literal('')]).optional();

export const metaAdSchema = body({
  name: z.string().min(2).max(180),
  objective: z.enum(['OUTCOME_LEADS', 'OUTCOME_TRAFFIC', 'OUTCOME_AWARENESS', 'OUTCOME_SALES']),
  dailyBudget: z.number().positive().max(100000000),
  pageId: z.string().regex(/^\d{5,20}$/),
  headline: z.string().min(2).max(80),
  message: z.string().min(2).max(500),
  link: z.string().url().max(500),
  imageBase64: z.string().min(100).max(4000000),
  country: z.string().regex(/^[A-Z]{2}$/).optional(),
  publish: z.boolean(),
  budgetLevel: z.enum(['campaign', 'adset']).optional(),
  budgetMode: z.enum(['daily', 'lifetime']).optional(),
  startDate: z.string().max(40).optional(),
  endDate: z.string().max(40).optional(),
  advantageAudience: z.boolean().optional(),
  specialCategory: z.enum(['none', 'HOUSING', 'EMPLOYMENT', 'CREDIT', 'ISSUES_ELECTIONS_POLITICS']).optional(),
  ageMin: z.number().int().min(13).max(65).optional(),
  ageMax: z.number().int().min(13).max(65).optional(),
  gender: z.enum(['all', 'men', 'women']).optional(),
  interests: z.array(z.object({
    id: z.string().regex(/^\d{1,20}$/),
    name: z.string().min(1).max(120)
  })).max(15).optional(),
  locations: z.array(z.object({
    key: z.string().regex(/^\d{1,20}$/),
    name: z.string().min(1).max(80),
    region: z.string().max(80).optional(),
    radiusMode: z.enum(['city', 'radius']).optional(),
    radius: z.number().int().min(17).max(80).optional()
  })).max(15).optional(),
  locales: z.array(z.object({
    key: z.number().int().positive().max(100000),
    name: z.string().min(1).max(80)
  })).max(8).optional(),
  placements: z.enum(['advantage', 'manual']).optional(),
  placementFeeds: z.array(z.enum(['facebook_feed', 'facebook_story', 'instagram_feed', 'instagram_story'])).max(4).optional(),
  conversion: z.enum(['instant_form', 'messenger', 'website', 'instant_messenger', 'website_forms', 'website_calls', 'calls']).optional(),
  pixelId: optionalId,
  instagramId: optionalId,
  dynamicCreative: z.boolean().optional(),
  abTest: z.boolean().optional(),
  creativeTest: z.boolean().optional(),
  headlineB: z.string().max(80).optional(),
  messageB: z.string().max(500).optional(),
  cta: z.enum(['LEARN_MORE', 'SIGN_UP', 'CONTACT_US', 'MESSAGE_PAGE', 'SHOP_NOW']).optional()
});

const googleId = z.string().regex(/^\d{1,20}$/);
const googleDay = z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.literal('')]).optional();
const googleStatus = z.enum(['ENABLED', 'PAUSED']);

const oauthConnectionId = z.coerce.number().int().positive().optional();

export const oauthStartSchema = body({
  target: z.union([z.literal('new'), z.coerce.number().int().positive()]).optional()
});

export const oauthAccountsQuery = z.object({
  body: z.any(),
  params: z.any(),
  query: z.object({ connection: oauthConnectionId })
});

export const metaAccountSchema = body({
  accountId: z.string().regex(/^(act_)?\d{5,20}$/i),
  connectionId: oauthConnectionId
});

export const googleAccountSchema = body({
  customerId: z.string().regex(/^\d{3}-?\d{3}-?\d{4}$/),
  connectionId: oauthConnectionId
});

export const googleStatusSchema = body({
  campaignId: googleId,
  status: googleStatus
});

export const googleEditSchema = body({
  campaignId: googleId,
  name: z.string().min(2).max(180),
  dailyBudget: z.number().positive().max(100000000).optional(),
  status: googleStatus
});

export const googleIdeasSchema = body({
  seeds: z.array(z.string().trim().min(1).max(80)).max(10).optional(),
  url: z.union([z.string().url().max(500), z.literal('')]).optional(),
  locations: z.array(googleId).max(10).optional(),
  languageId: z.union([googleId, z.literal('')]).optional()
});

export const googleCampaignSchema = body({
  name: z.string().trim().min(2).max(180),
  dailyBudget: z.number().min(1).max(100000000),
  bidding: z.enum(['MAXIMIZE_CLICKS', 'MAXIMIZE_CONVERSIONS', 'MANUAL_CPC']),
  cpcBid: z.number().positive().max(100000).optional(),
  searchPartners: z.boolean().optional(),
  presenceOnly: z.boolean().optional(),
  locations: z.array(z.object({ id: googleId, name: z.string().max(120).optional() })).max(20).optional(),
  languages: z.array(z.object({ id: googleId, name: z.string().max(80).optional() })).max(10).optional(),
  keywords: z.array(z.object({
    text: z.string().trim().min(1).max(80),
    matchType: z.enum(['BROAD', 'PHRASE', 'EXACT'])
  })).min(1).max(50),
  negatives: z.array(z.string().trim().min(1).max(80)).max(50).optional(),
  finalUrl: z.string().url().max(500),
  headlines: z.array(z.string().trim().min(1).max(30)).min(3).max(15),
  descriptions: z.array(z.string().trim().min(1).max(90)).min(2).max(4),
  path1: z.string().trim().max(15).optional(),
  path2: z.string().trim().max(15).optional(),
  startDate: googleDay,
  endDate: googleDay,
  publish: z.boolean().optional()
});

export const configSchema = body({
  mapping: z.record(z.string(), z.any()).optional(),
  sync: z.record(z.string(), z.any()).optional()
});

export const askSchema = body({
  question: z.string().min(3).max(500),
  conversationId: z.number().int().positive().optional()
});

export const recommendationSchema = body({
  status: z.enum(['accepted', 'dismissed', 'open'])
});

export const inviteSchema = body({
  fullName: z.string().min(2).max(160),
  email: z.string().email(),
  role: z.enum(['admin', 'member', 'viewer']),
  dataScope: z.enum(['all', 'team', 'assigned']).optional()
});

export const settingSchema = body({
  key: z.string().min(2).max(40),
  value: z.record(z.string(), z.any())
});

export const organizationSchema = body({
  name: z.string().trim().min(2).max(160),
  legalName: z.string().trim().max(180).optional().default(''),
  city: z.string().trim().max(80).optional().default(''),
  sector: z.enum(SECTOR_KEYS)
});

const httpsLink = z.union([z.string().trim().url().max(500).regex(/^https:\/\//i, 'Website must start with https://'), z.literal('')]).optional().default('');

export const offeringSchema = body({
  kind: z.string().trim().regex(/^[a-z_]{2,40}$/, 'Choose a type'),
  name: z.string().trim().min(2).max(160),
  details: z.string().trim().max(2000).optional().default(''),
  usps: z.string().trim().max(1000).optional().default(''),
  offer: z.string().trim().max(300).optional().default(''),
  priceText: z.string().trim().max(160).optional().default(''),
  locations: z.string().trim().max(400).optional().default(''),
  website: httpsLink,
  status: z.enum(['active', 'archived']).optional().default('active'),
  websiteForm: z.boolean().optional().default(false)
});

const looseLink = (max) => z.string().trim().max(max).optional().default('')
  .refine((value) => !value || /^(https?:\/\/)?([a-z0-9-]+\.)+[a-z]{2,}(:\d+)?(\/\S*)?$/i.test(value), 'Enter a valid link like example.com');

export const competitorSchema = body({
  name: z.string().trim().min(2).max(160),
  website: looseLink(500),
  facebook: looseLink(300),
  instagram: z.string().trim().max(120).optional().default(''),
  city: z.string().trim().max(120).optional().default(''),
  notes: z.string().trim().max(1000).optional().default(''),
  status: z.enum(['active', 'archived']).optional().default('active'),
  offeringIds: z.array(z.coerce.number().int().positive()).max(50).optional()
});

export const discoverSchema = body({
  offeringId: z.coerce.number().int().min(0).optional().default(0)
});

export const researchKeySchema = body({
  apiKey: z.string().trim().min(8).max(300)
});

export const imageUploadSchema = body({
  imageBase64: z.string().min(100).max(3500000)
});

export const platformInviteSchema = body({
  fullName: z.string().min(2).max(160),
  email: z.string().email(),
  role: z.enum([
    'super_admin', 'operations_admin', 'support_admin', 'sales_admin',
    'finance_admin', 'moderation', 'analyst', 'developer_admin'
  ])
});

export const statusSchema = body({
  status: z.enum(['active', 'suspended'])
});

export const saleSchema = body({
  stage: z.enum(['prospect', 'qualified', 'demo', 'proposal', 'won', 'lost']),
  nextFollowUp: z.string().optional()
});

export const noteSchema = body({ body: z.string().min(2).max(2000) });

export const moderationSchema = body({
  status: z.enum(['queue', 'flagged', 'actioned', 'appealed', 'dismissed'])
});

export const apiKeySchema = body({ name: z.string().min(2).max(120) });

export const whatsappConnectSchema = body({
  accessToken: z.string().min(20).max(4096),
  apiVersion: z.string().regex(/^v\d+\.\d+$/, 'API version looks like v21.0'),
  phoneNumberId: z.string().regex(/^\d{6,32}$/, 'Phone number ID is the numeric id from WhatsApp'),
  verifyToken: z.string().min(4).max(200)
});

export const whatsappBotSchema = body({
  phoneLabel: z.string().min(4).max(40),
  status: z.enum(['connected', 'pending', 'paused']),
  note: z.string().max(400).optional()
});

const llmKey = z.union([z.string().trim().min(20).max(500), z.literal('')]).optional();
const llmBase = z.union([z.string().url().max(300), z.literal('')]).optional();

export const llmModelsSchema = body({
  provider: z.enum(['openai', 'anthropic', 'gemini']),
  apiKey: llmKey,
  baseUrl: llmBase
});

export const llmConnectSchema = body({
  purpose: z.enum(['assistant', 'whatsapp', 'leads', 'ads', 'calls', 'competitors']),
  provider: z.enum(['openai', 'anthropic', 'gemini']),
  model: z.string().trim().min(2).max(120),
  apiKey: llmKey,
  baseUrl: llmBase,
  manual: z.boolean().optional()
});

export const llmDisconnectSchema = body({
  id: z.number().int().positive()
});

export const llmChatSchema = body({
  messages: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string().trim().min(1).max(4000)
  })).min(1).max(20)
});

export const whatsappSendSchema = body({
  body: z.string().trim().min(1).max(4096)
});

export const whatsappBusinessSchema = body({
  organizationId: z.number().int().positive(),
  enabled: z.boolean()
});

export const whatsappNumberSchema = body({
  phone: z.string().trim().min(8).max(20),
  label: z.string().trim().max(80).optional()
});
