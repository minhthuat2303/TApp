import fs from 'fs';
import { Pool } from 'pg';

const env = fs.readFileSync('.env.local', 'utf-8');
const line = env.split('\n').find(l => l.startsWith('POSTGRES_URL='));
const url = line.substring('POSTGRES_URL='.length).trim().replace(/^["']|["']$/g, '');
const cleanUrl = url.replace(/[?&]sslmode=[^&]*/gi, '');

const pool = new Pool({
  connectionString: cleanUrl,
  ssl: { rejectUnauthorized: false }
});

try {
  console.log('Connecting to PostgreSQL to create devices and user_sessions tables...');
  await pool.query(`
    CREATE TABLE IF NOT EXISTS devices (
      device_id VARCHAR(100) PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      device_name VARCHAR(255) NOT NULL,
      platform VARCHAR(50) NOT NULL,
      app_version VARCHAR(50) NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'REVOKED')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_seen_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_devices_user_id ON devices(user_id);

    CREATE TABLE IF NOT EXISTS user_sessions (
      session_id VARCHAR(100) PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      device_id VARCHAR(100) NOT NULL REFERENCES devices(device_id) ON DELETE CASCADE,
      refresh_token_hash VARCHAR(128) NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'REVOKED', 'EXPIRED')),
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_refreshed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      revoked_at TIMESTAMPTZ,
      revoked_reason TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON user_sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_user_sessions_device_id ON user_sessions(device_id);
    CREATE INDEX IF NOT EXISTS idx_user_sessions_refresh_token ON user_sessions(refresh_token_hash);
  `);

  console.log('Successfully ensured devices and user_sessions tables in Supabase PostgreSQL!');

  const checkDev = await pool.query('SELECT count(*) FROM devices');
  const checkSess = await pool.query('SELECT count(*) FROM user_sessions');
  console.log('devices count:', checkDev.rows[0].count);
  console.log('user_sessions count:', checkSess.rows[0].count);
} catch (err) {
  console.error('Migration error:', err);
} finally {
  await pool.end();
}
