import { afterEach, describe, expect, it } from "vitest";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { copyFolderRecursive, type FolderCopyProgress } from "./fileUtils";

const tempDirectories: string[] = [];

async function makeTempDirectory(): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "bz-copy-test-"));
  tempDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    tempDirectories
      .splice(0)
      .map((directory) => fs.rm(directory, { recursive: true, force: true })),
  );
});

describe("copyFolderRecursive", () => {
  it("copies nested and empty directories while reporting byte progress", async () => {
    const root = await makeTempDirectory();
    const source = path.join(root, "source");
    const target = path.join(root, "target");
    await fs.mkdir(path.join(source, "nested", "empty"), { recursive: true });
    await fs.writeFile(path.join(source, "first.bin"), Buffer.alloc(1024, 1));
    await fs.writeFile(
      path.join(source, "nested", "second.bin"),
      Buffer.alloc(2048, 2),
    );
    const events: FolderCopyProgress[] = [];

    await copyFolderRecursive(source, target, {
      onProgress: (progress) => events.push({ ...progress }),
    });

    expect(await fs.readFile(path.join(target, "first.bin"))).toEqual(
      Buffer.alloc(1024, 1),
    );
    expect(
      await fs.readFile(path.join(target, "nested", "second.bin")),
    ).toEqual(Buffer.alloc(2048, 2));
    expect(
      (await fs.stat(path.join(target, "nested", "empty"))).isDirectory(),
    ).toBe(true);
    const final = events.at(-1)!;
    expect(final.phase).toBe("copying");
    expect(final.processedBytes).toBe(3072);
    expect(final.totalBytes).toBe(3072);
    expect(final.processedFiles).toBe(2);
  });

  it("aborts an active stream copy", async () => {
    const root = await makeTempDirectory();
    const source = path.join(root, "source");
    const target = path.join(root, "target");
    await fs.mkdir(source, { recursive: true });
    await fs.writeFile(
      path.join(source, "large.bin"),
      Buffer.alloc(20 * 1024 * 1024),
    );
    const controller = new AbortController();

    await expect(
      copyFolderRecursive(source, target, {
        signal: controller.signal,
        onProgress: (progress) => {
          if (progress.phase === "copying" && progress.processedBytes > 0) {
            controller.abort();
          }
        },
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  it("waits for in-flight native copies before returning an abort", async () => {
    const root = await makeTempDirectory();
    const source = path.join(root, "source");
    const target = path.join(root, "target");
    await fs.mkdir(source, { recursive: true });
    await Promise.all(
      Array.from({ length: 40 }, (_, index) =>
        fs.writeFile(
          path.join(source, `${index}.bin`),
          Buffer.alloc(1024 * 1024),
        ),
      ),
    );
    const controller = new AbortController();
    let abortScheduled = false;

    await expect(
      copyFolderRecursive(source, target, {
        signal: controller.signal,
        onProgress: (progress) => {
          if (progress.phase === "copying" && !abortScheduled) {
            abortScheduled = true;
            setTimeout(() => controller.abort(), 1);
          }
        },
      }),
    ).rejects.toMatchObject({ name: "AbortError" });

    const countAfterAbort = (await fs.readdir(target)).length;
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(await fs.readdir(target)).toHaveLength(countAfterAbort);
    expect(countAfterAbort).toBeLessThan(40);
  });

  it("rejects symbolic links instead of copying outside the source tree", async () => {
    const root = await makeTempDirectory();
    const source = path.join(root, "source");
    const outside = path.join(root, "outside");
    const target = path.join(root, "target");
    await fs.mkdir(source, { recursive: true });
    await fs.mkdir(outside, { recursive: true });
    await fs.writeFile(path.join(outside, "secret.txt"), "outside");
    await fs.symlink(
      outside,
      path.join(source, "linked"),
      process.platform === "win32" ? "junction" : "dir",
    );

    await expect(copyFolderRecursive(source, target)).rejects.toMatchObject({
      code: "symbolicLinkUnsupported",
    });
  });

  it("coalesces scan progress for directories containing many files", async () => {
    const root = await makeTempDirectory();
    const source = path.join(root, "source");
    const target = path.join(root, "target");
    await fs.mkdir(source, { recursive: true });
    await Promise.all(
      Array.from({ length: 250 }, (_, index) =>
        fs.writeFile(path.join(source, `${index}.txt`), "x"),
      ),
    );
    const scanEvents: FolderCopyProgress[] = [];

    await copyFolderRecursive(source, target, {
      onProgress: (progress) => {
        if (progress.phase === "scanning") scanEvents.push({ ...progress });
      },
    });

    expect(scanEvents.length).toBeLessThan(10);
    expect(scanEvents.at(-1)).toMatchObject({
      processedFiles: 250,
      totalFiles: 250,
    });
  });
});
