# Changelog

Significant structural changes only. Newest first.

### 2026-10-08 (Keyword Planner check on Google Ads connect)

- **Change:** Choosing a Google Ads account now also sends one read-only keyword idea request and saves the Keyword Planner status (`ready`, `needs_basic` when the developer token has Explorer access, or `failed`) in the encrypted credential. Connection detail returns `keywordPlanner`, and `POST /api/connections/:id/google/keyword-check` checks again.
- **Change (client):** The Google Ads Account & sync tab shows a Google Keyword Planner panel with the status, what to do, and Check again.
- **Change:** The competitor report says plainly when search demand is empty because of Explorer access.
- **Change:** `structuredLlm` waits and retries twice when a model answers that it is busy (high demand, overloaded, 429, 503, 529).

### 2026-10-08 (Competitor websites found automatically)

- **Change:** Discovery looks up a website for up to 8 top candidates that have none (one Google search run with "name city" per candidate). A result is taken only when every distinctive word of the name is in its domain or title; portals and social sites are never taken.
- **Change:** New `POST /api/competitors/:id/find-website` (10 minute cooldown per competitor) fills a missing website and starts the analysis. Adding or linking a suggestion without a website runs it in the background.
- **Change (client):** A competitor with no website shows a Find website button.

### 2026-10-08 (Competitor search fixes after the first live runs)

- **Fix:** Apify rejects `maxTotalChargeUsd` below $0.50, so Google search and Maps never ran. `runActor` now sends at least $0.50; `maxItems` still limits what is actually billed.
- **Fix:** Without an AI model every project searched the same words ("real estate"). The rules plan now uses the project type (flats, commercial space, plots, villas, BHK from the name or details) and the area and city read from its address, skipping plot numbers, pin codes and states.
- **Change:** After each search, suggestions the owner never acted on that were not found again are removed. Added and ignored ones stay.
- **Change (client):** The suggestions panel warns when no AI model checked the results.

### 2026-10-08 (Competitors per project)

- **Change:** A competitor can be linked to one or more products or projects through the new `competitor_offerings` table. A competitor with no link competes with the whole business. Create and edit take an optional `offeringIds` list. List and detail return `offeringIds`.
- **Change:** Discovery takes a scope. `POST /api/competitors/discover` takes `offeringId` (0 means the whole business), and `GET /api/competitors/suggestions?offeringId=` lists suggestions for that scope. For a project, the AI plans the search and judges matches against that one project (type, area, price). Competitors tracked for another project can still be suggested; Add then only links them (`trackedId`, `linked`).
- **Change:** Analysis compares a linked competitor only with its linked items. Unlinked competitors are still compared with the whole catalog.
- **Change:** The weekly job searches the business and each active project not searched in 7 days, at most 10 projects per business (most used first), and up to 6 searches per 6-hour run.
- **Change:** In ad chat, competitors linked to the product being advertised are shown first.
- **Change (client):** The Competitors page has a chooser for the whole business or one project, with suggestions, the list and the Find button following it. The form has project checkboxes, cards and detail show linked projects, and each Products & Projects card links to its competitors with a count.
- **Migration/API impact:** `030_project_competitors.sql` adds `competitor_offerings` and an `offering_id` column (0 for the whole business) to `competitor_suggestions` and `competitor_discovery_runs`. The suggestion unique key is now organization, offering and match key.

### 2026-10-08 (Apify moved to the platform)

- **Change:** Apify is no longer a business connection. One shared token lives in the new `platform_tools` table (encrypted, last 4 shown). It is managed on the new platform page Research Tools (`/platform/research`) through `GET/POST/DELETE /api/admin/research(/apify)`. The token is checked with `GET https://api.apify.com/v2/users/me` before it is saved.
- **Change:** New platform permission `research_tools.manage`, held by Super Admin (all) and Developer/Admin only. Businesses do not see the Research tab or the key.
- **Change:** Discovery uses the platform token. The weekly job runs only when that token exists, for active or onboarding organizations that have an active offering or a business profile.
- **Migration/API impact:** `029_platform_research_tools.sql` creates `platform_tools`, copies any connected business Apify token into it, and removes the `apify` provider and its connections. The Connections Research category is gone.

### 2026-10-08 (AIRO finds competitors itself)

- **Change:** New provider `apify` in a new Connections category, Research. The token is checked with `GET https://api.apify.com/v2/users/me` before it is saved encrypted.
- **Change:** New `integrations/apify.js`. `runActor` uses `run-sync-get-dataset-items` with `maxItems` and a `maxTotalChargeUsd` cap per run: Google search (`apify/google-search-scraper`, 1 page per search, India, $0.10 cap), Meta Ad Library keyword search (`apify/facebook-ads-scraper`, 20 ads per keyword, $0.40 cap), and Google Maps (`compass/crawler-google-places`, 15 places per search, $0.25 cap).
- **Change:** New `services/competitorDiscovery.js`.
  - The AI plans up to 4 searches, 3 ad keywords, 2 Maps categories and the location from the profile and saved offerings, and never uses the owner's own names. Without an AI model it falls back to the category and city.
  - `collectCandidates` merges Google ads, Google results, Meta advertisers and Maps places by domain, or by name when there is no website. It drops portals, directories, social, news and government sites, the owner's own domains and name, and saved competitors, and scores by how often and where they show up.
  - The top 15 home pages are read. The AI marks each one direct, indirect, not_competitor or unclear with a one-line reason. Not-competitors are not saved.
  - Suggestions are saved in `competitor_suggestions` with status new, added or ignored. Ignored and added stay that way on later runs. Add creates the competitor and starts its analysis.
- **Change:** Routes `GET /api/competitors/suggestions`, `POST /api/competitors/discover` (30 minute cooldown), and `POST /api/competitors/suggestions/:id/add` and `/ignore`.
- **Change:** The job `competitors.discover` runs every 6 hours and searches for up to 3 organizations that have Apify connected and no search in the last 7 days.
- **Change (client):** The Competitors page has a "Suggested by AIRO" panel with a Find competitors button, the last search summary, cards with fit, reason and where each one was seen, and Add, Ignore and Bring back.
- **Migration/API impact:** `028_competitor_discovery.sql` adds the `apify` provider row, `competitor_discovery_runs` and `competitor_suggestions`.

### 2026-10-07 (Competitor Intelligence, phase 1)

- **Change:** New `integrations/webPage.js`, a shared public page reader. `fetchPublic` (public http or https only, private addresses blocked, every redirect checked, 12 second timeout, size cap), `pageText` (title, description, h1 to h3, visible text without scripts), `samePageLinks` (same-site links scored by project, price, offer and similar words) and `pricesIn`. `websiteFormService` now uses it instead of its own copy.
- **Change:** New `services/competitorService.js` and `repositories/competitorRepo.js`. `POST /api/competitors/:id/analyze` reads the competitor's home page plus up to 5 useful same-site pages, adds Google Keyword Planner ideas for their name and website when Google Ads is connected, and asks the AI (purpose `competitors`, then `ads`, then `assistant`) for a schema-checked report: summary, positioning, audience, offerings with source page, strengths, weak spots, messaging, enquiry methods, comparison with the saved offerings, actions, threat level and gaps. The analysis runs in the background (one at a time per competitor, 5 minute cooldown), and the page polls. A failed run is saved with plain notes. No paid tool or browser is used, so pages that only render with JavaScript may read thin.
- **Change:** Routes `GET/POST /api/competitors`, `GET/PATCH/DELETE /api/competitors/:id`, `POST /api/competitors/import-profile` (names from the business profile). View needs `campaigns.view`, changes need `campaigns.update`.
- **Change:** The WhatsApp competitors reply now starts with the latest analysis of up to 4 tracked competitors (threat, prices seen, summary, first action).
- **Change (client):** New Growth, Competitors page (`/app/growth/competitors/:id`) with a card list and a detail panel with Overview, Website & offers, Compare with us, Search demand and Sources tabs.
- **Migration/API impact:** `027_competitors.sql` adds `competitors` and `competitor_reports`. New LLM purpose `competitors` (Competitor research) on Platform AI.

