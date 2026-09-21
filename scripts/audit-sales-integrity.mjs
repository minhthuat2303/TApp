import fs from 'fs';
import { Pool } from 'pg';

const env = fs.readFileSync('.env.local', 'utf-8');
const line = env.split('\n').find(l => l.startsWith('POSTGRES_URL='));
const url = line.substring('POSTGRES_URL='.length).trim().replace(/^["']|["']$/g, '');
const cleanUrl = url.replace(/[?&]sslmode=[^&]*/gi, '');

const pool = new Pool({ connectionString: cleanUrl, ssl: { rejectUnauthorized: false } });

try {
  console.log('=== AUDITING DATABASE SALES & FINANCIAL INTEGRITY ===');

  // 1. Overall counts
  const prodCount = await pool.query('SELECT count(*) FROM products');
  const catCount = await pool.query('SELECT count(*) FROM categories');
  const saleCount = await pool.query('SELECT count(*) FROM sales_records');
  const lotCount = await pool.query('SELECT count(*) FROM inventory_lots');
  const movCount = await pool.query('SELECT count(*) FROM stock_movements');

  console.log({
    products: prodCount.rows[0].count,
    categories: catCount.rows[0].count,
    sales_records: saleCount.rows[0].count,
    inventory_lots: lotCount.rows[0].count,
    stock_movements: movCount.rows[0].count,
  });

  // 2. Status breakdown of sales records
  const statusDist = await pool.query(`
    SELECT COALESCE(status, 'COMPLETED') as st, count(*), 
           SUM(total_revenue) as rev, SUM(total_cost) as cost, SUM(profit) as profit
    FROM sales_records
    GROUP BY COALESCE(status, 'COMPLETED');
  `);
  console.log('Sales status distribution:', statusDist.rows);

  // 3. Check for arithmetic mismatches: profit = total_revenue - total_cost
  const mathMismatch = await pool.query(`
    SELECT count(*) as mismatch_count
    FROM sales_records
    WHERE ABS(profit - (total_revenue - total_cost)) > 0.01;
  `);
  console.log('Profit arithmetic mismatches:', mathMismatch.rows[0].mismatch_count);

  // 4. Check for orphan records (missing product_id)
  const orphanSales = await pool.query(`
    SELECT count(*) as orphan_count
    FROM sales_records sr
    LEFT JOIN products p ON p.id = sr.product_id
    WHERE p.id IS NULL;
  `);
  console.log('Orphan sales records (no matching product):', orphanSales.rows[0].orphan_count);

  // 5. Check inventory lots vs current_stock consistency
  const stockMismatch = await pool.query(`
    SELECT p.id, p.sku, p.name, p.current_stock, 
           COALESCE(SUM(l.quantity_remaining), 0) as lot_stock
    FROM products p
    LEFT JOIN inventory_lots l ON l.product_id = p.id AND l.quantity_remaining > 0
    GROUP BY p.id, p.sku, p.name, p.current_stock
    HAVING p.current_stock != COALESCE(SUM(l.quantity_remaining), 0);
  `);
  console.log('Products with current_stock != sum(lot.quantity_remaining):', stockMismatch.rows.length);
  if (stockMismatch.rows.length > 0) {
    console.log('Mismatches:', stockMismatch.rows.slice(0, 5));
  }

} catch (err) {
  console.error('Audit query error:', err);
} finally {
  await pool.end();
}
