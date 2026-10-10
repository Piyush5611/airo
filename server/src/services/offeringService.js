import { z } from 'zod';
import * as repo from '../repositories/offeringRepo.js';
import { ApiError } from '../utils/errors.js';
import { randomToken } from '../utils/cryptoBox.js';
import { recordAudit } from './auditService.js';
import { structuredLlm } from './llmService.js';
import { catalogFor, sectorOf } from '../domain/sectors.js';
import { organizationSector } from '../repositories/workspaceRepo.js';
import { linkCounts } from '../repositories/competitorRepo.js';
import { card, options } from './adsAgent/waFormat.js';

const KIND = /^[a-z_]{2,40}$/;

const FILLER = /^(hi|hello|hey|ok|okay|yes|no|haan|han|nahi|thanks|thank you|done|best|cancel|skip|meta ads?|google ads?|run (meta|google) ads?)$/i;
const PHONE = /\+?\d[\d\s-]{8,}\d/g;
const EMAIL = /[\w.+-]+@[\w-]+\.[\w.]+/g;

function missingTable(error) {
  const code = error?.cause?.code || error?.code;
  return code === 'ER_NO_SUCH_TABLE' || code === 'ER_BAD_FIELD_ERROR';
}

export function cleanText(value, max) {
  return String(value || '').replace(PHONE, '').replace(EMAIL, '').replace(/\s+/g, ' ').trim().slice(0, max);
}

export function kindForSector(sector, wanted = '') {
  const kinds = catalogFor(sector).kinds.map((kind) => kind.key);
  return kinds.includes(wanted) ? wanted : kinds[0];
}

function mergeDetails(oldText, newText) {
  const before = String(oldText || '').trim();
  const add = String(newText || '').trim();
  if (!add || before.toLowerCase().includes(add.toLowerCase())) return before;
  return (before ? `${before}\n${add}` : add).slice(0, 2000);
}

export async function rememberOffering(organizationId, item, source = 'ad_chat') {
  const name = cleanText(item?.name, 160);
  if (!organizationId || name.length < 2 || FILLER.test(name)) return null;
  const next = {
    kind: KIND.test(String(item.kind || '')) ? item.kind : 'product',
    name,
    details: cleanText(item.details, 1000),
    usps: cleanText(item.usps, 1000),
    offer: cleanText(item.offer, 300),
    priceText: cleanText(item.priceText, 160),
    locations: cleanText(item.locations, 400),
    website: /^https:\/\//i.test(String(item.website || '')) ? String(item.website).trim().slice(0, 500) : '',
    source
  };
  try {
    const found = await repo.byName(organizationId, name);
    if (!found) return await repo.create(organizationId, next);
    await repo.update(organizationId, found.id, {
      kind: found.kind,
      name: found.name,
      details: mergeDetails(found.details, next.details),
      usps: found.usps || next.usps,
      offer: found.offer || next.offer,
      priceText: found.priceText || next.priceText,
      locations: found.locations || next.locations,
      website: found.website || next.website,
      status: 'active'
    });
    return found.id;
  } catch (error) {
    if (missingTable(error)) return null;
    throw error;
  }
}

export async function addOfferingDetails(organizationId, id, details) {
  const extra = cleanText(details, 1000);
  if (!id || !extra) return;
  try {
    const found = await repo.byId(organizationId, id);
    if (!found) return;
    await repo.update(organizationId, id, { ...found, details: mergeDetails(found.details, extra) });
  } catch (error) {
    if (!missingTable(error)) throw error;
  }
}

export async function saveTypedOffering({ organizationId, text, name, website = '', sector = '' }) {
  let ids = [];
  try {
    ids = await captureFromMessage({ organizationId, text, source: 'ad_chat' });
  } catch {
    ids = [];
  }
  if (ids.length) return ids;
  const id = await rememberOffering(organizationId, { kind: kindForSector(sector), name, website }, 'ad_chat');
  return id ? [id] : [];
}

export async function savedOfferings(organizationId, limit = 20) {
  try {
    return await repo.list(organizationId, { limit });
  } catch (error) {
    if (missingTable(error)) return [];
    throw error;
  }
}

export async function markOfferingsUsed(organizationId, ids) {
  try {
    await repo.markUsed(organizationId, (ids || []).filter(Boolean));
  } catch {
    // Usage counts are only a sort hint.
  }
}