### 2026-10-07 (Website form link per product or project)

- **Change:** New `services/websiteFormService.js`. Public `POST /api/forms/:token` takes JSON or normal form posts, rate limited to 20 a minute per IP.
  - `flattenFields` handles plain HTML forms, Contact Form 7 and Elementor's `fields[...]` shape. It drops password, card, OTP, nonce and captcha fields.
  - `pickContact` finds the name, phone, email, city and message.
  - `attribution` decides between Google Ads (gclid, gbraid, wbraid, gad_* or google with a paid medium), Meta Ads (facebook or instagram that is not organic, or fbclid) and the website, and reads a numeric campaign id from `gad_campaignid` or `utm_id`.
  - Every entry needs a phone number. It creates a lead (project = the offering name, source Google Ads, Meta Ads or Website), or matches an existing phone and adds an activity.
  - Ad-attributed entries also get an `ad_lead_imports` row with `channel = 'website'` on the matching connection, so they show in that connection's Leads tab.
- **Change:** `POST/DELETE /api/offerings/:id/website-form` create, renew or remove the link. `POST /api/offerings` accepts `websiteForm: true`. A link is only made for an item that has a website link. Clearing the website on edit removes the link, and a link on an item without a website is not accepted.
- **Change:** The Google Ads Leads tab now reads `ad_lead_imports` like Meta does.
- **Change (client):** The Add new form has a "Create a website form link" checkbox (on by default). The list has a Website form column and a panel with a WordPress guide (WPCode footer), an HTML guide, the plugin webhook URL, and a copy-paste script. The script copies every form submit on the page to AIRO with `sendBeacon`, skips forms that have a password field, and keeps the UTM tags and click ids from the landing URL in localStorage.
- **Change:** `POST /api/offerings/:id/website-form/check` opens the item's website (public http or https only, private addresses blocked, up to 4 redirects, 3 MB page cap) and up to 8 same-site script files, and looks for the current token. The result (found, old_code, missing, unreachable or blocked) is saved in `offerings.form_check` and `form_checked_at` (migration `025_website_form_check.sql`) and cleared when the link changes.
- **Change:** Every form entry is logged in `website_form_entries` (migration `026_website_form_entries.sql`). `GET /api/offerings/:id/website-form/leads` lists them with the lead scope applied. The website form panel shows them with All, Google Ads, Meta Ads and Website (organic) tabs.
- **Migration/API impact:** `024_website_forms.sql` adds `offerings.form_token`, `form_leads` and `form_last_at`, and `ad_lead_imports.channel`.

### 2026-10-06 (AIRO score out of 100 for every Meta ad)

- **Change:** New pure module `services/adsAgent/adScore.js`.
  - `creativeScore` rates the ad itself out of 100: image or video 20, headline 20 (best at 15 to 40 characters), main text 25 (best at 60 to 300 characters; 7 of it for a price, number or offer), button 15 (5 of it for a clear action instead of "Learn more"), destination 10 (lead form, https link or chat button), and headline not repeated in the text 10. Every missing point comes with a reason.
  - `scoreAds` blends in results with `rankAds` once an ad has 1,000 impressions and half the minimum decision spend: 60% results and 40% creative. Otherwise the score is the creative score, and `basis` says so.
  - The grades are great (75 or more), good (55 or more), fair (35 or more) and weak.
- **Change:** `pullMetaAds` now reads each ad's creative in the same ads request, plus one ad-level 30-day insights call. The ad payload stores headline, text, CTA, visual, link, lead form flag, currency, spend, impressions, clicks and leads.
- **Change:** The Meta connection detail returns `adScores` keyed by ad id.
- **Change (client):** The Ads tab shows the campaign name first, then the ad (name, headline, the main reason), a score ring with its grade and basis, delivery and 30-day results. It is sorted by score, and the best one is tagged "Top ad".
- **Migration/API impact:** None. Creatives appear after the next Meta sync.

### 2026-10-06 (Campaign on/off without a full re-sync)

- **Fix:** Turning a Meta or Google campaign on or off ran a full account sync each time, and a few clicks hit Meta's "too many calls from this ad account" limit. The status endpoints now only patch the stored campaign (and, for Meta turn-on, its ad sets and ads) with `connectionRepo.setCampaignStatus`. The scheduled sync still corrects delivery later.
- **Change:** Meta rate-limit errors (codes 4, 17, 32, 613, 800xx or "too many calls") become a 429 `rate_limited` with a plain message (`isMetaRateLimit`).
- **Change (client):** Campaign rows have an on/off switch with a pending state, a confirm before turning on (shows the budget), an inline result under the row, a delivery pill, avatar initials, budget per day or lifetime, and one "Results · 30 days" cell.
- **Migration/API impact:** The status endpoints now return `{ notice }` instead of the full detail.

### 2026-10-06 (Provider tabs on the connection detail page)

- **Change (client):** `ConnectionDetail` now has page tabs picked per provider (`connectionTabs`), kept in `?section=`.
  - Meta Ads: Overview, Campaigns, Create ad, Report, Ad analysis, Lead quality, A/B tests, Account & sync.
  - Google Ads: Overview, Campaigns, Create campaign, Report, Ad analysis, Account & sync.
  - Call Yatri: Report, Calls, Follow-ups, Leads, Account & sync.
  - Other tools: Records, Webhook (only when the URL is visible), Account & sync.
  - Create tabs only show with `connections.manage`; ad analysis tabs only with `campaigns.view`.
- **Change (client):** `MetaAdsManager`, `GoogleAdsManager` and `CallYatriView` take an optional `section` prop and render only that part. They stay mounted behind a `hidden` wrapper, so a half-filled create wizard is kept when switching tabs. After a create, the page moves to Campaigns.
- **Change (client):** New `ConnectionAccount` tab: account facts, sync history (`jobs`), open and resolved errors, sync log lines, and links to the pages that use the connection. It uses fields the detail API already returned.
- **Change:** `AnalysisPanel`, `QualityPanel` and `ExperimentsPanel` accept `connectionId` and show only that account's rows; counts and totals are recalculated from those rows. Analysis items now carry `connectionId`. Scores stay ranked against all accounts of the same platform and currency.
- **Change:** Leads tab on Meta Ads and Google Ads connections. New `GET /api/connections/:id/leads` (`connections.view` and `leads.view`) in `connectionService.connectionLeads`.
  - It lists the latest 200 leads from `ad_lead_imports` for that connection, joined to `leads`, with campaign and ad names from `integration_objects`. The Leads page scope (assigned or team) is applied the same way.
  - Outcome counts (added, matched, skipped) are only returned to users with full lead scope.
  - The client has stage chips, search and an "Import leads now" button (`campaigns.update`); a row opens the lead.
  - Google Ads leads are not imported yet, so that tab says so instead of showing anything.
- **Migration/API impact:** One new read-only endpoint. No migration.

### 2026-10-06 (Ad analysis: score and rank every ad)

