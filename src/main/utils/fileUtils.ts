import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import { pipeline } from "stream/promises";

export interface FolderCopyProgress {
  phase: "scanning" | "copying";
  processedBytes: number;
  totalBytes: number;
  processedFiles: number;
  totalFiles: number;
}

interface CopyEntry {
  source: string;
  relativePath: string;
  size: number;
}

const DIRECTORY_SCAN_CONCURRENCY = 16;
const FILE_STAT_CONCURRENCY = 64;
const SMALL_FILE_COPY_CONCURRENCY = 8;
const STREAM_COPY_THRESHOLD = 16 * 1024 * 1024;

async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  let firstError: unknown;
  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (cursor < items.length && firstError === undefined) {
        const item = items[cursor++];
        try {
          await worker(item);
        } catch (error) {
          firstError ??= error;
        }
      }
    },
  );
  await Promise.all(workers);
  if (firstError !== undefined) throw firstError;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw Object.assign(new Error("Import canceled"), { name: "AbortError" });
  }
}

export async function copyFolderRecursive(
  source: string,
  target: string,
  options: {
    signal?: AbortSignal;
    onProgress?: (progress: FolderCopyProgress) => void;
  } = {},
): Promise<void> {
  const files: CopyEntry[] = [];
  const directories: string[] = [""];
  const candidates: Array<{ source: string; relativePath: string }> = [];
  let totalBytes = 0;
  let scannedFiles = 0;
  let lastScanReportAt = 0;

  const sourceStat = await fsp.stat(source);
  if (!sourceStat.isDirectory()) {
    throw Object.assign(
      new Error(`ENOTDIR: not a directory, copy '${source}'`),
      {
        code: "ENOTDIR",
      },
    );
  }

  const reportScan = (force = false) => {
    const timestamp = Date.now();
    if (!force && timestamp - lastScanReportAt < 100) return;
    lastScanReportAt = timestamp;
    options.onProgress?.({
      phase: "scanning",
      processedBytes: totalBytes,
      totalBytes,
      processedFiles: scannedFiles,
      totalFiles: candidates.length,
    });
  };

  let directoryCursor = 0;
  while (directoryCursor < directories.length) {
    throwIfAborted(options.signal);
    const batch = directories.slice(
      directoryCursor,
      directoryCursor + DIRECTORY_SCAN_CONCURRENCY,
    );
    directoryCursor += batch.length;
    const listings = await Promise.all(
      batch.map(async (relativeDirectory) => ({
        relativeDirectory,
        entries: await fsp.readdir(path.join(source, relativeDirectory), {
          withFileTypes: true,
        }),
      })),
    );
    for (const { relativeDirectory, entries } of listings) {
      for (const entry of entries) {
        const relativePath = path.join(relativeDirectory, entry.name);
        if (entry.isDirectory()) {
          directories.push(relativePath);
        } else if (entry.isSymbolicLink()) {
          throw Object.assign(
            new Error(`Symbolic links are not supported: ${relativePath}`),
            {
              code: "symbolicLinkUnsupported",
              params: { file: relativePath },
            },
          );
        } else if (entry.isFile()) {
          candidates.push({
            source: path.join(source, relativePath),
            relativePath,
          });
        }
      }
    }
  }

  await runWithConcurrency(
    candidates,
    FILE_STAT_CONCURRENCY,
    async (candidate) => {
      throwIfAborted(options.signal);
      const stat = await fsp.lstat(candidate.source);
      if (stat.isFile()) {
        files.push({ ...candidate, size: stat.size });
        totalBytes += stat.size;
      }
      scannedFiles += 1;
      reportScan();
    },
  );
  reportScan(true);

  throwIfAborted(options.signal);

  await runWithConcurrency(
    directories,
    DIRECTORY_SCAN_CONCURRENCY,
    async (directory) => {
      throwIfAborted(options.signal);
      await fsp.mkdir(path.join(target, directory), { recursive: true });
    },
  );

  let processedBytes = 0;
  let processedFiles = 0;
  let lastCopyReportAt = 0;
  const reportCopy = (force = false) => {
    const timestamp = Date.now();
    if (!force && timestamp - lastCopyReportAt < 50) return;
    lastCopyReportAt = timestamp;
    options.onProgress?.({
      phase: "copying",
      processedBytes,
      totalBytes,
      processedFiles,
      totalFiles: files.length,
    });
  };
  reportCopy(true);

  const copyNative = async (file: CopyEntry) => {
    throwIfAborted(options.signal);
    await fsp.copyFile(file.source, path.join(target, file.relativePath));
    processedBytes += file.size;
    processedFiles += 1;
    reportCopy();
    throwIfAborted(options.signal);
  };
  const copyStream = async (file: CopyEntry) => {
    throwIfAborted(options.signal);
    const destination = path.join(target, file.relativePath);
    const readStream = fs.createReadStream(file.source);
    readStream.on("data", (chunk) => {
      processedBytes += Buffer.isBuffer(chunk) ? chunk.length : 0;
      reportCopy();
    });
    await pipeline(readStream, fs.createWriteStream(destination), {
      signal: options.signal,
    });
    processedFiles += 1;
    reportCopy();
  };

  const smallFiles = files.filter((file) => file.size < STREAM_COPY_THRESHOLD);
  const largeFiles = files.filter((file) => file.size >= STREAM_COPY_THRESHOLD);
  await runWithConcurrency(smallFiles, SMALL_FILE_COPY_CONCURRENCY, copyNative);
  for (const file of largeFiles) {
    await copyStream(file);
  }
  reportCopy(true);
  throwIfAborted(options.signal);
}

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
