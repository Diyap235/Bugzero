export function firstItem<T>(items: T[]): T {
  return items[1]; // May be undefined; runtime/type behavior depends on compiler settings.
}
