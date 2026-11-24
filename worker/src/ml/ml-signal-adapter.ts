import { createHash } from 'node:crypto';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { pythonExecutable } from '../python-runtime.js';

export const MAX_ML_FUNCTION_BYTES = 64 * 1024;
const MAX_METADATA_BYTES = 4096;
const MAX_METADATA_ITEMS = 32;
const INFERENCE_TIMEOUT_MS = 180_000;
const MAX_OUTPUT_BYTES = 8_000_000;
const REPOSITORY_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

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

interface InferenceBatch {
  functions: Array<{ source: string; metadata: MLFunctionReference }>;
  predictions: PythonPrediction[];
  outputBytes: number;
  timeout?: ReturnType<typeof setTimeout>;
  resolve(predictions: PythonPrediction[]): void;
  reject(error: Error): void;
}

class PythonInferenceSession {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly batches: InferenceBatch[] = [];
  private readonly closeWaiters = new Set<() => void>();
  private activeBatch: InferenceBatch | null = null;
  private stderr = '';
  private closed = false;
  private closing = false;

  constructor() {
    this.child = spawn(
      pythonExecutable(),
      ['-m', 'ml.inference.predict', '--jsonl'],
      { cwd: REPOSITORY_ROOT, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true },
    );
    this.child.stderr.setEncoding('utf8');
    this.child.stderr.on('data', (chunk: string) => {
      if (this.stderr.length < 4096) this.stderr += chunk.slice(0, 4096 - this.stderr.length);
    });
    this.child.stdin.on('error', (error) => this.fail(error));
    createInterface({ input: this.child.stdout }).on('line', (line) => this.handleLine(line));
    this.child.on('error', (error) => this.fail(error));
    this.child.on('close', (code, signal) => {
      if (this.activeBatch || this.batches.length > 0) {
        this.fail(new Error(`ML inference exited with code ${code ?? signal}: ${this.stderr.slice(0, 256)}`), false);
      } else {
        this.markClosed();
      }
    });
  }

  get isClosed(): boolean {
    return this.closed;
  }

  predict(functions: Array<{ source: string; metadata: MLFunctionReference }>): Promise<PythonPrediction[]> {
    if (this.closed || this.closing) return Promise.reject(new Error('ML inference session is unavailable'));
    return new Promise<PythonPrediction[]>((resolve, reject) => {
      this.batches.push({ functions, predictions: [], outputBytes: 0, resolve, reject });
      this.startNextBatch();
    });
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closing = true;
    if (this.activeBatch || this.batches.length > 0) {
      this.fail(new Error('ML inference session is shutting down'));
      return;
    }
    const closed = new Promise<void>((resolve) => this.closeWaiters.add(resolve));
    this.child.stdin.end();
    await Promise.race([
      closed,
      new Promise<void>((resolve) => setTimeout(() => {
        this.child.kill();
        resolve();
      }, 2_000)),
    ]);
  }

  private startNextBatch(): void {
    if (this.closed || this.activeBatch) return;
    const batch = this.batches.shift();
    if (!batch) return;
    this.activeBatch = batch;
    batch.timeout = setTimeout(() => this.fail(new Error('ML inference timed out')), INFERENCE_TIMEOUT_MS);
    void this.writeBatch(batch);
  }

  private async writeBatch(batch: InferenceBatch): Promise<void> {
    try {
      for (const item of batch.functions) {
        const line = `${JSON.stringify({ source: item.source, metadata: item.metadata })}\n`;
        if (!this.child.stdin.write(line)) await once(this.child.stdin, 'drain');
      }
    } catch (error) {
      this.fail(error instanceof Error ? error : new Error('Could not send bounded functions to ML inference'));
    }
  }

  private handleLine(line: string): void {
    const batch = this.activeBatch;
    if (!batch) {
      this.fail(new Error('ML inference returned an unexpected response'));
      return;
    }
    batch.outputBytes += Buffer.byteLength(line, 'utf8') + 1;
    if (batch.outputBytes > MAX_OUTPUT_BYTES) {
      this.fail(new Error('ML inference output exceeded its limit'));
      return;
    }
    try {
      batch.predictions.push(JSON.parse(line) as PythonPrediction);
    } catch (error) {
      this.fail(error instanceof Error ? error : new Error('Invalid ML response'));
      return;
    }
    if (batch.predictions.length !== batch.functions.length) return;
    if (batch.timeout) clearTimeout(batch.timeout);
    this.activeBatch = null;
    batch.resolve(batch.predictions);
    this.startNextBatch();
  }

  private fail(error: Error, terminate = true): void {
    if (this.closed) return;
    const pending = [this.activeBatch, ...this.batches].filter((batch): batch is InferenceBatch => batch !== null);
    this.activeBatch = null;
    this.batches.length = 0;
    for (const batch of pending) {
      if (batch.timeout) clearTimeout(batch.timeout);
      batch.reject(error);
    }
    if (terminate) this.child.kill();
    this.markClosed();
  }

  private markClosed(): void {
    if (this.closed) return;
    this.closed = true;
    for (const resolve of this.closeWaiters) resolve();
    this.closeWaiters.clear();
  }
}

let pythonInferenceSession: PythonInferenceSession | null = null;

async function inferWithPython(
  functions: Array<{ source: string; metadata: MLFunctionReference }>,
): Promise<PythonPrediction[]> {
  if (!pythonInferenceSession || pythonInferenceSession.isClosed) {
    pythonInferenceSession = new PythonInferenceSession();
  }
  const session = pythonInferenceSession;
  try {
    return await session.predict(functions);
  } catch (error) {
    if (pythonInferenceSession === session) pythonInferenceSession = null;
    throw error;
  }
}

export async function warmUpMLSignalInference(): Promise<void> {
  await inferWithPython([{
    source: 'def _bugzero_ml_worker_warmup():\n    return None',
    metadata: {
      functionId: 'worker-warmup',
      functionName: '_bugzero_ml_worker_warmup',
      filePath: 'worker-warmup.py',
      startLine: 1,
      endLine: 2,
    },
  }]);
}

export async function closeMLSignalInference(): Promise<void> {
  const session = pythonInferenceSession;
  pythonInferenceSession = null;
  await session?.close();
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
