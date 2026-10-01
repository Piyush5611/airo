import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { adminConnection } from '../config/db.js';
import { env } from '../config/env.js';
import { PLATFORM_PERMISSIONS, grantsFor } from '../domain/access.js';

const dir = path.dirname(fileURLToPath(import.meta.url));

export async function migrate() {
  const connection = await adminConnection();
  try {
    await connection.query(
      `CREATE DATABASE IF NOT EXISTS \`${env.db.name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
    );
    await connection.query(`USE \`${env.db.name}\``);
    const folder = path.join(dir, 'migrations');
    const files = fs.readdirSync(folder).filter((name) => name.endsWith('.sql')).sort();
    const base = files.find((name) => name.startsWith('001')) || files[0];
    await connection.query(fs.readFileSync(path.join(folder, base), 'utf8'));
    await connection.query(`INSERT IGNORE INTO schema_migrations (id) VALUES (?)`, [base.replace(/\.sql$/, '')]);
    for (const file of files) {
      if (file === base) continue;
      const id = file.replace(/\.sql$/, '');
      const [seen] = await connection.query(`SELECT id FROM schema_migrations WHERE id = ?`, [id]);
      if (seen.length) continue;
      await connection.query(fs.readFileSync(path.join(folder, file), 'utf8'));
      await connection.query(`INSERT IGNORE INTO schema_migrations (id) VALUES (?)`, [id]);
    }
    await syncPlatformGrants(connection);
    await ensureWhatsapp(connection);
    await connection.query(
      `UPDATE integration_providers SET description = ? WHERE provider_key = 'nexcall'`,
      ['Read-only pull of W-Caller leads, calls, the call report, and follow-ups. Authenticate with x-api-key.']
    ).catch(() => {});
    console.log(`Schema ready on ${env.db.name}.`);
  } finally {
    await connection.end();
  }
}

async function syncPlatformGrants(connection) {
  const [roles] = await connection.query(`SELECT id, role_key AS roleKey FROM roles WHERE scope = 'platform' AND is_system = 1`);
  if (!roles.length) return;
  for (const permission of PLATFORM_PERMISSIONS) {
    await connection.query(
      `INSERT INTO permissions (scope, perm_key, resource_name, action_name, description)
       VALUES ('platform', ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE description = VALUES(description)`,
      [permission.key, permission.resource, permission.action, permission.description]
    );
  }
  const [perms] = await connection.query(`SELECT id, perm_key AS permKey FROM permissions WHERE scope = 'platform'`);
  const permId = Object.fromEntries(perms.map((row) => [row.permKey, row.id]));
  for (const role of roles) {
    for (const key of grantsFor('platform', role.roleKey)) {
      if (!permId[key]) continue;
      await connection.query(`INSERT IGNORE INTO role_permissions (role_id, permission_id) VALUES (?, ?)`, [role.id, permId[key]]);
    }
  }
}

async function ensureWhatsapp(connection) {
  await connection.query(
    `INSERT INTO whatsapp_bot (id, display_name, phone_label, status, mode, webhook_path, note)
     VALUES (1, 'AIRO WhatsApp', 'Not connected', 'pending', 'development', '/api/whatsapp/webhook', NULL)
     ON DUPLICATE KEY UPDATE id = id`
  );
  const [orgs] = await connection.query(`SELECT id, name FROM organizations`);
  for (const org of orgs) {
    await connection.query(
      `INSERT IGNORE INTO whatsapp_businesses (organization_id, enabled, business_label) VALUES (?, 1, ?)`,
      [org.id, org.name]
    );
  }
}

const entry = process.argv[1]?.replaceAll('\\', '/');
if (entry?.endsWith('/src/db/migrate.js') || entry?.endsWith('/db/migrate.js')) {
  migrate().catch((error) => {
    console.error(error.message || error);
    process.exit(1);
  });
}
