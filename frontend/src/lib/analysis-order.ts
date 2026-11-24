export function sortNewestFirst<T>(
  items: readonly T[],
  getTimestamp: (item: T) => string | null | undefined,
): T[] {
  return items
    .map((item, index) => {
      const timestamp = Date.parse(getTimestamp(item) ?? '');
      return { item, index, timestamp: Number.isFinite(timestamp) ? timestamp : 0 };
    })
    .sort((left, right) => right.timestamp - left.timestamp || left.index - right.index)
    .map(({ item }) => item);
}
