import { createHash } from 'node:crypto';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { existsSync } from 'node:fs';
import { once } from 'node:events';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const MAX_ML_FUNCTION_BYTES = 64 * 1024;
const MAX_METADATA_BYTES = 4096;
const MAX_METADATA_ITEMS = 32;
const INFERENCE_TIMEOUT_MS = 180_000;
const MAX_OUTPUT_BYTES = 8_000_000;
const REPOSITORY_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

export type MLSignalLabel = 'safe' | 'vulnerable';
export type MLSignalStatus = 'AVAILABLE' | 'UNAVAILABLE' | 'NOT_APPLICABLE';

export interface MLFunctionReference {
  functionId: string;
  functionName: string;
  filePath: string;
  startLine: number;
  endLine: number;
}

export interface MLFunctionInput extends MLFunctionReference {
  source: string;
}

export interface MLSignal {
  function: MLFunctionReference;
  modelVersion: string;
  label: MLSignalLabel;
  score: number;
  timestamp: string;
}

export interface MLSignalReport {
  status: MLSignalStatus;
  signals: MLSignal[];
  functionsConsidered: number;
  functionsScored: number;
  duplicateFunctionsAvoided: number;
  oversizedFunctionsSkipped: number;
  errorCode?: 'INFERENCE_FAILED';
}

export interface PythonPrediction {
  model_version: string;
  label: MLSignalLabel;
  score: number;
}

export type MLBatchInference = (
  functions: Array<{ source: string; metadata: MLFunctionReference }>,
) => Promise<PythonPrediction[]>;

function pythonExecutable(): string {
  const configured = process.env.BUGZERO_ML_PYTHON;
  if (configured) return configured;
  const localVenv = join(REPOSITORY_ROOT, 'ml', '.venv', 'Scripts', 'python.exe');
  return existsSync(localVenv) ? localVenv : 'python';
}

async function inferWithPython(
  functions: Array<{ source: string; metadata: MLFunctionReference }>,
): Promise<PythonPrediction[]> {
  const child: ChildProcessWithoutNullStreams = spawn(
    pythonExecutable(),
    ['-m', 'ml.inference.predict', '--jsonl'],
    { cwd: REPOSITORY_ROOT, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true },
  );
  const predictions: PythonPrediction[] = [];
  let stderr = '';
  let stdoutBytes = 0;
  let settled = false;

  return new Promise<PythonPrediction[]>((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill();
      finish(new Error('ML inference timed out'));
    }, INFERENCE_TIMEOUT_MS);

    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (error) reject(error);
      else resolve(predictions);
    };

    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      if (stderr.length < 4096) stderr += chunk.slice(0, 4096 - stderr.length);
    });
    child.stdin.on('error', (error) => finish(error));

    const lines = createInterface({ input: child.stdout });
    lines.on('line', (line) => {
      stdoutBytes += Buffer.byteLength(line, 'utf8') + 1;
      if (stdoutBytes > MAX_OUTPUT_BYTES) {
        child.kill();
        finish(new Error('ML inference output exceeded its limit'));
        return;
      }
      try {
        predictions.push(JSON.parse(line) as PythonPrediction);
      } catch (error) {
        child.kill();
        finish(error instanceof Error ? error : new Error('Invalid ML response'));
      }
    });
    child.on('error', (error) => finish(error));
    child.on('close', (code, signal) => {
      if (code !== 0) {
        finish(new Error(`ML inference exited with code ${code ?? signal}: ${stderr.slice(0, 256)}`));
      } else if (predictions.length !== functions.length) {
        finish(new Error('ML inference returned an unexpected number of results'));
      } else {
        finish();
      }
    });

    void (async () => {
      try {
        for (const item of functions) {
          const line = `${JSON.stringify({ source: item.source, metadata: item.metadata })}\n`;
          if (!child.stdin.write(line)) await once(child.stdin, 'drain');
        }
        child.stdin.end();
      } catch (error) {
        finish(error instanceof Error ? error : new Error('Could not send bounded functions to ML inference'));
      }
    })();
  });
}

function validPrediction(value: PythonPrediction): boolean {
  return typeof value.model_version === 'string'
    && value.model_version.length > 0
    && (value.label === 'safe' || value.label === 'vulnerable')
    && Number.isFinite(value.score)
    && value.score >= 0
    && value.score <= 1;
}

