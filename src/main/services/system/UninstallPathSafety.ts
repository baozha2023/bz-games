import path from "path";

function isSamePath(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function containsPath(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
}

export function normalizeUninstallStorageRoots(
  roots: string[],
  installDir: string,
  protectedPaths: string[],
): string[] {
  const normalizedInstallDir = path.resolve(installDir);
  const normalizedProtected = protectedPaths.map((item) => path.resolve(item));
  const result: string[] = [];

  for (const value of roots) {
    if (typeof value !== "string" || !value.trim()) continue;
    const root = path.resolve(value.trim());
    if (
      isSamePath(root, path.parse(root).root) ||
      containsPath(root, normalizedInstallDir) ||
      normalizedProtected.some((item) => containsPath(root, item))
    ) {
      throw new Error("unsafe_game_storage_path");
    }
    if (!result.some((item) => isSamePath(item, root))) result.push(root);
  }
  return result;
}