- **Change:** New pure module `services/adsAgent/adRanking.js` (`rankAds`, `adNumbers`, `campaignMetric`).
  - Ads are compared only with peers on the same platform, in the same currency and of the same kind. Ads in campaigns that get leads or conversions form one group; the other ads form a click group.
  - In the results group, the score is 65% cost per result and 35% click rate, both against the peer median. In the click group, it is click rate and cost per click. 50 means typical for the account.
  - The verdicts are strong (65 or more), average (40 or more), weak, "alone" (no peer with enough data) and "learning" (under 1,000 impressions or under half the minimum decision spend).
  - An ad in a results campaign that spent the minimum with zero results is marked weak. Every item carries plain reasons.
- **Change:** `GET /api/ads-agent/analysis?days=7|14|30` (`campaigns.view`) in `qualityService.analysis`.
  - Meta is judged per ad (`adWindow`), and Google per campaign, because Google ad-level data is not synced. Meta falls back to campaign level when ad rows are missing.
  - Items are flagged "made by AIRO" (from `integration_objects` with origin `api`) and show their stored status.
- **Change (client):** New "Ad analysis" tab in AI Ads Agent. It has a period switch, counts, and a table with score, verdict, spend, results, cost per result, click rate and cost per click (with typical values) and the reasons.
- **Change (WhatsApp):** New router intent `ads_analysis`, plus a regex fallback (`wantsAdsAnalysis`) for when the router is unavailable. For example, "kaun sa ad sabse achha chal raha hai" gets the top 3 and the weakest 3 ads with their score, cost per result, CTR and spend, from synced data only.
- **Migration/API impact:** None. No new API calls; it reads `ad_metrics_daily` from the existing 3-hourly sync. Lead quality from the CRM is not part of the score yet.

### 2026-10-06 (Fix: "Form Name already exists" on Meta lead ads)

- **Fix:** The Meta lead form name was the campaign name plus " form", which stays the same for a whole chat draft. A retry or a second ad with the same name was rejected by Meta. The new `leadFormName` adds a date and time stamp in UTC and keeps the name within 100 characters.
- **Fix:** Two quick messages at the creative step (for example "Done" and "Publish") both started creating the ad. Now only one creation runs per chat at a time, and the other message is told to wait. The lock is in memory, which is enough for the single pm2 process.
- **Migration/API impact:** None.

### 2026-10-06 (Sector-based types and examples on Products & Projects)

- **Change:** New `catalogFor(sector)` in `domain/sectors.js`. Each of the 15 sectors has its own item types (for example, Real Estate has Residential project, Commercial project, Plots / land, Villa, Resale, Rental, Other) and its own example text for name, details, USPs, offer, price and the location field (label and example).
- **Change:** `GET /api/offerings` returns `catalog` for the organization's sector. The add/edit form shows the sector's types and examples, and names the sector with a pointer to Settings → Organization.
- **Change:** `kind` is now free text (`[a-z_]`, up to 40 characters) instead of a fixed list. The WhatsApp LLM capture is given the sector's types, and anything outside them falls back to the sector's first type.
- **Migration/API impact:** Run `npm run migrate` (`023_offering_kind_text.sql` changes `offerings.kind` from ENUM to VARCHAR(40)). Old values (product, project, …) stay valid and are shown as plain text.

### 2026-10-06 (Products & Projects catalog and pick-from-list in the ad chat)

- **Change (panel):** New Growth page "Products & Projects" (`/app/growth/offerings`, `Offerings.jsx`). It lists everything the business sells and supports add, edit, archive and delete.
  - Each item has type, name, details, selling points (USPs), offer, price, location, website and up to 5 JPG/PNG photos (each under 2 MB).
  - A business logo can be uploaded once for the whole organization.
  - Viewing needs `campaigns.view`; changes need `campaigns.update`. Every change is audited.
- **Change (API):** New routes `GET/POST /api/offerings`, `PATCH/DELETE /api/offerings/:id`, `POST /api/offerings/:id/photos`, `GET/DELETE /api/offerings/media/:id` and `PUT /api/offerings/logo`. They are zod-validated by `offeringSchema` and `imageUploadSchema`. Images are checked by magic bytes and served only to signed-in users of the same organization.
- **Change (Meta chat):** When saved items exist, "run meta ads" starts with a WhatsApp list of them.
  - The owner taps one or more items, or types numbers, then taps Done. "Add new" asks for a new item.
  - A typed item is used for the ad, then AIRO asks "Products & Projects mein save karun?" (haan/nahi). If yes, it is saved using the LLM capture, with a fallback to the plain name.
  - The chosen items fill the product, details, website and selling points.
  - With 2-4 items, one paused campaign is created with one ad set and one ad per item. Each item has its own copy, link and design, and the daily budget is split equally (at least ₹100 per ad set is enforced).
  - Designs use the item's first saved photo as the background and put the business logo in the corner.
- **Change (Google chat):** The same list, "Add new" and save question. The chosen items go into one campaign and one ad group, with the details of every item in the facts. Per-item ad groups for Google are not built yet. Google Search ads do not use photos.
- **Change:** `createMetaAd` / `fillMetaCampaign` accept `items` (name, headline, message, link, image). `creativeSvg` accepts `logoBase64`, and there is a new `itemCreative`. Taps with ids `offer_*` go straight to the ad chat.
- **Migration/API impact:** Run `npm run migrate`. This runs `021_offerings.sql` (the table) and `022_offering_media.sql` (the `usps`/`offer` columns and the `offering_media` MEDIUMBLOB table for photos and logo). Not tested against live Meta or Google locally.

### 2026-10-06 (Audience size and radius in the ad chat)

- **Change (Meta):** After the cities are set, the chat has a new `radius` step.
  - `metaLocationSize` (`delivery_estimate` with REACH, locations plus the suggested age and gender, before interests) runs for City only, +17, +25, +40 and +80 km.
  - The step shows Meta's audience size for each option and sends a WhatsApp list ("Radius chuno") with the size in each row.
  - A tap or a typed "30 km" / "city only" sets `radius` and `radiusMode` on every city, and the area text gets "(+N km)".
  - Meta's 17-80 km limit is applied, and the owner is told when a number was adjusted.
  - The chosen area and its audience size are shown before the budget step.
- **Change (Google):** After locations are set, the chat shows the top 3 keyword ideas with Google Keyword Planner's monthly searches for those locations (the pool is reused for the copy). It says plainly that a km radius is not set from chat for Google.
- **Migration/API impact:** None. Up to 5 extra Meta estimate reads per ad at the radius step, and 1 Keyword Planner read moved earlier for Google. Not tested against live Meta or Google locally.

### 2026-10-06 (Tap-to-choose cities in the ad chat)

- **Change:** At the city step, the Meta and Google WhatsApp ad chats send a WhatsApp list ("Cities chuno") after the suggestion text. The list has Done (once something is picked), Best pick, All suggested, each suggested city with its reason, and All India.
  - Tapping a city adds it, and tapping it again ("✓ City") removes it.
  - Done uses the picked cities, and Best pick uses the model's `bestCities`.
  - Typed replies still work (ok, numbers, city names, all India). Typed cities are added to any already tapped.
- **Change:** New pure helpers `cityPick`, `cityMenu` and `bestCities` in chatPlanner, and `menuMessage` in whatsappService. Chat replies may carry `menu`, which `deliverAdChat` sends as an interactive list. The Google chat now also goes through `deliverAdChat`. A list tap with id `city_*` goes straight to the ad chat, without the intent model.
- **Change:** The list also has "Add other city" for cities that are not suggested.
  - The owner types one or more names. They are checked on Meta or Google, added to the selection, and the list comes back. Names not found are reported.
  - "remove <city>" or "<city> hatao" takes a city out.
  - Once anything is tapped, typed names are added to the selection instead of finishing the step. Done finishes it.
  - With nothing tapped, a typed list still finishes the step at once, as before.
