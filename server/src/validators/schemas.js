import { z } from 'zod';

const body = (shape) => z.object({ body: z.object(shape), query: z.any(), params: z.any() });
const params = (shape) => z.object({ body: z.any(), query: z.any(), params: z.object(shape) });

export const loginSchema = body({
  email: z.string().email(),
  password: z.string().min(8).max(200)
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
  notesSummary: z.string().max(400).optional()
});

export const assignSchema = body({ userId: z.number().int().positive() });

export const idParams = params({ id: z.coerce.number().int().positive() });

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

export const metaAccountSchema = body({
  accountId: z.string().regex(/^(act_)?\d{5,20}$/i)
});

export const googleAccountSchema = body({
  customerId: z.string().regex(/^\d{3}-?\d{3}-?\d{4}$/)
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
  purpose: z.enum(['assistant', 'whatsapp', 'leads', 'ads', 'calls']),
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
