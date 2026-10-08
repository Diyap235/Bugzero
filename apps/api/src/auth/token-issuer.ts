import { createPrivateKey, createPublicKey, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { importPKCS8, SignJWT } from 'jose';
import { ensurePrivateKey } from './dev-issuer.js';

const PASSWORD_SALT_BYTES = 16;
const PASSWORD_KEY_BYTES = 64;
const PASSWORD_SCRYPT_OPTIONS = { N: 16_384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export interface IssuedAccessToken {
  accessToken: string;
  issuedAt: number;
  expiresAt: number;
}

async function getSigningKey(): Promise<string> {
  const configuredKey = process.env.AUTH_PRIVATE_KEY?.replace(/\\n/g, '\n');
  if (configuredKey) return configuredKey;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('AUTH_PRIVATE_KEY must contain the trusted Ed25519 authentication private key');
  }
  return ensurePrivateKey();
}

export async function issueAccessToken(subject: string, organization: string): Promise<IssuedAccessToken> {
  const privateKeyPem = await getSigningKey();
  const privateKey = createPrivateKey(privateKeyPem);
  if (privateKey.asymmetricKeyType !== 'ed25519') {
    throw new Error('AUTH_PRIVATE_KEY must be an Ed25519 private key');
  }

  const configuredPublicKey = process.env.AUTH_PUBLIC_KEY?.replace(/\\n/g, '\n');
  if (configuredPublicKey) {
    const derivedPublicKey = createPublicKey(privateKey).export({ type: 'spki', format: 'der' });
    const configuredPublicKeyDer = createPublicKey(configuredPublicKey).export({ type: 'spki', format: 'der' });
    if (!derivedPublicKey.equals(configuredPublicKeyDer)) {
      throw new Error('AUTH_PRIVATE_KEY does not match AUTH_PUBLIC_KEY');
    }
  }

  const configuredLifetime = Number(process.env.AUTH_ACCESS_TOKEN_SECONDS ?? '3600');
  if (!Number.isSafeInteger(configuredLifetime) || configuredLifetime < 60 || configuredLifetime > 86_400) {
    throw new Error('AUTH_ACCESS_TOKEN_SECONDS must be an integer from 60 to 86400');
  }

  const issuedAt = Math.floor(Date.now() / 1000);
  const expiresAt = issuedAt + configuredLifetime;
  const signingKey = await importPKCS8(privateKeyPem, 'EdDSA');
  const accessToken = await new SignJWT({ org: organization })
    .setProtectedHeader({ alg: 'EdDSA', typ: 'JWT' })
    .setSubject(subject)
    .setIssuer(process.env.AUTH_ISSUER ?? 'bugzero-auth')
    .setAudience(process.env.AUTH_AUDIENCE ?? 'bugzero-api')
    .setIssuedAt(issuedAt)
    .setExpirationTime(expiresAt)
    .sign(signingKey);
  return { accessToken, issuedAt, expiresAt };
}

function derivePassword(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, PASSWORD_KEY_BYTES, PASSWORD_SCRYPT_OPTIONS, (error, derivedKey) => {
      if (error) reject(error);
      else resolve(derivedKey);
    });
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(PASSWORD_SALT_BYTES);
  const derivedKey = await derivePassword(password, salt);
  return `scrypt$16384$8$1$${salt.toString('hex')}$${derivedKey.toString('hex')}`;
}

export async function verifyPassword(password: string, encodedHash: string | null): Promise<boolean> {
  const parts = encodedHash?.split('$');
  if (
    !parts
    || parts.length !== 6
    || parts[0] !== 'scrypt'
    || parts[1] !== '16384'
    || parts[2] !== '8'
    || parts[3] !== '1'
    || !/^[a-f0-9]{32}$/i.test(parts[4] ?? '')
    || !/^[a-f0-9]{128}$/i.test(parts[5] ?? '')
  ) {
    await derivePassword(password, randomBytes(PASSWORD_SALT_BYTES));
    return false;
  }

  const expected = Buffer.from(parts[5] ?? '', 'hex');
  const actual = await derivePassword(password, Buffer.from(parts[4] ?? '', 'hex'));
  return timingSafeEqual(actual, expected);
}
