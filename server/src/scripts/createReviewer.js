import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { pool } from '../config/db.js';

const DEFAULT_ORG = 'Meta Review Demo';

function arg(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index > -1 ? String(process.argv[index + 1] || '').trim() : '';
}

function slugify(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'review-demo';
}

function newPassword() {
  return `${randomBytes(12).toString('base64url')}A9!`;
}

async function main() {
  const email = arg('email').toLowerCase();
  const orgName = arg('org') || DEFAULT_ORG;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    console.log('Usage: npm run create:reviewer -- --email reviewer@yourdomain.com [--org "Meta Review Demo"]');
    return 1;
  }
  let conn;
  try {
    conn = await pool.getConnection();
  } catch (error) {
    console.log(`Could not reach the database: ${error.code || error.message}. Check DB_* in .env.`);
    return 1;
  }
  try {
    const [[taken]] = await conn.query('SELECT id FROM users WHERE email = ?', [email]);
    if (taken) {
      console.log(`${email} is already a user. Pick another email.`);
      return 1;
    }
    const [[ownerRole]] = await conn.query(`SELECT id FROM roles WHERE scope = 'client' AND role_key = 'owner'`);
    if (!ownerRole) {
      console.log('The client owner role is missing. Run npm run migrate first.');
      return 1;
    }
    const [[plan]] = await conn.query(`SELECT id FROM plans ORDER BY monthly_inr DESC LIMIT 1`);
    const password = newPassword();
    const passwordHash = await bcrypt.hash(password, 12);
    const slug = `${slugify(orgName)}-${randomBytes(3).toString('hex')}`;

    await conn.beginTransaction();
    const [org] = await conn.query(
      `INSERT INTO organizations (name, legal_name, slug, status, onboarding_step) VALUES (?, ?, ?, 'active', 'live')`,
      [orgName, orgName, slug]
    );
    await conn.query(
      `INSERT INTO workspaces (organization_id, name, slug, is_default) VALUES (?, ?, 'main', 1)`,
      [org.insertId, `${orgName} Workspace`]
    );
    if (plan) {
      await conn.query(
        `INSERT INTO subscriptions (organization_id, plan_id, status, current_period_end)
         VALUES (?, ?, 'trialing', DATE_ADD(UTC_DATE(), INTERVAL 60 DAY))`,
        [org.insertId, plan.id]
      );
    }
    const [user] = await conn.query(
      `INSERT INTO users (email, password_hash, full_name, realm, status) VALUES (?, ?, ?, 'client', 'active')`,
      [email, passwordHash, 'App Reviewer']
    );
    await conn.query(
      `INSERT INTO organization_users (organization_id, user_id, role_id, status) VALUES (?, ?, ?, 'active')`,
      [org.insertId, user.insertId, ownerRole.id]
    );
    await conn.query(
      `INSERT INTO user_roles (user_id, role_id, organization_id) VALUES (?, ?, ?)`,
      [user.insertId, ownerRole.id, org.insertId]
    );
    await conn.commit();

    console.log([
      '',
      `Workspace "${orgName}" created with no data in it.`,
      `Sign-in email:    ${email}`,
      `Sign-in password: ${password}`,
      '',
      'This password is shown only once. Type it into the review form directly.',
      'After the review, suspend this user or change the password.'
    ].join('\n'));
    return 0;
  } catch (error) {
    await conn.rollback().catch(() => {});
    console.log(`Could not create the reviewer: ${error.code || error.message}`);
    return 1;
  } finally {
    conn.release();
  }
}

const code = await main();
await pool.end();
process.exit(code);
