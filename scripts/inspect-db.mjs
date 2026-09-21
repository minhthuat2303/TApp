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
  const tables = await pool.query(`
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = 'public' 
    ORDER BY table_name;
  `);
  console.log('TABLES:', tables.rows.map(r => r.table_name));

  const sess = await pool.query('SELECT count(*) FROM user_sessions');
  console.log('USER_SESSIONS COUNT:', sess.rows[0].count);

  const devs = await pool.query('SELECT count(*) FROM devices');
  console.log('DEVICES COUNT:', devs.rows[0].count);

} catch (err) {
  console.error('DB inspection error:', err);
} finally {
  await pool.end();
}
