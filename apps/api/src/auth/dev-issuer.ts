import { generateKeyPairSync, createPrivateKey, createPublicKey } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const issuer = 'bugzero-auth';
const audience = 'bugzero-api';
const authDirectory = join(homedir(), '.bugzero', 'dev-auth');
const privateKeyPath = join(authDirectory, 'ed25519-private.pem');
const envPath = resolve(process.cwd(), '..', '..', '.env.local');

export async function ensurePrivateKey(): Promise<string> {
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

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'setup') {
    if (args.length > 0) throw new Error('Usage: dev-auth:setup');
    await configureLocalEnvironment();
  } else {
    throw new Error('Expected command "setup"');
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
