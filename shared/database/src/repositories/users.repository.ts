import type { Pool } from 'pg';

import { getDatabasePool } from '../client/postgres.js';

export interface UserRecord {
  id: string;
  email: string;
  display_name: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateUserInput {
  email: string;
  display_name?: string | null;
}

export class UserRepository {
  constructor(private readonly pool: Pool = getDatabasePool()) {}

  async getById(userId: string): Promise<UserRecord | null> {
    const result = await this.pool.query<UserRecord>(
      'SELECT * FROM users WHERE id = $1',
      [userId],
    );

    return result.rows[0] ?? null;
  }

  async getByEmail(email: string): Promise<UserRecord | null> {
    const result = await this.pool.query<UserRecord>(
      'SELECT * FROM users WHERE email = $1',
      [email],
    );

    return result.rows[0] ?? null;
  }

  async create(input: CreateUserInput): Promise<UserRecord> {
    const result = await this.pool.query<UserRecord>(
      `INSERT INTO users (email, display_name)
       VALUES ($1, $2)
       RETURNING *`,
      [input.email, input.display_name ?? null],
    );

    return result.rows[0];
  }
}

export const usersRepository = new UserRepository();