const captureSchema = z.object({
  items: z.array(z.object({
    kind: z.string().trim().max(40).default(''),
    name: z.string().trim().min(2).max(80),
    details: z.string().trim().max(400).default(''),
    price: z.string().trim().max(120).default(''),
    locations: z.string().trim().max(200).default(''),
    website: z.string().trim().max(300).default('')
  })).max(3).default([])
});

const CAPTURE_BRIEF = `You read one WhatsApp message a business owner sent to their marketing assistant.
Find products, projects, services, courses or packages that THIS business sells, only when the message clearly names or describes one.
Return an empty list for greetings, questions, report or campaign requests, budgets, city lists, approvals, competitor names and commands such as "run meta ads".
If the message adds details to an item in the saved list, use that item's exact saved name.
Fill only what the message says: details (features, size, selling points), price (as written), locations (where it is or is sold), website (https link). Never invent anything.
Never include phone numbers, email addresses or customer names.`;

export function worthReading(text) {
  const value = String(text || '').trim();
  if (value.length < 12 || value.length > 2000) return false;
  if (FILLER.test(value) || /^Photo \d{6,40}$/.test(value)) return false;
  if (/^[\d\s,.+\-kK]+$/.test(value)) return false;
  return /[a-z]{3,}/i.test(value);
}

export async function captureFromMessage({ organizationId, text, source = 'whatsapp' }) {
  if (!organizationId || !worthReading(text)) return [];
  const [saved, sector] = await Promise.all([savedOfferings(organizationId, 30), organizationSector(organizationId).catch(() => '')]);
  const kinds = catalogFor(sector).kinds;
  const { data } = await structuredLlm({
    organizationId,
    schema: captureSchema,
    feature: 'offering_capture',
    system: CAPTURE_BRIEF,
    facts: [
      `Allowed kinds (use the key): ${kinds.map((kind) => `${kind.key} = ${kind.label}`).join('; ')}`,
      saved.length ? `Saved items: ${saved.map((item) => item.name).join('; ')}` : 'Saved items: none',
      `Message: ${cleanText(text, 1500)}`
    ].join('\n'),
    task: `Reply as JSON: {"items":[{"kind":"${kinds[0].key}","name":"","details":"","price":"","locations":"","website":""}]}`,
    maxTokens: 800,
    purposes: ['whatsapp', 'ads', 'assistant']
  });
  const ids = [];
  for (const item of data.items) {
    const id = await rememberOffering(organizationId, { ...item, kind: kindForSector(sector, item.kind), priceText: item.price }, source);
    if (id) ids.push(id);
  }
  return ids;
}

const DONE = /^(done|ho gaya|ho gya|hogaya|bas|aage|next|continue|chalo|finish)\b/i;
const NEW = /^\+?\s*(add new|new|naya|nayi|kuch aur|something else|other product|add more|aur add)\b/i;
const tapName = (value) => String(value || '').replace(/^[\s✓✔+\-]+/, '').trim().toLowerCase();

function findItem(items, value) {
  const wanted = tapName(value);
  if (!wanted) return null;
  return items.find((item) => tapName(item.name) === wanted)
    || items.find((item) => wanted.length >= 20 && tapName(item.name).startsWith(wanted.replace(/…$/, '')))
    || null;
}

export function offeringPick(text, payload) {
  const items = payload.offeringChoices || [];
  const picked = payload.pickedOfferings || [];
  const extra = payload.offeringExtra || [];
  const value = String(text || '').trim();
  if (DONE.test(value)) return picked.length || extra.length ? { kind: 'final' } : { kind: 'empty' };
  if (NEW.test(value)) return { kind: 'new' };
  const numbers = /^\s*\d+(\s*[, ]\s*\d+)*\s*$/.test(value) ? value.split(/[\s,]+/).map(Number) : [];
  if (numbers.length) {
    const ids = [...new Set(numbers.map((n) => items[n - 1]?.id).filter(Boolean))];
    if (!ids.length) return { kind: 'empty' };
    payload.pickedOfferings = ids;
    return { kind: 'final' };
  }
  const item = findItem(items, value);
  if (item) {
    const on = picked.includes(item.id);
    payload.pickedOfferings = on ? picked.filter((id) => id !== item.id) : [...picked, item.id];
    return { kind: 'toggle', added: !on, name: item.name };
  }
  const dropped = extra.find((name) => tapName(name) === tapName(value));
  if (dropped) {
    payload.offeringExtra = extra.filter((name) => name !== dropped);
    return { kind: 'toggle', added: false, name: dropped };
  }
  if (value.length < 2 || FILLER.test(value)) return { kind: 'empty' };
  payload.offeringExtra = [...new Set([...extra, cleanText(value, 120)])].slice(0, 5);
  return { kind: 'toggle', added: true, name: cleanText(value, 120) };
}

