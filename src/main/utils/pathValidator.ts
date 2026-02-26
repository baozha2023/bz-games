import path from "path";

export function isSafePath(base: string, target: string): boolean {
  const resolved = path.resolve(base, target);
  return resolved.startsWith(path.resolve(base));
}
