import { pool } from '../config/db.js';
import { ApiError } from '../utils/errors.js';
import { env } from '../config/env.js';

const DROPPED = new Set(['ECONNRESET', 'PROTOCOL_CONNECTION_LOST', 'EPIPE', 'ETIMEDOUT']);

export async function many(sql, params = []) {
  try {
    const [rows] = await pool.query(sql, params);
    return rows;
  } catch (error) {
    if (!DROPPED.has(error?.code) || !/^\s*(SELECT|WITH)\b/i.test(sql)) throw wrap(error);
    try {
      const [rows] = await pool.query(sql, params);
      return rows;
    } catch (again) {
      throw wrap(again);
    }
  }
}

export async function one(sql, params = []) {
  const rows = await many(sql, params);
  return rows[0] || null;
}

export async function insert(sql, params = []) {
  try {
    const [result] = await pool.query(sql, params);
    return result.insertId;
  } catch (error) {
    throw wrap(error);
  }
}

export async function run(sql, params = []) {
  try {
    const [result] = await pool.query(sql, params);
    return result;
  } catch (error) {
    throw wrap(error);
  }
}

function wrap(error) {
  if (error instanceof ApiError) return error;
  const wrapped = new ApiError(500, 'A database operation failed.', 'database_error');
  if (!env.isProd && error?.code === 'ER_NO_SUCH_TABLE') {
    wrapped.message = 'Database schema is not ready. Run npm run setup from the project root.';
  }
  wrapped.cause = error;
  return wrapped;
}
