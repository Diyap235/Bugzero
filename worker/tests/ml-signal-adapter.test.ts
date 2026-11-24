import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MLSignalAdapter,
  MAX_ML_FUNCTION_BYTES,
  type MLFunctionReference,
} from '../src/ml/ml-signal-adapter.js';

const functionReference: MLFunctionReference = {
  functionId: 'entity-1',
  functionName: 'vulnerable_query',
  filePath: 'src/db.py',
  startLine: 1,
  endLine: 3,
};
const pythonFunction = 'def vulnerable_query(request, db):\n    return db.query(request.args["id"])';

test('predicts raw function source as an investigative ML signal', async () => {
  const adapter = new MLSignalAdapter(async () => [
    { model_version: 'v1', label: 'vulnerable', score: 0.87 },
  ]);
  const signal = await adapter.predictFunction(pythonFunction, functionReference);

  assert.equal(signal.modelVersion, 'v1');
  assert.equal(signal.label, 'vulnerable');
  assert.ok(signal.score >= 0 && signal.score <= 1);
  assert.deepEqual(signal.function, functionReference);
  assert.equal('evidence' in signal, false);
  assert.equal('finding' in signal, false);
  assert.equal('authority' in signal, false);
});

test('deduplicates identical source within a run while retaining both function references', async () => {
  let inferenceCalls = 0;
  const adapter = new MLSignalAdapter(async (functions) => {
    inferenceCalls += 1;
    assert.equal(functions.length, 1);
    return [{ model_version: 'v1', label: 'safe', score: 0.12 }];
  });
  const result = await adapter.predictFunctions([
    { ...functionReference, source: pythonFunction },
    { ...functionReference, functionId: 'entity-2', functionName: 'alias', source: pythonFunction },
  ]);

  assert.equal(inferenceCalls, 1);
  assert.equal(result.duplicateFunctionsAvoided, 1);
  assert.equal(result.functionsScored, 2);
  assert.deepEqual(result.signals.map((signal) => signal.function.functionId), ['entity-1', 'entity-2']);
});

test('functions above the 64 KiB contract are never sent to inference', async () => {
  let inferenceCalls = 0;
  const adapter = new MLSignalAdapter(async () => {
    inferenceCalls += 1;
    return [];
  });
  const result = await adapter.predictFunctions([
    { ...functionReference, source: 'x'.repeat(MAX_ML_FUNCTION_BYTES + 1) },
  ]);

  assert.equal(inferenceCalls, 0);
  assert.equal(result.oversizedFunctionsSkipped, 1);
  assert.equal(result.signals.length, 0);
});

test('model failure is represented as unavailable without throwing', async () => {
  const adapter = new MLSignalAdapter(async () => {
    throw new Error('model weights unavailable');
  });
  const result = await adapter.predictFunctions([
    { ...functionReference, source: pythonFunction },
  ]);

  assert.equal(result.status, 'UNAVAILABLE');
  assert.equal(result.errorCode, 'INFERENCE_FAILED');
  assert.deepEqual(result.signals, []);
});

test('returns not-applicable when the analyzed scope has no Python functions', async () => {
  let inferenceCalls = 0;
  const adapter = new MLSignalAdapter(async () => {
    inferenceCalls += 1;
    return [];
  });
  const result = await adapter.predictFunctions([]);

  assert.equal(result.status, 'NOT_APPLICABLE');
  assert.equal(inferenceCalls, 0);
});

test('rejects invalid scores from the inference boundary', async () => {
  const adapter = new MLSignalAdapter(async () => [
    { model_version: 'v1', label: 'vulnerable', score: 1.2 },
  ]);
  const result = await adapter.predictFunctions([
    { ...functionReference, source: pythonFunction },
  ]);

  assert.equal(result.status, 'UNAVAILABLE');
  assert.equal(result.errorCode, 'INFERENCE_FAILED');
  assert.deepEqual(result.signals, []);
});
