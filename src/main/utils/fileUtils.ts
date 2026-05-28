import fs from "fs";
import path from "path";

/**
 * Manually copy a folder recursively to avoid fs.cpSync issues with non-ASCII paths or specific file systems.
 */
export function copyFolderRecursiveSync(source: string, target: string) {
  const prevNoAsar = process.noAsar;
  process.noAsar = true;
  try {
    if (!fs.existsSync(target)) {
      fs.mkdirSync(target, { recursive: true });
    }

    const srcStat = fs.lstatSync(source);
    if (!srcStat.isDirectory()) {
      throw Object.assign(
        new Error(`ENOTDIR: not a directory, copy '${source}'`),
        { code: "ENOTDIR" },
      );
    }

    const files = fs.readdirSync(source);
    for (const file of files) {
      const curSource = path.join(source, file);
      const curTarget = path.join(target, file);
      if (fs.lstatSync(curSource).isDirectory()) {
        copyFolderRecursiveSync(curSource, curTarget);
      } else {
        fs.copyFileSync(curSource, curTarget);
      }
    }
  } finally {
    process.noAsar = prevNoAsar;
  }
}
