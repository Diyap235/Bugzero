import { z } from 'zod';
import { UUID } from '../common/enums.js';

export const SignInRequestSchema = z.object({
  email: z.string().trim().max(254).email(),
  password: z.string().min(1).max(256),
}).strict();

export const RegisterAccountRequestSchema = z.object({
  displayName: z.string().trim().min(1).max(100),
  email: z.string().trim().max(254).email(),
  password: z.string().min(12).max(256),
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

export type SignInRequest = z.infer<typeof SignInRequestSchema>;
export type RegisterAccountRequest = z.infer<typeof RegisterAccountRequestSchema>;
export type AuthSessionResponse = z.infer<typeof AuthSessionResponseSchema>;
export type AuthenticatedSessionResponse = z.infer<typeof AuthenticatedSessionResponseSchema>;
