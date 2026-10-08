import { z } from 'zod';
import { UUID, OrganizationRole } from '../common/enums.js';

export const OrganizationSchema = z.object({
  id: UUID,
  name: z.string().min(1),
  slug: z.string().min(1),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const UserSchema = z.object({
  id: UUID,
  email: z.string().email(),
  displayName: z.string().min(1).nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const OrganizationMemberSchema = z.object({
  id: UUID,
  organizationId: UUID,
  userId: UUID,
  role: OrganizationRole,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type Organization = z.infer<typeof OrganizationSchema>;
export type User = z.infer<typeof UserSchema>;
export type OrganizationMember = z.infer<typeof OrganizationMemberSchema>;
