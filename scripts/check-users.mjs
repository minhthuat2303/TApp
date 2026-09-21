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
  const res = await pool.query('SELECT id, username, full_name, role, status FROM users ORDER BY id');
  console.log('USERS_RESULT:', JSON.stringify(res.rows, null, 2));
} catch (err) {
  console.error(err);
} finally {
  await pool.end();
}
