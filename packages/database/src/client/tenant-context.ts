import { AsyncLocalStorage } from 'node:async_hooks';
import type { Pool, PoolClient, QueryConfig } from 'pg';

const organizationContext = new AsyncLocalStorage<string>();
const organizationIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function getOrganizationContext(): string | undefined {
  return organizationContext.getStore();
}

export function withOrganizationContext<T>(organizationId: string, operation: () => Promise<T>): Promise<T> {
  if (!organizationIdPattern.test(organizationId)) {
    throw new Error('A valid organization ID is required for tenant-scoped database access');
  }
  return organizationContext.run(organizationId, operation);
}

export async function setTransactionOrganizationContext(client: PoolClient): Promise<void> {
  const organizationId = getOrganizationContext();
  if (organizationId) {
    await client.query("SELECT set_config('app.organization_id', $1, true)", [organizationId]);
  }
}

function bindTenantScopedPoolQueries(pool: Pool): void {
  const originalQuery = pool.query.bind(pool);

  Object.defineProperty(pool, 'query', {
    configurable: true,
    value: (...args: unknown[]) => {
      const organizationId = getOrganizationContext();
      if (!organizationId) return originalQuery(...args as Parameters<Pool['query']>);

      let callback: ((error: unknown, result?: unknown) => void) | undefined;
      for (let index = args.length - 1; index >= 0; index -= 1) {
        const argument = args[index];
        if (typeof argument === 'function') {
          callback = argument as (error: unknown, result?: unknown) => void;
          break;
        }
      }
      const queryArgument = args[0];
      const values = typeof args[1] === 'function' ? undefined : args[1];
      const run = async (): Promise<unknown> => {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          await client.query("SELECT set_config('app.organization_id', $1, true)", [organizationId]);
          const result = typeof queryArgument === 'string'
            ? await client.query<Record<string, unknown>>(queryArgument, values as unknown[] | undefined)
            : await client.query<Record<string, unknown>>(queryArgument as QueryConfig<unknown[]>);
          await client.query('COMMIT');
          return result;
        } catch (error) {
          await client.query('ROLLBACK').catch(() => undefined);
          throw error;
        } finally {
          client.release();
        }
      };

      if (typeof callback === 'function') {
        void run().then(
          (result) => callback?.(null, result),
          (error: unknown) => callback?.(error),
        );
        return undefined;
      }
      return run();
    },
  });
}

export function enforceTenantScopedQueries(pool: Pool): Pool {
  bindTenantScopedPoolQueries(pool);
  return pool;
}
