import { generateKeyPairSync, createPrivateKey, createPublicKey } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { importPKCS8, SignJWT } from 'jose';

const issuer = 'bugzero-auth';
const audience = 'bugzero-api';
const authDirectory = join(homedir(), '.bugzero', 'dev-auth');
const privateKeyPath = join(authDirectory, 'ed25519-private.pem');
const envPath = resolve(process.cwd(), '..', '..', '.env.local');
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function ensurePrivateKey(): Promise<string> {
  await mkdir(authDirectory, { recursive: true, mode: 0o700 });

  try {
    const privateKeyPem = await readFile(privateKeyPath, 'utf8');
    const privateKey = createPrivateKey(privateKeyPem);
    if (privateKey.asymmetricKeyType !== 'ed25519') {
      throw new Error(`Development private key at ${privateKeyPath} is not Ed25519`);
    }
    return privateKeyPem;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }

  const { privateKey } = generateKeyPairSync('ed25519', {
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });
  await writeFile(privateKeyPath, privateKey, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  return privateKey;
}

async function configureLocalEnvironment(): Promise<void> {
  const privateKeyPem = await ensurePrivateKey();
  const publicKeyPem = createPublicKey(privateKeyPem).export({ type: 'spki', format: 'pem' }).toString().trim();
  const values: Record<string, string> = {
    AUTH_PUBLIC_KEY: publicKeyPem.replace(/\r?\n/g, '\\n'),
    AUTH_ISSUER: issuer,
    AUTH_AUDIENCE: audience,
  };

  let existing = '';
  try {
    existing = await readFile(envPath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }

  const lineEnding = existing.includes('\r\n') ? '\r\n' : '\n';
  const authVariableNames = new Set(Object.keys(values));
  const lines = existing
    .split(/\r?\n/)
    .filter((line) => {
      const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line);
      return !match || !authVariableNames.has(match[1]);
    });
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  lines.push(...Object.entries(values).map(([name, value]) => `${name}=${value}`));
  await writeFile(envPath, `${lines.join(lineEnding)}${lineEnding}`, 'utf8');

  console.log(`Configured development authentication in ${envPath}`);
  console.log(`Development Ed25519 private key stored outside the repository at ${privateKeyPath}`);
}

async function issueToken(args: string[]): Promise<void> {
  const options = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];
    if (!name?.startsWith('--') || !value || options.has(name)) {
      throw new Error('Usage: dev-auth:token -- --sub <user-uuid> --org <organization-uuid> [--expires-in-seconds <1-86400>]');
    }
    options.set(name, value);
  }

  const subject = options.get('--sub');
  const organization = options.get('--org');
  const lifetime = Number(options.get('--expires-in-seconds') ?? '900');
  if (!subject || !uuidPattern.test(subject) || !organization || !uuidPattern.test(organization)) {
    throw new Error('Both --sub and --org must be UUIDs from existing BugZero development identities');
  }
  if (!Number.isSafeInteger(lifetime) || lifetime < 1 || lifetime > 86_400) {
    throw new Error('--expires-in-seconds must be an integer from 1 to 86400');
  }
  for (const name of options.keys()) {
    if (!['--sub', '--org', '--expires-in-seconds'].includes(name)) {
      throw new Error(`Unknown option: ${name}`);
    }
  }

  const privateKeyPem = await readFile(privateKeyPath, 'utf8');
  const privateKey = createPrivateKey(privateKeyPem);
  if (privateKey.asymmetricKeyType !== 'ed25519') {
    throw new Error(`Development private key at ${privateKeyPath} is not Ed25519`);
  }

  const issuedAt = Math.floor(Date.now() / 1000);
  const signingKey = await importPKCS8(privateKeyPem, 'EdDSA');
  const token = await new SignJWT({ org: organization })
    .setProtectedHeader({ alg: 'EdDSA', typ: 'JWT' })
    .setSubject(subject)
    .setIssuer(issuer)
    .setAudience(audience)
    .setIssuedAt(issuedAt)
    .setExpirationTime(issuedAt + lifetime)
    .sign(signingKey);
  console.log(token);
}

const [command, ...args] = process.argv.slice(2);
if (command === 'setup') {
  await configureLocalEnvironment();
} else if (command === 'token') {
  await issueToken(args);
} else {
  throw new Error('Expected command "setup" or "token"');
}