export function offeringMenu(payload, english, platform = 'meta') {
  const say = (en, hi) => (english ? en : hi);
  const items = payload.offeringChoices || [];
  const picked = payload.pickedOfferings || [];
  const extra = payload.offeringExtra || [];
  const chosen = [...items.filter((item) => picked.includes(item.id)).map((item) => item.name), ...extra];
  const rows = [];
  if (chosen.length) rows.push({ id: 'offer_done', title: 'Done', description: `${say('Use', 'Use karo')}: ${chosen.join(', ')}`.slice(0, 72) });
  for (const item of items.slice(0, 10 - rows.length - 1)) {
    const on = picked.includes(item.id);
    rows.push({
      id: `offer_${item.id}`,
      title: `${on ? '✓ ' : ''}${item.name}`.slice(0, 24),
      description: (on ? say('Selected. Tap again to remove.', 'Selected. Hatane ke liye dobara tap karo.') : [item.priceText, item.details].filter(Boolean).join(' · ') || say('Tap to select', 'Select karne ke liye tap karo')).slice(0, 72)
    });
  }
  rows.push({ id: 'offer_new', title: 'Add new', description: say('Something not in this list', 'Jo is list mein nahi hai') });
  return {
    body: chosen.length
      ? say(`Selected: ${chosen.join(', ')}. Tap more, or Done.`, `Selected: ${chosen.join(', ')}. Aur tap karo, ya Done.`)
      : platform === 'google'
        ? say('Tap one or more, then Done. Or Add new.', 'Ek ya zyada tap karo, phir Done. Ya Add new.')
        : say('Tap one or more, then Done. Each item gets its own ad set and ad in one campaign. Or Add new.', 'Ek ya zyada tap karo, phir Done. Har item ka alag ad set aur ad banega, ek hi campaign mein. Ya Add new.'),
    button: say('Choose', 'Chuno'),
    title: say('Saved', 'Saved'),
    rows
  };
}

export function chosenOfferings(payload) {
  const items = payload.offeringChoices || [];
  const picked = payload.pickedOfferings || [];
  const chosen = items.filter((item) => picked.includes(item.id));
  const extra = payload.offeringExtra || [];
  const names = [...chosen.map((item) => item.name), ...extra];
  const detailLines = chosen
    .map((item) => [offeringFacts(item), item.locations ? `location ${item.locations}` : ''].filter(Boolean).join('; '))
    .map((line, index) => (line ? `${chosen[index].name}: ${line}` : ''))
    .filter(Boolean);
  return {
    ids: chosen.map((item) => item.id),
    extra,
    items: [...chosen, ...extra.map((name) => ({ id: null, name }))].slice(0, MAX_AD_ITEMS),
    product: names.join(' + ').slice(0, 120),
    details: detailLines.join('\n').slice(0, 500),
    website: chosen.map((item) => item.website).find(Boolean) || '',
    locations: [...new Set(chosen.map((item) => item.locations).filter(Boolean))].join('; ').slice(0, 300)
  };
}

export const MAX_AD_ITEMS = 4;

export function applyOfferings(payload) {
  const chosen = chosenOfferings(payload);
  payload.category = sectorOf(payload.sector)?.label || chosen.product;
  payload.product = chosen.product;
  payload.offeringIds = chosen.ids;
  payload.adItems = chosen.items.map((item) => ({
    id: item.id || null,
    name: item.name,
    facts: item.id ? offeringFacts(item) : '',
    link: item.website || '',
    points: String(item.usps || '').split(/[,;\n]+/).map((point) => point.trim()).filter((point) => point.length > 2).slice(0, 3)
  }));
  if (chosen.details) {
    payload.details = chosen.details;
    payload.detailsDone = true;
  }
  if (chosen.website && !payload.website) {
    payload.website = chosen.website;
    payload.noWebsite = false;
  }
  delete payload.offeringChoices;
  delete payload.pickedOfferings;
  delete payload.offeringExtra;
  return chosen;
}

export function saveAnswer(text) {
  const value = String(text || '').trim();
  if (/^(haan|han|ha|yes|y|save|ok|okay|theek|thik)\b/i.test(value)) return 'yes';
  if (/^(nahi|nahin|nhi|no|mat|skip|sirf|only)\b/i.test(value)) return 'no';
  return '';
}

