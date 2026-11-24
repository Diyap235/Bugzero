export interface RepositoryWithId {
  id: string;
}

export async function loadRepositoryHistories<
  TRepository extends RepositoryWithId,
  THistory,
>(
  repositories: TRepository[],
  loadHistory: (repositoryId: string) => Promise<THistory>,
  selectedRepositoryId: string,
  concurrency = 4,
): Promise<Array<{ repository: TRepository; runs: THistory }>> {
  const selectedRepository = repositories.find(({ id }) => id === selectedRepositoryId);
  if (selectedRepository) {
    return [{
      repository: selectedRepository,
      runs: await loadHistory(selectedRepository.id),
    }];
  }

  const results: Array<{ repository: TRepository; runs: THistory } | undefined> =
    new Array(repositories.length);
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(1, Math.floor(concurrency)), repositories.length);

  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < repositories.length) {
      const index = nextIndex;
      nextIndex += 1;
      const repository = repositories[index];
      results[index] = {
        repository,
        runs: await loadHistory(repository.id),
      };
    }
  }));

  return results.map((result) => {
    if (!result) throw new Error("A repository history was not loaded.");
    return result;
  });
}
