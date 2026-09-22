const { Pool, types } = require('pg');
const fs = require('fs');

// Simple .env.local parser
if (fs.existsSync('.env.local')) {
  const envContent = fs.readFileSync('.env.local', 'utf8');
  envContent.split('\n').forEach(line => {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const idx = trimmed.indexOf('=');
      if (idx !== -1) {
        const key = trimmed.slice(0, idx).trim();
        let val = trimmed.slice(idx + 1).trim();
        if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
        process.env[key] = val;
      }
    }
  });
}

// Force date string format
types.setTypeParser(1082, (val) => val);

const connStr = process.env.POSTGRES_URL || process.env.DATABASE_URL;
let cleanUrl = connStr.replace(/[?&]sslmode=[^&]*/gi, '').replace(/[?&]supa=[^&]*/gi, '').replace(/[?&]pgbouncer=[^&]*/gi, '');
if (cleanUrl.endsWith('?')) cleanUrl = cleanUrl.slice(0, -1);

const pool = new Pool({
  connectionString: cleanUrl,
  ssl: { rejectUnauthorized: false }
});

async function main() {
  const client = await pool.connect();
  try {
    console.log('Connected to PostgreSQL Supabase successfully.');

    // 1. Check & Add payment_method column to sales_records
    await client.query(`
      ALTER TABLE sales_records 
      ADD COLUMN IF NOT EXISTS payment_method VARCHAR(30) DEFAULT 'CASH';
    `);
    console.log('Column payment_method checked/added.');

    // 2. Audit current sales_records
    const salesRes = await client.query(`
      SELECT 
        status, 
        payment_method,
        COUNT(*) as count,
        SUM(quantity) as sum_qty,
        SUM(total_revenue) as sum_rev,
        SUM(profit) as sum_profit
      FROM sales_records
      GROUP BY status, payment_method
    `);
    fs.writeFileSync('scripts/audit_results.json', JSON.stringify({
      salesBreakdown: salesRes.rows
    }, null, 2));
    console.log('Saved audit_results.json successfully.');

    // 3. Check for any multi-item inconsistencies or cancelled items
    const cancelledRes = await client.query(`
      SELECT id, transaction_code, product_id, sale_date, quantity, total_revenue, status, cancel_reason, cancelled_at
      FROM sales_records
      WHERE status = 'CANCELLED'
      ORDER BY id DESC
      LIMIT 10
    `);
    console.log('\n--- RECENT CANCELLED ORDERS ---');
    console.table(cancelledRes.rows);

    // 4. Check products stock
    const productsRes = await client.query(`
      SELECT id, sku, name, current_stock, current_cost_price, current_selling_price, status
      FROM products
      WHERE status = 'ACTIVE'
      ORDER BY id ASC
      LIMIT 10
    `);
    console.log('\n--- ACTIVE PRODUCTS SAMPLE ---');
    console.table(productsRes.rows);

    // 5. Check imports
    const importsRes = await client.query(`
      SELECT id, import_code, import_date, total_amount, created_at
      FROM imports
      ORDER BY id DESC
      LIMIT 5
    `);
    console.log('\n--- RECENT IMPORTS ---');
    console.table(importsRes.rows);

  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(err => {
  console.error('Audit Error:', err);
  process.exit(1);
});
