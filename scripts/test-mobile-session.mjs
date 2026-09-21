import fs from 'fs';
import { Pool } from 'pg';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';

const env = fs.readFileSync('.env.local', 'utf-8');
const line = env.split('\n').find(l => l.startsWith('POSTGRES_URL='));
const url = line.substring('POSTGRES_URL='.length).trim().replace(/^["']|["']$/g, '');
const cleanUrl = url.replace(/[?&]sslmode=[^&]*/gi, '');

const pool = new Pool({ connectionString: cleanUrl, ssl: { rejectUnauthorized: false } });

try {
  const deviceId = 'test-device-uuid-' + Date.now();
  const userId = 1;

  // 1. Upsert device
  await pool.query(`
    INSERT INTO devices (device_id, user_id, device_name, platform, app_version, status, last_seen_at)
    VALUES ($1, $2, $3, $4, $5, 'ACTIVE', CURRENT_TIMESTAMP)
    ON CONFLICT (device_id) DO UPDATE SET
      user_id = EXCLUDED.user_id,
      device_name = EXCLUDED.device_name,
      platform = EXCLUDED.platform,
      app_version = EXCLUDED.app_version,
      status = 'ACTIVE',
      last_seen_at = CURRENT_TIMESTAMP
  `, [deviceId, userId, 'Android Test Phone', 'android', '1.0.0']);

  // 2. Insert session
  const sessionId = crypto.randomUUID();
  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

  await pool.query(`
    INSERT INTO user_sessions (session_id, user_id, device_id, refresh_token_hash, status, expires_at)
    VALUES ($1, $2, $3, $4, 'ACTIVE', $5)
  `, [sessionId, userId, deviceId, tokenHash, expiresAt]);

  console.log('Mobile session created successfully in DB!');

  // Verify retrieval
  const sess = await pool.query('SELECT * FROM user_sessions WHERE session_id = $1', [sessionId]);
  console.log('Session verified:', sess.rows[0].session_id);

  // Clean up test record
  await pool.query('DELETE FROM user_sessions WHERE session_id = $1', [sessionId]);
  await pool.query('DELETE FROM devices WHERE device_id = $1', [deviceId]);
  console.log('Cleaned up test record.');
} catch (e) {
  console.error('Session test error:', e);
} finally {
  await pool.end();
}
