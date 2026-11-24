import assert from "node:assert/strict";
import { test } from "node:test";
import { loadRepositoryHistories } from "../src/lib/repository-history";

const repositories = Array.from({ length: 11 }, (_, index) => ({
  id: `repository-${index + 1}`,
}));

test("a selected repository loads only its own history", async () => {
  const requested: string[] = [];
  const result = await loadRepositoryHistories(repositories, async (repositoryId) => {
    requested.push(repositoryId);
    return [`run-${repositoryId}`];
  }, "repository-7");

  assert.deepEqual(requested, ["repository-7"]);
  assert.deepEqual(result, [{
    repository: repositories[6],
    runs: ["run-repository-7"],
  }]);
});

test("all repositories load with bounded concurrency and repository order preserved", async () => {
  let activeRequests = 0;
  let maximumConcurrency = 0;
  const result = await loadRepositoryHistories(repositories, async (repositoryId) => {
    activeRequests += 1;
    maximumConcurrency = Math.max(maximumConcurrency, activeRequests);
    await new Promise((resolve) => setTimeout(resolve, 1));
    activeRequests -= 1;
    return [`run-${repositoryId}`];
  }, "ALL");

  assert.equal(maximumConcurrency, 4);
  assert.deepEqual(result.map(({ repository }) => repository.id), repositories.map(({ id }) => id));
  assert.equal(result.length, repositories.length);
});

test("an unavailable selection falls back to all repositories", async () => {
  const requested: string[] = [];
  const result = await loadRepositoryHistories(repositories, async (repositoryId) => {
    requested.push(repositoryId);
    return repositoryId;
  }, "repository-removed");

  assert.deepEqual(requested.sort(), repositories.map(({ id }) => id).sort());
  assert.equal(result.length, repositories.length);
});