export function saveMenu(english) {
  const say = (en, hi) => (english ? en : hi);
  return {
    body: say('Save it in AIRO → Products & Projects for next time?', 'Agli baar ke liye AIRO → Products & Projects mein save karun?'),
    button: say('Choose', 'Chuno'),
    title: 'Save',
    rows: [
      { id: 'offer_save_yes', title: say('Yes, save it', 'Haan, save karo'), description: say('Shows in the list next time', 'Agli baar list mein dikhega') },
      { id: 'offer_save_no', title: say('No, only this ad', 'Nahi, sirf is ad ke liye'), description: say('Use it now, do not save', 'Abhi use karo, save mat karo') }
    ]
  };
}

export function savePrompt(names, english) {
  const say = (en, hi) => (english ? en : hi);
  return card([
    say(`OK, the ad will be for: *${names.join(', ')}*.`, `Theek hai, ad iske liye banegi: *${names.join(', ')}*.`),
    say('Save it in AIRO → Products & Projects so it shows in the list next time?', 'Agli baar list mein dikhe, iske liye AIRO → Products & Projects mein save karun?'),
    options([['haan', say('save it', 'save karo')], ['nahi', say('only for this ad', 'sirf is ad ke liye')]])
  ]);
}

export async function savePending(organizationId, payload, yes, english) {
  const say = (en, hi) => (english ? en : hi);
  const names = payload.pendingSave || [];
  const typed = payload.typedProduct;
  delete payload.pendingSave;
  delete payload.typedProduct;
  if (!yes) return '';
  const ids = [];
  for (const name of names) {
    ids.push(...await saveTypedOffering({ organizationId, text: names.length === 1 && typed ? typed : name, name, website: payload.website, sector: payload.sector }));
  }
  payload.savedOfferingIds = [...new Set(ids)];
  return ids.length
    ? say('Saved in Products & Projects. Add photos there and AIRO will use them in the ad designs.', 'Products & Projects mein save ho gaya. Wahan photos add karoge to AIRO unhe ad design mein use karega.')
    : say('Could not save it right now. The ad setup continues.', 'Abhi save nahi ho paya. Ad setup chalu hai.');
}

export function offeringFacts(item) {
  return [
    item.priceText ? `price ${item.priceText}` : '',
    item.offer ? `offer ${item.offer}` : '',
    item.usps ? `selling points ${item.usps}` : '',
    item.details || ''
  ].filter(Boolean).join('; ').slice(0, 600);
}

export function slimOffering(row) {
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    details: String(row.details || '').slice(0, 300),
    usps: String(row.usps || '').slice(0, 300),
    offer: row.offer || '',
    priceText: row.priceText || '',
    locations: row.locations || '',
    website: row.website || '',
    photoCount: Number(row.photoCount) || 0
  };
}

export async function offeringAssets(organizationId, ids) {
  try {
    const [rows, mark] = await Promise.all([repo.firstPhotos(organizationId, (ids || []).filter(Boolean)), repo.logo(organizationId)]);
    return {
      photos: Object.fromEntries(rows.map((row) => [String(row.offeringId), Buffer.from(row.bytes).toString('base64')])),
      logo: mark ? Buffer.from(mark.bytes).toString('base64') : ''
    };
  } catch (error) {
    if (missingTable(error)) return { photos: {}, logo: '' };
    throw error;
  }
}

export async function listOfferings(auth) {
  try {
    const [items, media, mark, sector, rivals] = await Promise.all([
      repo.list(auth.organizationId, { status: 'all' }),
      repo.photoIds(auth.organizationId),
      repo.logo(auth.organizationId),
      organizationSector(auth.organizationId),
      linkCounts(auth.organizationId).catch(() => [])
    ]);
    const byItem = {};
    for (const row of media) (byItem[row.offeringId] ||= []).push(row.id);
    const rivalCount = new Map(rivals.map((row) => [Number(row.offeringId), Number(row.total)]));
    return {
      ready: true,
      catalog: catalogFor(sector),
      logoId: mark?.id || null,
      maxPhotos: MAX_PHOTOS,
      items: items.map((item) => ({ ...item, photoIds: byItem[item.id] || [], competitorCount: rivalCount.get(item.id) || 0 }))
    };
  } catch (error) {
    if (missingTable(error)) return { ready: false, items: [], note: 'Run npm run migrate to set up products and projects.' };
    throw error;
  }
}