- **Migration/API impact:** None. City names longer than 24 characters are cut in the list title by WhatsApp's limit; typing them still works.

### 2026-10-06 (Business sector at account setup)

- **Change:** New `domain/sectors.js` has 16 sectors (real estate, ecommerce, IT/SaaS, edtech, college, restaurant, hotel, healthcare, beauty/fitness, travel, automobile, finance, local services, retail store, B2B/manufacturing, other). Each has a playbook: usual goal, lead path, optional special category, interest ideas, angles, creative ideas, Google keyword patterns, negatives, KPIs and tips. `sectorFacts` turns it into prompt lines marked "general guidance, not facts".
- **Change:** `organizations.sector` column. `PATCH /api/organization` (`settings.manage`, zod enum, audit `organization.updated`) saves name, legal name, city and sector. `GET /api/settings` returns `sector` and `sectors`. `/api/auth/me` returns `organization.sector`.
- **Change (client):** An owner with `settings.manage` and no sector sees a "Set up your account" popup after login. They can choose "Do it later" for the session. Settings, Organization is now an editable form with the sector playbook. The Ads Agent profile shows the sector and prefills category and goal from it. The platform organization page shows the sector.
- **Change:** The sector is used wherever the business is described to the model:
  - `businessProfile`/`intakeFacts` add the playbook, which reaches targeting, audience pick, Meta/Google copy and competitor research.
  - The Ads Agent strategy facts include it.
  - The WhatsApp assistant facts include it.
  - The Meta chat shows the sector, uses its goal in the budget example and hint, and adds its interests as audience seeds.
  - A special category is only suggested, never forced.
- **Change:** A sector has several possible goals instead of one fixed goal (`goals: [{key, label, when}]`, most common first; keys leads, appointments, sales, awareness, traffic). The model is told the goal is chosen per campaign and never to assume leads. The Meta chat budget and goal steps list the sector's goals with when each fits, and still accept any goal.
- **Fix:** In the Meta chat, traffic and awareness without a website now ask for any https link (website, Instagram, Zomato, Maps), like sales already did. Before, the ad had an empty link.
- **Change:** The organization city is labelled "Office city". The planner gets it as "where the business sits, not automatically where buyers are". The targeting brief picks cities by where buyers are for the sector:
  - Local walk-in businesses: the outlet city.
  - Real estate: the project city plus the cities buyers move from.
  - Ecommerce, online and SaaS: metros or all India.
  - Hotel and travel: the cities travellers come from.
  - College: the places students come from.
  - B2B: trade hubs.
- **Change:** The suggestion returns `cityNotes` (a reason per city) and `bestPick`. The Meta and Google chat city steps show each city with its reason and a "Best to start" line. When the office city was left out, they add a note saying so, and the owner can still add it.
- **Change:** The first question in the Meta and Google ad chats fits the sector, using `productAsk`. Real estate asks which property (project, type, location), with property examples instead of salon/coaching. With a sector set, the Meta draft category is the sector label, and the owner's answer becomes the product.
- **Migration/API impact:** Run `npm run migrate` (020_org_sector.sql) before restarting. The login query reads `o.sector`.

### 2026-10-06 (Meta detailed targeting and plan research)

- **Change:** `searchMetaAudience` (interest) now returns Meta's `path`, `topic` and audience size bounds. New `listMetaBehaviors` (adTargetingCategory behaviors) and `metaAudienceEstimate` (`act_/delivery_estimate`: audience size plus Meta's daily reach/results curve). `targetingFor` accepts `behaviors`, and `targetingOf` returns them for the UI chips.
- **Change:** New `pickMetaAudience` (chatPlanner):
  - It searches every seed and drops other meanings ("Real Estate (band)", film, game…) and topics under 50k people.
  - The model then picks 4–8 interests and 0–3 behaviors from those real candidates (zod; ids must be in the pool) with a reason each.
  - If that fails, it falls back to the closest clean name match.
  - Seed brief now asks for buyer topics: need, platforms buyers use, lifestyle. It avoids agent, job and student topics.
- **Change:** The Meta plan shows:
  - Detailed targeting with size and reason, plus behaviours.
  - "Meta ka andaaza": audience size, and reach/results per day at the budget from Meta's curve, with a small-audience warning.
  - "AIRO ka suggestion" tips from the copy model.
- **Change:** The copy brief asks for 3 angles (need, proof/value, desire; urgency only with a real reason), and the copy model sees the chosen interests and where leads go. Long WhatsApp ad replies split into several messages (`messageParts`) instead of being cut at 4000 characters.
- **Migration/API impact:** None. Adds one extra model call and 2–3 Meta reads per plan. Not tested against a live Meta account locally (no Meta connection in the local DB).

### 2026-10-06 (Meta campaign names, objective label, editor details)

- **Change:** WhatsApp Meta campaigns are named `Product | Cities | Goal | DD Mon` (`campaignName`, saved once in the draft and shown in the plan). Ad sets and ads use the same name with "ad set" / "ad" / "ad B". A greeting or "ok" is no longer taken as the product.
- **Change:** `fillMetaCampaign` returns every ad set and ad id. The chat saves them in `connection_objects`, so the Ad sets and Ads tabs fill without a Sync.
- **Change:** Meta sync reads the ad set `destination_type`. Campaigns whose ad sets go to Messenger get `goal: 'messages'`, and the UI shows "Leads · Messenger" instead of "engagement". Meta still files Messenger lead ads under Engagement. When a campaign has no campaign-level budget, sync shows the total of its ad set daily budgets.
- **Change (client):** The campaign editor shows details next to the form. For the campaign: status, objective, budget, schedule. For an ad set: budget, goal, destination, age, gender, Advantage+, cities, interests. For an ad: the full ad preview with image, text, headline and button.
- **Migration/API impact:** None. Old campaigns keep their names; rename them from the editor.

### 2026-10-06 (Meta design approval and age fix)

- **Fix:** In the Meta image step, design approval now matches anywhere in the message ("Save kro", "Inhi design ko rakho", "yahi final hai", "publish kro"), unless it also has a no/change word or a question mark. Before, only a message starting with "design"/"ok" worked, so the same question repeated.
- **Fix:** A forwarded image at the image step (WhatsApp `context.forwarded`) is taken as "use the AIRO designs". It no longer draws a design on top of the forwarded design. To use their own photo, owners send it from the camera or gallery.
- **Fix:** `targetingFor` with Advantage+ audience caps `age_min` at 25 and leaves out `age_max`. This matches Meta's rule that caused "add a higher minimum age as a suggestion". The plan shows the real age sent, plus the model's best-fit range as a note.
- **Note:** If the message asks to publish, the ad is still created paused and the reply asks for one more "haan" before spending.
- **Migration/API impact:** None.

### 2026-10-06 (Meta chat budget fix)

- **Fix:** At the Meta image step, a message like "budget 590" now updates the draft's daily budget. Before, it was ignored and the next photo still used the old, too-small budget.
- **Fix:** New `budgetAmount` reads the first amount only and understands `5k`, `1.5k`, `Rs.500` and `1,200`. The old parser joined every digit in the message, and could also turn "Rs.500" into 0.5.
- **Change:** When Meta rejects a campaign or ad for its budget, the reply adds "reply budget 600 to change it".
- **Change:** `budgetAmount` also reads `lakh`/`lac`. A monthly budget ("30k per month", "mahina") is divided by 30. A daily budget under ₹100 is refused at intake and at the image step, unless it is written in dollars.
- **Migration/API impact:** None.

