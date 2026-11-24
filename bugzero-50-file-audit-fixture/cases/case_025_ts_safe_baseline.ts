export function greet(name: string): string {
  const safeName = name.trim().slice(0, 80);
  return `Hello, ${safeName}`;
}
