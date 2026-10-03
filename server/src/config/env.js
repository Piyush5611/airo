import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
dotenv.config({ path: path.join(root, '.env') });

function read(name, fallback = undefined) {
  const value = process.env[name];
  if (value === undefined || value === '') return fallback;
  return value;
}

const nodeEnv = read('NODE_ENV', 'development');

function required(name) {
  const value = read(name);
  if (!value) {
    throw new Error(
      `Missing ${name}. Copy .env.example to .env and set the MySQL and JWT values.`
    );
  }
  return value;
}

const dbName = required('DB_NAME');
if (!/^[A-Za-z0-9_]+$/.test(dbName)) {
  throw new Error('DB_NAME may contain only letters, numbers, and underscores.');
}

export const env = {
  nodeEnv,
  isProd: nodeEnv === 'production',
  port: Number(read('PORT', 4000)),
  clientOrigin: read('CLIENT_ORIGIN', 'http://localhost:5173'),
  jwtSecret: required('JWT_SECRET'),
  jwtRefreshSecret: required('JWT_REFRESH_SECRET'),
  credentialsKey: read('CREDENTIALS_KEY', ''),
  whatsappVerifyToken: read('WHATSAPP_VERIFY_TOKEN', ''),
  metaVerifyToken: read('META_VERIFY_TOKEN', ''),
  googleAds: {
    developerToken: read('GOOGLE_ADS_DEVELOPER_TOKEN', ''),
    clientId: read('GOOGLE_OAUTH_CLIENT_ID', ''),
    clientSecret: read('GOOGLE_OAUTH_CLIENT_SECRET', ''),
    redirectUri: read('GOOGLE_OAUTH_REDIRECT_URI', ''),
    version: read('GOOGLE_ADS_API_VERSION', 'v25')
  },
  seedPassword: read('SEED_PASSWORD', 'AiroDemo#2026'),
  db: {
    host: required('DB_HOST'),
    port: Number(read('DB_PORT', 3306)),
    name: dbName,
    user: required('DB_USER'),
    password: read('DB_PASSWORD', '')
  }
};
