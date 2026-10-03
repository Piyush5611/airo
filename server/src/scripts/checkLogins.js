import { env } from '../config/env.js';
import { metaLoginSetup } from '../integrations/metaAds.js';
import { googleSetup } from '../integrations/googleAds.js';

const lines = [];
const ok = (text) => lines.push(`  OK    ${text}`);
const bad = (text) => lines.push(`  FIX   ${text}`);
const tip = (text) => lines.push(`        ${text}`);

async function checkMeta() {
  lines.push('', 'Meta (Connect with Facebook)');
  const { appId, appSecret, configId } = env.metaLogin;
  const setup = metaLoginSetup();
  if (!appId) bad('META_APP_ID is empty. Copy App ID from Meta app → App settings → Basic.');
  if (!appSecret) bad('META_APP_SECRET is empty. Copy App secret from Meta app → App settings → Basic.');
  if (appId && appSecret) {
    try {
      const url = new URL(`https://graph.facebook.com/v21.0/${encodeURIComponent(appId)}`);
      url.searchParams.set('fields', 'id,name');
      url.searchParams.set('access_token', `${appId}|${appSecret}`);
      const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
      const data = await response.json().catch(() => ({}));
      if (response.ok && data.id) ok(`App id and secret work. App name: ${data.name || data.id}.`);
      else bad('Meta rejected META_APP_ID / META_APP_SECRET. Copy both again from the same app.');
    } catch {
      bad('Meta did not respond. Check the server internet connection.');
    }
  }
  if (configId) ok(`META_LOGIN_CONFIG_ID is set (${configId}). Clients get a token that does not expire.`);
  else {
    bad('META_LOGIN_CONFIG_ID is empty. Login still works, but tokens expire in about 60 days.');
    tip('Create it once: Facebook Login for Business → Configurations → Create → System-user access token.');
  }
  tip(`Valid OAuth Redirect URI to add in Meta: ${setup.redirectUri}`);
}

function checkGoogle() {
  lines.push('', 'Google Ads (Connect with Google)');
  const { developerToken, clientId, clientSecret } = env.googleAds;
  const setup = googleSetup();
  if (developerToken) ok('GOOGLE_ADS_DEVELOPER_TOKEN is set.');
  else bad('GOOGLE_ADS_DEVELOPER_TOKEN is empty. Google Ads manager account → Admin → API Center.');
  if (!clientId) bad('GOOGLE_OAUTH_CLIENT_ID is empty. Google Cloud → Credentials → OAuth client (Web application).');
  else if (!clientId.endsWith('.apps.googleusercontent.com')) bad('GOOGLE_OAUTH_CLIENT_ID does not look like a Google client id.');
  else ok('GOOGLE_OAUTH_CLIENT_ID looks right.');
  if (clientSecret) ok('GOOGLE_OAUTH_CLIENT_SECRET is set.');
  else bad('GOOGLE_OAUTH_CLIENT_SECRET is empty.');
  tip(`Authorized redirect URI to add in Google Cloud: ${setup.redirectUri}`);
}

await checkMeta();
checkGoogle();
lines.push('', lines.some((line) => line.includes('FIX')) ? 'Fix the FIX lines, then run this again and restart the server.' : 'Everything needed is set. Restart the server if you changed .env.');
console.log(lines.join('\n'));
process.exit(0);
