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

export const whatsappBusinessSchema = body({
  organizationId: z.number().int().positive(),
  enabled: z.boolean()
});
