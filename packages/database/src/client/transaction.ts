import type { PoolClient } from 'pg';

import { getDatabasePool } from './postgres.js';
import { setTransactionOrganizationContext } from './tenant-context.js';

export interface TransactionContext {
  client: PoolClient;
}

export async function withTransaction<T>(
  operation: (context: TransactionContext) => Promise<T>,
): Promise<T> {
  const client = await getDatabasePool().connect();

  try {
    await client.query('BEGIN');
    await setTransactionOrganizationContext(client);
    const result = await operation({ client });
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      throw new Error(`Transaction rollback failed: ${String(rollbackError)}`);
    }

    throw error;
  } finally {
    client.release();
  }
}