### 2026-10-06 (Meta ad template creatives)

- **Change:** New `services/adsAgent/adCreative.js` draws a 1080×1080 ad image from SVG with Resvg and the bundled Inter fonts. It includes the business name, headline, up to 3 selling points, a CTA button and the website host. There are 3 colour themes; with an owner photo, the photo becomes the background under a dark overlay. Output stays under 2.4 MB (it falls back to a smaller width). No AI-generated photos.
- **Change:** The WhatsApp Meta plan now sends one design image per variant before the plan text. In the image step:
  - `design`/`ok` creates the paused ad with these designs (variant 1 image on ad A, variant 2 image on test ad B).
  - A photo is rendered into both designs as the background.
  - `original` makes the next photo go in as-is.
  - `skip` is unchanged.
- **Change:** `createMetaAd` accepts `imageBase64B`, which is uploaded as a second image hash and used for creative B. Without it, B reuses the main image as before. `deliverWhatsappImage` takes a `tag` for the saved outbound label.
- **Migration/API impact:** None. No new dependency (`@resvg/resvg-js` was already used for report cards).

### 2026-10-06 (WhatsApp AI router)

- **Change:** New `services/whatsappIntent.js`. For registered numbers (text messages, not photos), `classifyMessage` sends the last 8 chat lines plus the open ad draft step to `structuredLlm` (zod schema, purposes `assistant → whatsapp → ads`, 9 s timeout). It returns `{intent, request, platform, topic}`. Intents: `ad_setup_answer`, `start_google_ad`, `start_meta_ad`, `cancel_ad_setup`, `competitors`, `campaign_list`, `ads_report`, `ads_advice`, `call_report`, `crm_report`, `greeting`, `other`.
- **Change (same day):** `whatsappService.routeByIntent` sends each intent to the existing handlers. Draft handlers get `force` (skip the regex fall-through). Starts go to only that platform. Report intents replace the latest line with `"<standalone request> | <original>"` so the existing card parsers read the right period or person. `replyWhatsapp({ intent })` only runs the matching card: `whatsappReportCard(..., { only: 'ads'|'call' })` and `adsAdviceReply(..., { force })`. The model never writes figures; data still comes from the cards and report facts.
- **Fallback:** If the router fails or times out, the earlier regex flow runs unchanged.
- **Migration/API impact:** None. Adds one small model call per inbound WhatsApp text (about 2-4 s with a lite model).

### 2026-10-06 (WhatsApp routing fixes)

- **Fix:** A Google or Meta draft waiting for approval no longer answers every message with "reply haan or nahi". Any other message falls through to the normal assistant and the draft stays. Google intake steps also release report/call/"kitne" questions.
- **Fix:** `reportRequest` (whatsappReport.js) stops at a newer ads/campaign/competitor message without call or lead words. "Kya hua" after an ads question no longer re-runs an old Call Yatri report with "Google Ads" as a lead source filter.
- **Change:** New `services/adsAgent/campaignCount.js` answers "how many campaigns" from the live accounts (`googleCampaignList`, `metaCampaignList`): total, active, paused and up to 10 names per platform. It runs in `whatsappService` before the draft handlers.
- **Change:** WhatsApp model facts now include the current IST date and time. Competitor research shows Google's real Keyword Planner error instead of "no data".
- **Migration/API impact:** None.

### 2026-10-06 (WhatsApp message design)

- **Change:** New `services/adsAgent/waFormat.js` with WhatsApp formatting helpers: `header`, `section`, `bullets`, `numbered`, `field`, `options` (quote block), `hint` (italic), `step` ("Step 2/5"), `money` (₹ for INR) and `LINE`. Google and Meta chat prompts, region suggestions, plans, saved/paused/live messages and competitor research now use one card layout. The text and flow logic are unchanged. Meta fallback copy uses the same plan layout.

### 2026-10-06 (WhatsApp competitor research)

- **Change:** New `services/adsAgent/competitorResearch.js`. In `whatsappService.answerWithModel`, an owner message about competitors (competitor, competition, rival, ad library) is answered before the Google and Meta draft handlers, so it also works while a draft waits for approval. The draft is not changed.
- **Change (same day):** Meta: new `adLibrarySearch` (integrations/metaAds.js) reads up to 50 active ads for the topic, with page, headline, text, description, platforms and start date. The reply shows advertiser count, ads per advertiser, oldest running ad, platform share and 3 sample ads. For India the Meta API only returns social issue, election and politics ads, so normal business ads usually come back empty. The reply then says so and gives the Ad Library link.
- **Change (same day):** Google: Keyword Planner competition (HIGH/MEDIUM count, monthly searches, top-of-page bid range). Google exposes no API for competitor advertisers or ad copy, so the reply links the Ads Transparency Center, using a domain link for competitors in the business profile. No Google-to-Meta advertiser ratio is shown because neither number is available honestly.
- **Migration/API impact:** None.

### 2026-10-06 (WhatsApp ad chat planner)

- **Change:** New `services/adsAgent/chatPlanner.js`, used by `googleAdChat.js` and `metaAdChat.js`. The facts now include the saved business profile plus a new optional `details` step (price, offer, USPs). That step is skipped when the profile already has selling points, an offering or prices.
- **Change (same day):** `suggestTargeting` (zod-validated LLM output) suggests 1-6 cities, age and gender, Meta interest seeds, Google keyword seeds, negatives and selling points taken from the facts only. The region step shows numbered cities. The owner can reply ok, numbers like 1,2, or their own cities. The cities are resolved on Meta (`searchMetaAudience`) or Google (`suggestGoogleLocations`), and anything not found is reported.
- **Change (same day):** Google plans use Keyword Planner ideas from the seeds, product, cities and website, ranked by monthly searches. `writeGoogleCopy` returns 10-15 unique headlines, 3-4 descriptions, path1/path2, keywords (only from those ideas, with EXACT and PHRASE match) and negatives. Negatives and paths are now sent to `createGoogleSearchCampaign`, and `negatives:` edits are supported.
- **Change (same day):** Meta interests come from AI seeds checked with Meta search (up to 6). Age and gender come from the suggestion only when there is no special category. `writeMetaCopy` writes 2-3 angle variants. Variants 1 and 2 are created as an A/B test in the same ad set (`creativeTest`), and `use 3` swaps a variant in.
- **Fallback:** If the model fails, the old copy writers (`writeGoogleAdPlan`, `writeAdPlan`) and the first-15 keyword ideas are used. Older drafts keep working (`region_pick`).
- **Migration/API impact:** None.

### 2026-10-06 (AI Ads Agent, phase 7)

- **Change:** Experiments and scaling. Migration `019_ad_level_metrics.sql` adds `campaign_external_id` and `adset_external_id` to `ad_metrics_daily`. The Meta sync also saves ad-level daily rows (`metaAdDailyStats`, own paging up to about 5,500 rows, saved in chunks of 500). Every campaign query still filters `level = 'campaign'`.
- **Change (same day):** `experimentGroups` (monitorRules.js) compares ads running in the same ad set over 14 days, using a two-proportion z-test on leads per impression (10+ leads) or click rate. A winner needs at least 1,000 impressions, half the minimum spend and 3 days per ad, at least 20% lift, and z ≥ 1.96. The weaker ad becomes an `experiment_winner` decision (ad level, pause). Applying it uses `editMetaItem(..., 'ad', id, { status: 'PAUSED' })`, which checks that the ad belongs to the account.
- **Change (same day):** `scaleFindings` produces a `scale_winner` budget increase (at most 20%, never above the percent limit) for a campaign whose 7-day cost per result is ≤60% of the account average for the same platform and currency. It needs 10+ results, a steady last 3 days and no other flag in the same run. It is skipped when the profile has a target cost (the target rule covers that case) or when tracked lead quality is under 15% qualified.
- **Change (same day):** Repeat check: budget decisions (`budget_increase|budget_decrease|scale_winner`) share one 72h window per campaign, and `applied` now counts, so Auto mode cannot stack budget changes every run. Route `GET /api/ads-agent/experiments` (`campaigns.view`). UI: A/B tests tab, plus the new types in the Decision log with Approve & apply.
- **Migration/API impact:** Run `npm run migrate` (019). Client rebuild needed.

