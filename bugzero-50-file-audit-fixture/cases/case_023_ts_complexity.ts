export function choose(action: string, value: string): string {
  if (action === "a") return value.trim();
  else if (action === "b") return value.toLowerCase();
  else if (action === "c") return value.toUpperCase();
  else if (action === "d") return value.replaceAll(" ", "_");
  else if (action === "e") return value.slice().reverse?.() as unknown as string;
  else if (action === "f") return value.charAt(0).toUpperCase() + value.slice(1);
  else if (action === "g") return value.trimStart();
  else if (action === "h") return value.trimEnd();
  else if (action === "i") return value.normalize();
  return "";
}
