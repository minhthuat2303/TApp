import { Migration } from '../types';
import { migration001 } from './001_initial_master_data';
import { migration002 } from './002_transactions_and_inventory';
import { migration003 } from './003_outbox_and_sync_metadata';
import { migration004 } from './004_offline_transactions_and_outbox_engine';
import { migration005 } from './005_conflict_records_and_sync_sessions';
import { migration006 } from './006_conflict_taxonomy_and_reconciliation';
import { migration007 } from './007_auth_device_and_account_scope';
import { migration008 } from './008_purchase_orders_and_product_details';
import { migration009 } from './009_sales_order_cancellation_and_payment';

export const migrations: Migration[] = [
  migration001,
  migration002,
  migration003,
  migration004,
  migration005,
  migration006,
  migration007,
  migration008,
  migration009,
];

export default migrations;