### 2026-10-06 (AI Ads Agent, phase 6)

- **Change:** Lead quality and revenue attribution. Migration `018_ad_leads.sql` adds `leads.deal_value_inr` and `ad_lead_imports` (one row per Meta lead id: lead, campaign, ad and form ids, outcome `created|matched|skipped`, submitted time).
- **Change (same day):** `metaFormLeads` (integrations/metaAds.js) finds lead form ads and reads their leads since a time, falling back to the Page token. `services/adsAgent/leadImport.js` is a new `ads.lead_import` job (every 30 min; 30 days on the first run, then 3).
  - A phone that already exists in Leads (last 10 digits) gets an activity instead of a duplicate lead.
  - Leads without a phone are skipped.
  - New leads get the "Meta Lead Ads" source and a `campaigns` row (`meta:<campaign id>`).
  - Phones and names are never written to audit or job summaries.
- **Change (same day):** `GET /api/ads-agent/quality?days=` (`campaigns.view`) joins synced spend with CRM outcomes of the leads each campaign's form created (first touch). It returns leads, qualified (qualified/site visit/negotiation/booked), booked, revenue (deal value of booked leads), cost per lead, per qualified lead and per booking, and ROAS (INR campaigns only). `POST /api/ads-agent/leads/import` (`campaigns.update`, 5-min cooldown, audited).
- **Change (same day):** A new monitor rule `low_quality` (≥10 CRM leads in 14 days, ≤10% qualified, at least half unqualified or lost; no action). The lead update schema accepts `dealValueInr`, and the lead detail page shows a deal value box when the status is booked; changes are logged as lead activity. The AI Ads Agent page has a Lead quality tab (`pages/AdsQuality.jsx`). Google Ads leads are not linked yet.
- **Migration/API impact:** Run `npm run migrate` (018). Client rebuild needed.

### 2026-10-06 (AI Ads Agent, phase 5)