function bodyItem(body) {
  return {
    kind: body.kind,
    name: cleanText(body.name, 160),
    details: cleanText(body.details, 2000),
    usps: cleanText(body.usps, 1000),
    offer: cleanText(body.offer, 300),
    priceText: cleanText(body.priceText, 160),
    locations: cleanText(body.locations, 400),
    website: body.website || '',
    status: body.status || 'active'
  };
}

export async function createOffering(auth, req) {
  const item = bodyItem(req.body);
  if (await repo.byName(auth.organizationId, item.name)) throw new ApiError(409, 'An item with this name already exists.', 'conflict');
  const id = await repo.create(auth.organizationId, { ...item, source: 'manual' });
  await recordAudit(req, { action: 'offering.created', resource: 'offering', resourceId: id });
  if (req.body.websiteForm && item.website) {
    await repo.setFormToken(auth.organizationId, id, randomToken());
    await recordAudit(req, { action: 'offering.form_link_created', resource: 'offering', resourceId: id });
  }
  return listOfferings(auth);
}

export async function updateOffering(auth, req, id) {
  const found = await repo.byId(auth.organizationId, id);
  if (!found) throw new ApiError(404, 'Item not found.', 'not_found');
  const item = bodyItem(req.body);
  const clash = await repo.byName(auth.organizationId, item.name);
  if (clash && clash.id !== found.id) throw new ApiError(409, 'An item with this name already exists.', 'conflict');
  await repo.update(auth.organizationId, id, item);
  await recordAudit(req, { action: 'offering.updated', resource: 'offering', resourceId: id });
  if (!item.website && found.formToken) {
    await repo.setFormToken(auth.organizationId, id, null);
    await recordAudit(req, { action: 'offering.form_link_removed', resource: 'offering', resourceId: id });
  }
  return listOfferings(auth);
}

export async function deleteOffering(auth, req, id) {
  const found = await repo.byId(auth.organizationId, id);
  if (!found) throw new ApiError(404, 'Item not found.', 'not_found');
  await repo.remove(auth.organizationId, id);
  await recordAudit(req, { action: 'offering.deleted', resource: 'offering', resourceId: id });
  return listOfferings(auth);
}

export const MAX_PHOTOS = 5;

export function imageBytes(raw) {
  const cleaned = String(raw || '').replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, '').replace(/\s/g, '');
  const bytes = Buffer.from(cleaned, 'base64');
  const jpeg = bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8;
  const png = bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  if ((!jpeg && !png) || bytes.length < 100 || bytes.length > 2500000) {
    throw new ApiError(422, 'Upload a JPG or PNG image under 2 MB.', 'validation_error');
  }
  return { bytes, mime: png ? 'image/png' : 'image/jpeg' };
}

export async function addPhoto(auth, req, id) {
  const found = await repo.byId(auth.organizationId, id);
  if (!found) throw new ApiError(404, 'Item not found.', 'not_found');
  if ((await repo.photos(auth.organizationId, id)).length >= MAX_PHOTOS) {
    throw new ApiError(422, `An item can have up to ${MAX_PHOTOS} photos. Delete one first.`, 'validation_error');
  }
  const { bytes, mime } = imageBytes(req.body.imageBase64);
  const mediaId = await repo.addMedia(auth.organizationId, id, 'photo', mime, bytes);
  await recordAudit(req, { action: 'offering.photo_added', resource: 'offering', resourceId: id, metadata: { mediaId } });
  return listOfferings(auth);
}

export async function media(auth, id) {
  const row = await repo.mediaById(auth.organizationId, id);
  if (!row) throw new ApiError(404, 'Image not found.', 'not_found');
  return { mime: row.mime, bytes: Buffer.from(row.bytes) };
}

export async function deleteMedia(auth, req, id) {
  const row = await repo.mediaById(auth.organizationId, id);
  if (!row) throw new ApiError(404, 'Image not found.', 'not_found');
  await repo.removeMedia(auth.organizationId, id);
  await recordAudit(req, { action: row.kind === 'logo' ? 'offering.logo_removed' : 'offering.photo_removed', resource: 'offering', resourceId: row.offeringId || null, metadata: { mediaId: id } });
  return listOfferings(auth);
}

export async function saveLogo(auth, req) {
  const { bytes, mime } = imageBytes(req.body.imageBase64);
  await repo.removeLogos(auth.organizationId);
  const mediaId = await repo.addMedia(auth.organizationId, null, 'logo', mime, bytes);
  await recordAudit(req, { action: 'offering.logo_saved', resource: 'organization', resourceId: auth.organizationId, metadata: { mediaId } });
  return listOfferings(auth);
}
