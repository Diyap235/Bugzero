export class DatabaseError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'DatabaseError';
  }
}

export class TenantIsolationError extends DatabaseError {
  constructor(resource: string, organizationId: string) {
    super(`Tenant isolation violation for ${resource} in organization ${organizationId}.`);
    this.name = 'TenantIsolationError';
  }
}