- **Change:** Approve and Auto modes apply pause and budget recommendations on the live ad account. `services/adsAgent/applyService.js` claims the decision atomically (`proposed|blocked → approved`, so it can't be applied twice) and reads the current budget from the API. Meta uses `metaCampaignBudgets`: the campaign daily budget, or the daily budgets of active ad sets; lifetime budgets are refused. Google uses `googleCampaignBudget`; shared budgets are refused. The guardrail is re-checked with the real totals, and then `setMetaCampaignStatus` / `setMetaDailyBudget` / `setGoogleCampaignStatus` / `editGoogleCampaign` make the change. The result is `applied` (with before/after budgets in `outcome`), `blocked` (with reasons) or `failed` (with the error), and every result is audited.
- **Change (same day):** In Auto mode the monitor applies at most one action per campaign per run, only when the guardrail allows it. Raising a budget on its own also needs a daily or monthly spend cap. Budget amounts round toward the current value so a change never passes the percent limit. The daily action limit now counts only agent actions (pause/budget), not owner launches.
- **Change (same day):** Route `POST /api/ads-agent/decisions/:id/apply` (`campaigns.update` + `connections.manage`; returns 422 in Off or Recommend mode). UI: "Approve & apply" with a confirm dialog on open pause and budget recommendations, plus the applied result or error in the Decision log.
- **Migration/API impact:** No migration. Client rebuild needed.

### 2026-10-06 (AI Ads Agent, phase 4)

- **Change:** Monitoring and recommendations, recommend only (nothing changes on ad accounts). `services/adsAgent/monitorRules.js` holds pure rules over synced daily campaign rows. It compares the last 3 full days with the 7 before them and covers: pause (spend ≥ minimum with 0 results after earlier results), no results recorded (a note only, because Meta reports 0 leads for non-lead campaigns), cost per result up ≥50%, click rate down ≥40%, above or well under the profile's target cost (same currency only), and monthly pacing vs the spend cap or profile budget. Every finding stores its evidence.
- **Change (same day):** `services/adsAgent/monitorService.js` writes findings to `ai_decisions` with a guardrail check (`proposed` or `blocked`) and skips repeats of the same type and campaign within 72h. Budget suggestions are checked by percent and caps only, because current budgets are not synced. A new `ads.monitor` job runs every 6 hours. Routes: `POST /api/ads-agent/monitor` (run now, 2-min cooldown) and `POST /api/ads-agent/decisions/:id/dismiss` (proposed/blocked → rejected), both need `campaigns.update` and are audited.
- **Change (same day):** In WhatsApp, recognized business numbers asking for ads recommendations or suggestions get the open recommendations (rules text, no LLM). Nothing is pushed. UI: Decision log has Check now, type labels and Dismiss.
- **Migration/API impact:** No migration. Client rebuild needed.

### 2026-10-06 (AI Ads Agent, phase 3)

- **Change:** Creatives and launch from the approved strategy. Migration `017_ad_launches.sql` (`ad_launches`: `draft → created → published`, or `cancelled`; creative JSON, settings JSON, external campaign id, error, who created/published). `services/adsAgent/launchService.js`: the model writes platform copy (`metaCreativeSchema`: 2–3 variants, headline ≤40, text ≤300; `googleCreativeSchema`: 8–15 unique headlines ≤30, 2–4 descriptions ≤90); Meta cities and interests and Google locations are looked up through the real APIs (`searchMetaAudience`, `suggestGoogleLocations`), and anything not found is listed as a note, never guessed; the daily budget comes from the strategy budget plan.
- **Change (same day):** "Create as paused" reuses `createMetaAd` (publish false, variant B as a second ad) and `createGoogleSearchCampaign` (publish false). Meta needs a Page, an https link and an image sent with the request (the image is not stored). Special ad category defaults to none and is chosen by the owner; with a category, age and interests are dropped and cities use a 25 km radius. "Publish" uses `setMetaCampaignStatus` / `setGoogleCampaignStatus` after `checkLaunch` (kill switch, daily budget vs daily cap, today's and this month's synced spend vs caps; agent mode does not apply to owner actions). Create, publish, failures and blocks are written to `ai_decisions` and audit logs.
- **Change (same day):** Routes `GET/POST /api/ads-agent/launches`, `PATCH /api/ads-agent/launches/:id`, `POST .../:id/cancel` (`campaigns.update`), `POST .../:id/create` and `.../:id/publish` (`campaigns.update` + `connections.manage`). UI: Launch tab (`pages/AdsLaunch.jsx`) with Meta and Google ad previews, editable copy, budget, link, Page, special category, keywords, and a confirm dialog before publishing.
- **Migration/API impact:** Run `npm run migrate` (017). Client rebuild needed.

### 2026-10-06 (AI Ads Agent, phase 2)

- **Change:** Business profile and AI strategy. Migration `016_ads_strategy.sql`: `business_profiles` (one JSON profile per organization) and `ad_strategies` (versioned; `draft|approved|archived`; stores the profile and 30-day metrics snapshot used, the strategy JSON, and the model). Shared zod schemas in `domain/adsAgent.js`: `businessProfileSchema`, `strategySchemaFor(profile)` (only the profile's platforms, budget shares add up to 100, Google keywords only when Google is used, length limits on headlines and texts), `budgetPlan` (amounts come from the profile's monthly budget, never from the model).
- **Change (same day):** `services/adsAgent/strategyService.js` builds the strategy with `structuredLlm` from the profile plus synced `ad_metrics_daily` results; the prompt forbids invented numbers, claims, and money amounts. One generation per minute per organization. Approving archives the previous approved version. Nothing is created on an ad account.
- **Change (same day):** Routes (all audited where they write): `GET/PUT /api/ads-agent/profile`, `GET/POST /api/ads-agent/strategies`, `POST /api/ads-agent/strategies/:id/approve|archive`. View needs `campaigns.view`, writes need `campaigns.update`. `replyLlm` accepts `maxTokens` and `maxChars` (structured output uses 4096 tokens; Anthropic was capped at 1024). UI: AI Ads Agent page has Performance / Business profile / Strategy tabs (`pages/AdsStrategy.jsx`).
- **Migration/API impact:** Run `npm run migrate` (016). Client rebuild needed.

### 2026-10-05 (AI Ads Agent, phases 0–1)

- **Change:** AI Ads Agent foundation and read-only metrics sync. Migration `015_ads_agent.sql`: `ads_agent_settings` (mode `off|recommend|approve|auto`, default `recommend`; daily/monthly spend caps, max budget change %, max actions per day, min spend before judging, kill switch), `ad_metrics_daily` (campaign-level daily spend/impressions/clicks per connection; Meta `leads` from insight actions, Google `conversions`; currency as the ad account reports it), `ai_decisions` (decision log with evidence, proposed change, guardrail result, status), `agent_jobs` (DB lock so one job run at a time).
- **Change (same day):** `services/adsAgent/`: `guardrails.js` (pure `checkAction`; pausing is never blocked by caps, anything that can raise spend is), `metricsSync.js` (all live verified Meta/Google connections; first sync pulls 30 days, then 7), `jobs.js` (in-process scheduler, checks every 10 minutes, metrics sync every 3 hours, started from `server.js`), `agentService.js` (overview, settings, manual sync with a 5-minute cooldown, `recordDecision`). New integration functions `metaDailyStats` and `googleDailyStats`. `llmService.structuredLlm` returns zod-validated JSON from the ad-writing model (one corrective retry per model, then the next model); `utils/modelJson.js` reads JSON from model replies.
- **Change (same day):** Routes `GET /api/ads-agent?days=7|14|30` (`campaigns.view`), `PUT /api/ads-agent/settings` and `POST /api/ads-agent/sync` (`campaigns.update`, audited). Only the Owner can choose `auto`. UI: `pages/AdsAgent.jsx` at `/app/growth/ads-agent` ("AI Ads Agent" under Growth): per-platform totals, daily spend, campaign table, guardrails form, decision log. No action changes an ad account yet.
- **Change (same day):** `npm test` also runs `src/tests/adsAgent.test.js`; `npm run test:unit` runs only the DB-free unit tests.
- **Affected areas:** `metaAds.js`, `googleAds.js`, `llmService.js`, `routes/index.js`, `schemas.js`, `server.js`, `adsAgentRepo.js`, `App.jsx`, `shell.jsx`.
- **Migration/API impact:** Run `npm run migrate` (015). Client rebuild needed.

### 2026-10-05

- **Change:** Nexcall is shown as **Call Yatri** everywhere users see it (provider name, WhatsApp report lines, LLM prompt, errors). The provider key, routes, and function names stay `nexcall`. The Call Yatri connection page (`CallYatriView` in `Connections.jsx`) shows sync status with skipped parts, the 7-day call report tiles, team performance, and Calls / Follow-ups / Leads tabs.
- **Change (same day):** `pullNexcall` uses `Promise.allSettled`: one failing endpoint no longer fails the sync; skipped parts are logged as warnings. The call report is stored as a `report` object (`last_7_days`, employee emails dropped) and returned as `callReport` on connection detail.
- **Change (same day):** Call Yatri report charts. New `GET /api/connections/:id/call-yatri/stats?day=YYYY-MM-DD` (`connections.view`) calls the Call Yatri report API once per IST day (last 7) and once per hour of the chosen day, cached in memory for 10 minutes. The page shows day-wise, hour-wise, status-wise, direction, and team-wise charts (plain SVG/CSS, no chart library) before the tables.
- **Change (same day):** Team head-wise Call Yatri report. The Call Yatri external API has no teams or heads (checked: no endpoint, report ignores team filters), so heads and members are set in AIRO. Migration `012_call_team_heads.sql` (`call_team_heads`, `call_team_members`; one team per employee, head counted in own team). `GET/PUT /api/connections/:id/call-yatri/teams` (view/manage). UI: `TeamHeadReport` + `TeamHeadEditor` in `Connections.jsx`. Switch to API data if Call Yatri adds team heads.
- **Change (same day):** Call Yatri data is no longer stored. Calls / Follow-ups / Leads tabs read live from new `GET /api/connections/:id/call-yatri/records?kind=calls|followups|leads&day=YYYY-MM-DD|week` (first 100 rows, employee emails dropped). Sync only checks the API, clears the stats cache, and deletes any stored Call Yatri objects; it no longer saves rows or `callReport`. The Call Yatri webhook is rejected. WhatsApp reports no longer look up stored calls. Migration `013_call_yatri_live_only.sql` deletes existing Call Yatri rows from `integration_objects`.
- **Change (same day):** Meta Ads and Google Ads pages redesigned (`AdsHeader`, `AdsPerformance`, `TrendChart`, `Donut`, `FunnelSteps`, `AudienceBars` in `Connections.jsx`; plain SVG/CSS). New `GET /api/connections/:id/meta/report?range=LAST_7_DAYS|LAST_14_DAYS|LAST_30_DAYS|THIS_MONTH|LAST_MONTH` (`connections.view`, `metaReport` in `metaAds.js`): daily account insights, campaigns, publisher-platform and age/gender breakdowns, read live, not stored. `googleReport` also returns `devices` (spend by device). The Google report now loads on page open, not only on the Report tab.
- **Change (same day):** Full editing from the campaign drawer. New `POST /api/connections/:id/meta/items/:kind/:itemId` (`campaign|adset|ad`, `editMetaItem`) and `POST /api/connections/:id/google/items/:kind/:itemId` (`campaign|ad_group|keyword|keywords|ad`, `editGoogleItem`), both `connections.manage`, schema `adEditBody`, audited, then synced. Meta: campaign name/status/budget; ad set name/status/budget/end date/age/gender/cities/interests (other targeting kept); ad name/status, and headline/text/link/button by making a new creative from the existing `object_story_spec` (dynamic/catalog creatives stay name/status only). Google: campaign name/status/budget/end date/bidding/locations; ad group name/status/max CPC; keyword pause/enable/remove and add keywords; ad status and responsive search ad headlines/descriptions/final URL/paths. Meta items are checked against the linked ad account. Google detail now lists all keywords (not only ones with stats) and campaign locations. UI: `EditForm`, `SearchPicker` in `Connections.jsx`. All edits open one editor in the drawer (like Ads Manager): a tree on the left (campaign, ad sets / ad groups, keywords, ads with status dots) and the form for the chosen item on the right; the table "Edit" button opens it too. The old name/budget-only edit form on the Meta and Google pages was removed.
- **Change (same day):** A business can connect more than one Meta Ads or Google Ads account. Migration `014_multi_ad_accounts.sql` drops `uq_org_provider` (one connection per provider per organization) and adds a plain index; other providers still use one connection. OAuth start takes `target` (`'new'` adds an account, a connection id changes that account); the callback returns `connection=<id>` and the picker/choose endpoints take that id. An ad account already linked to another connection is marked `taken` and cannot be chosen twice; changing a connection to a different account clears its stored objects. Manual Meta tokens update the connection with the same account id or add a new one. `index` returns `multiAccount` + `accounts` per provider; detail returns `accounts` for the account switcher (`AdAccountBar`). WhatsApp Meta/Google ad chats use the first connected live account.
- **Change (same day):** Campaign detail drawer. Clicking a campaign, ad set, ad group, keyword, or ad row (or a bar in "Top campaigns") opens `CampaignDrawer` in `Connections.jsx`: campaign facts, KPI cards, daily chart, ad creative previews with per-ad stats, Meta ad sets with targeting, Google ad groups and keywords. New `GET /api/connections/:id/meta/campaigns/:campaignId?range=` (`metaCampaignDetail`, checks the campaign belongs to the linked ad account) and `GET /api/connections/:id/google/campaigns/:campaignId?range=` (`googleCampaignDetail`), both `connections.view`, read live, not stored. Schema `campaignParams`.
- **Change (same day):** WhatsApp report images. Reports are now sent as a PNG chart image with a short caption and up to 3 reply buttons (WhatsApp interactive message with an image header). New dependency `@resvg/resvg-js` (SVG to PNG, prebuilt binaries, no system libraries) and bundled Inter fonts in `server/assets/fonts` (OFL, includes ₹). `reportImage.js` draws the header, KPI tiles, bar + line chart, donut, table, ranked bars, and insight boxes. `adsReportCard.js` answers ads questions ("ads report", "campaign wise", "7 day chart", aaj/kal/14/30 days/this or last month) with live Meta Ads + Google Ads data (Google conversions count as leads), compared with the previous period for today, yesterday, 7 and 14 days; nothing is stored. Call reports and "best time to call" get images too (`whatsappCards.js`). Tapping a button sends its title as the next message (`interactive.button_reply` is now read on the webhook). If the image upload or send fails, the text card is sent instead. `metaReport` and `googleReport` accept `TODAY` and `YESTERDAY`. A plain call report is now a compact "Daily Call Report" image (total, answered, not picked, missed, average call time, each with change vs yesterday at the same time or the previous period, plus a key insight); "Detailed call report", "Agent wise report" (table of agents), "Missed calls" (unanswered by agent), and "Weekly call report" (last 7 days) are separate images. With more than 3 options, the image is sent first and the options follow as a WhatsApp list message ("More reports").
- **Change (same day):** WhatsApp call report card. When the latest WhatsApp message from a recognized business asks for a call report, `replyWhatsapp` sends a fixed-format card from `callReportCard.js` before any LLM: summary, outcome and incoming/outgoing bars, day-by-day chart (2–14 day windows), top callers with medals, best connect rate, and "needs attention" (under 35% connected, or no calls). It also handles `<name> ka report` (one caller vs team average) and `<head> team ka report` (AIRO team heads). Charts are Unicode text bars in WhatsApp monospace blocks (no image library). The data is read live from Call Yatri and not stored; employee emails are dropped. Follow-up, lead and ads questions, messages with phone numbers, and any card error fall back to the LLM reply. Time questions ("kis time / kitne baje / timing") get a "Best time to call" card instead: connected calls and pick-up rate per IST hour (today, yesterday, or by default the last 3 full days), most connected hour, best pick-up hour, peak 3 hours, lowest pick-up hour. It makes one Call Yatri report call per hour (about 20 seconds for 3 days); past hours are cached in memory for 6 hours. "Why / how / improve / compare" questions without a time word go to the LLM.
- **Change (same day):** "Remember me" on the login page. Migration `011_refresh_remember.sql` adds `refresh_tokens.remember`; unchecked logins get a session cookie and a 1-day refresh token.
- **Affected areas:** `nexcall.js`, `metaAds.js`, `googleAds.js`, `routes/index.js`, `connectionService`, `providers.js`, `migrate.js`, `whatsappReport.js`, `callReportCard.js`, `llmService.js`, `llm.js`, `authService`, `authRepo`, `cookies.js`, `schemas.js`, `Login.jsx`, `auth.jsx`, `Connections.jsx`, `styles.css`.
- **Migration/API impact:** Run `npm install` (new `@resvg/resvg-js`), then `npm run migrate` (011, 012, 013, 014 + provider rename). Client rebuild needed.

### 2026-10-03

- **Change:** Live Google Ads integration: `server/src/integrations/googleAds.js`, Google OAuth connect + account picker, sync, Search campaign create/edit/status, keyword ideas, live report. New env names `GOOGLE_ADS_DEVELOPER_TOKEN`, `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_REDIRECT_URI`, `GOOGLE_ADS_API_VERSION`. `liveRecord` now also returns `parent`.
- **Change (same day):** "Connect with Facebook" for Meta Ads (Facebook Login, account picker), sharing the OAuth helpers with Google. New env names `META_APP_ID`, `META_APP_SECRET`, `META_LOGIN_CONFIG_ID`, `META_OAUTH_REDIRECT_URI`. Connection detail returns `tokenExpiresAt`. Added `npm run check:logins` (`server/src/scripts/checkLogins.js`).
- **Fix (same day):** WhatsApp Meta ad chat (`metaAdChat.js`): an open draft no longer captures "run Google/LinkedIn ads" messages (they get a "not from WhatsApp yet" reply), drafts idle for 24 hours are dropped, and skipping the photo ends the draft at `done` instead of asking to skip again.
- **Change (same day):** Added `npm run create:reviewer -- --email <email> [--org <name>]` (`server/src/scripts/createReviewer.js`): creates an empty client organization with an owner login and prints a one-time random password, for Meta/Google app reviewers. No email is sent by AIRO, so invited users cannot set a password in production.
- **Change (2026-10-05):** WhatsApp Google Ads flow (`googleAdChat.js`, migration `010_google_ad_drafts.sql`, `llmService.writeGoogleAdPlan`): "run google ads" → product, website, location, budget → Google keyword ideas + model-written headlines/descriptions → owner approves or sends an idea/edits → Search campaign saved PAUSED → "haan" publishes. Starting a Google draft closes an open Meta draft and vice versa. Meta chat now answers greetings during an open draft instead of re-asking for the photo. `listMetaAdAccounts` retries without `business{name}` and names missing scopes.
- **Reason:** Manage, create, and report on Google Ads from AIRO, and let many businesses connect Google and Meta without pasting tokens.
- **Affected areas:** `connectionService`, `connectionRepo.setAccountLabel`, routes, schemas, `env.js`, `Connections.jsx`, `styles.css`.
- **Migration/API impact:** No migration. New endpoints under `/api/connections/google/*`, `/api/connections/:id/google/*`, and public `/api/google-ads/callback`. Client rebuild needed.

### 2026-10-02

- **Change:** Added the AI context system: `AI.md`, `.ai/PROJECT.md`, `.ai/ARCHITECTURE.md`, `.ai/FILE_STRUCTURE.md` (generated), `.ai/API.md`, `.ai/DATABASE.md`, `.ai/RULES.md`, `.ai/CHANGELOG.md`, and `scripts/generate-ai-context.cjs`. Added `"ai:context"` script to root `package.json`.
- **Reason:** Give AI coding assistants an accurate, discovered map of the project and its rules.
- **Affected areas:** Documentation and tooling only. No application code changed by this entry.
- **Migration/API impact:** None.
