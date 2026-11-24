import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPOSITORY_ROOT = fileURLToPath(new URL('../../', import.meta.url));

export function pythonExecutable(): string {
  const configured = process.env.BUGZERO_ML_PYTHON;
  if (configured) return configured;
  const localVenv = join(REPOSITORY_ROOT, 'ml', '.venv', 'Scripts', 'python.exe');
  return existsSync(localVenv) ? localVenv : 'python';
}
