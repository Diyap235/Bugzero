import { z } from 'zod';
import { UUID } from '../common/enums.js';

export const SignInRequestSchema = z.object({
  email: z.string().trim().max(254).email(),
  password: z.string().min(1).max(256),
}).strict();

export const RegisterAccountRequestSchema = z.object({
  displayName: z.string().trim().min(1).max(100),
  email: z.string().trim().max(254).email(),
  password: z.string().min(4).max(256),
  workspaceName: z.string().trim().min(2).max(80),
}).strict();

export const AuthSessionResponseSchema = z.object({
  accessToken: z.string().min(1),
  issuedAt: z.number().int().positive(),
  expiresAt: z.number().int().positive(),
  user: z.object({
    userId: UUID,
    email: z.string().email(),
    role: z.string().min(1),
  }).strict(),
}).strict();

export const AuthenticatedSessionResponseSchema = z.object({
  user: z.object({
    userId: UUID,
    email: z.string().email(),
    displayName: z.string().min(1),
    role: z.string().min(1),
  }).strict(),
  workspace: z.object({
    organizationId: UUID,
    name: z.string().min(1),
  }).strict(),
}).strict();

export const OrganizationInvitationRoleSchema = z.enum([
  'DEVELOPER',
  'SECURITY_REVIEWER',
  'VIEWER',
]);

export const OrganizationInvitationStatusSchema = z.enum([
  'PENDING',
  'ACCEPTED',
  'EXPIRED',
]);

export const CreateOrganizationInvitationRequestSchema = z.object({
  email: z.string().trim().max(254).email(),
  role: OrganizationInvitationRoleSchema,
}).strict();

export const AcceptOrganizationInvitationRequestSchema = z.object({
  organizationId: UUID,
  token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
}).strict();

export const OrganizationInvitationSchema = z.object({
  id: UUID,
  organizationId: UUID,
  email: z.string().email(),
  role: OrganizationInvitationRoleSchema,
  status: OrganizationInvitationStatusSchema,
  expiresAt: z.string().datetime(),
  createdAt: z.string().datetime(),
  acceptedAt: z.string().datetime().nullable(),
}).strict();

export const CreateOrganizationInvitationResponseSchema = z.object({
  invitation: OrganizationInvitationSchema,
  token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
}).strict();

export const ListOrganizationInvitationsResponseSchema = z.object({
  invitations: z.array(OrganizationInvitationSchema),
}).strict();

export type SignInRequest = z.infer<typeof SignInRequestSchema>;
export type RegisterAccountRequest = z.infer<typeof RegisterAccountRequestSchema>;
export type AuthSessionResponse = z.infer<typeof AuthSessionResponseSchema>;
export type AuthenticatedSessionResponse = z.infer<typeof AuthenticatedSessionResponseSchema>;
export type OrganizationInvitationRole = z.infer<typeof OrganizationInvitationRoleSchema>;
export type OrganizationInvitationStatus = z.infer<typeof OrganizationInvitationStatusSchema>;
export type OrganizationInvitation = z.infer<typeof OrganizationInvitationSchema>;
export type AcceptOrganizationInvitationRequest = z.infer<typeof AcceptOrganizationInvitationRequestSchema>;