function validMetadata(metadata: MLFunctionReference): boolean {
  const entries = Object.entries(metadata);
  if (
    entries.length > MAX_METADATA_ITEMS
    || entries.some(([, value]) => (
      typeof value !== 'string' && (typeof value !== 'number' || !Number.isFinite(value))
    ))
  ) {
    return false;
  }
  try {
    return Buffer.byteLength(JSON.stringify(metadata), 'utf8') <= MAX_METADATA_BYTES;
  } catch {
    return false;
  }
}

export class MLSignalAdapter {
  constructor(private readonly inferBatch: MLBatchInference = inferWithPython) {}

  async predictFunction(
    source: string,
    metadata: MLFunctionReference,
  ): Promise<MLSignal> {
    if (Buffer.byteLength(source, 'utf8') > MAX_ML_FUNCTION_BYTES) {
      throw new Error(`ML function source exceeds the ${MAX_ML_FUNCTION_BYTES}-byte limit`);
    }
    const report = await this.predictFunctions([{ ...metadata, source }]);
    const signal = report.signals[0];
    if (report.status !== 'AVAILABLE' || !signal) {
      throw new Error('ML function inference is unavailable');
    }
    return signal;
  }

  async predictFunctions(functions: MLFunctionInput[]): Promise<MLSignalReport> {
    if (functions.length === 0) {
      return {
        status: 'NOT_APPLICABLE',
        signals: [],
        functionsConsidered: 0,
        functionsScored: 0,
        duplicateFunctionsAvoided: 0,
        oversizedFunctionsSkipped: 0,
      };
    }

    const unique = new Map<string, MLFunctionInput>();
    let oversizedFunctionsSkipped = 0;
    for (const fn of functions) {
      const byteLength = Buffer.byteLength(fn.source, 'utf8');
      if (byteLength > MAX_ML_FUNCTION_BYTES) {
        oversizedFunctionsSkipped += 1;
        continue;
      }
      if (!fn.source.trim()) continue;
      if (!validMetadata(fn)) {
        return {
          status: 'UNAVAILABLE',
          signals: [],
          functionsConsidered: functions.length,
          functionsScored: 0,
          duplicateFunctionsAvoided: 0,
          oversizedFunctionsSkipped,
          errorCode: 'INFERENCE_FAILED',
        };
      }
      const digest = createHash('sha256').update(fn.source).digest('hex');
      if (!unique.has(digest)) unique.set(digest, fn);
    }
    const duplicateFunctionsAvoided = functions.length - oversizedFunctionsSkipped - unique.size;
    if (unique.size === 0) {
      return {
        status: 'AVAILABLE',
        signals: [],
        functionsConsidered: functions.length,
        functionsScored: 0,
        duplicateFunctionsAvoided,
        oversizedFunctionsSkipped,
      };
    }

    try {
      const distinctFunctions = Array.from(unique.values());
      const predictions = await this.inferBatch(distinctFunctions.map(({ source, ...metadata }) => ({
        source,
        metadata,
      })));
      if (
        predictions.length !== distinctFunctions.length
        || predictions.some((prediction) => !validPrediction(prediction))
      ) {
        throw new Error('ML inference returned invalid predictions');
      }
      const predictionByHash = new Map<string, PythonPrediction>();
      distinctFunctions.forEach((fn, index) => {
        const prediction = predictions[index];
        if (prediction) predictionByHash.set(createHash('sha256').update(fn.source).digest('hex'), prediction);
      });
      const timestamp = new Date().toISOString();
      const signals = functions.flatMap((fn) => {
        if (Buffer.byteLength(fn.source, 'utf8') > MAX_ML_FUNCTION_BYTES || !fn.source.trim()) return [];
        const prediction = predictionByHash.get(createHash('sha256').update(fn.source).digest('hex'));
        if (!prediction) return [];
        const { source: _source, ...functionRef } = fn;
        return [{
          function: functionRef,
          modelVersion: prediction.model_version,
          label: prediction.label,
          score: prediction.score,
          timestamp,
        }];
      });
      return {
        status: 'AVAILABLE',
        signals,
        functionsConsidered: functions.length,
        functionsScored: signals.length,
        duplicateFunctionsAvoided,
        oversizedFunctionsSkipped,
      };
    } catch {
      return {
        status: 'UNAVAILABLE',
        signals: [],
        functionsConsidered: functions.length,
        functionsScored: 0,
        duplicateFunctionsAvoided,
        oversizedFunctionsSkipped,
        errorCode: 'INFERENCE_FAILED',
      };
    }
  }
}

export const mlSignalAdapter = new MLSignalAdapter();
