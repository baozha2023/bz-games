import { describe, expect, it, vi } from "vitest";
import {
  collectProcessTree,
  parseUnixProcessTable,
  parseWindowsProcessTable,
  ProcessTreeService,
} from "./ProcessTreeService";

describe("ProcessTreeService parsers", () => {
  it("parses Unix ps output", () => {
    expect(parseUnixProcessTable(" 42  1\n43 42\n44 43\ninvalid\n")).toEqual([
      { pid: 42, ppid: 1 },
      { pid: 43, ppid: 42 },
      { pid: 44, ppid: 43 },
    ]);
  });

  it("parses a single or multiple Windows CIM rows", () => {
    expect(
      parseWindowsProcessTable(
        JSON.stringify({ ProcessId: 42, ParentProcessId: 1 }),
      ),
    ).toEqual([{ pid: 42, ppid: 1 }]);
    expect(
      parseWindowsProcessTable(
        JSON.stringify([
          { ProcessId: 43, ParentProcessId: 42 },
          { processId: 44, parentProcessId: 43 },
        ]),
      ),
    ).toEqual([
      { pid: 43, ppid: 42 },
      { pid: 44, ppid: 43 },
    ]);
  });

  it("collects descendants recursively and ignores malformed records", () => {
    expect(
      collectProcessTree(
        [
          { pid: 42, ppid: 1 },
          { pid: 43, ppid: 42 },
          { pid: 44, ppid: 43 },
          { pid: 99, ppid: 7 },
          { pid: -1, ppid: 42 },
        ],
        42,
      ),
    ).toEqual(new Set([42, 43, 44]));
  });
});

describe("ProcessTreeService runtime operations", () => {
  it("recognizes a descendant after the root process exits", async () => {
    const run = vi.fn().mockResolvedValue("43 42\n");
    const service = new ProcessTreeService("linux", run);

    await expect(service.isTreeAlive(42, [42, 43])).resolves.toBe(true);
  });

  it("reports an empty tree as not alive", async () => {
    const run = vi.fn().mockResolvedValue("99 1\n");
    const service = new ProcessTreeService("linux", run);

    await expect(service.isTreeAlive(42, [42, 43])).resolves.toBe(false);
  });

  it("propagates process table command failures for the caller to retry", async () => {
    const run = vi.fn().mockRejectedValue(new Error("ps unavailable"));
    const service = new ProcessTreeService("linux", run);

    await expect(service.listTree(42)).rejects.toThrow("ps unavailable");
  });

  it("uses taskkill tree termination on Windows", async () => {
    const run = vi.fn().mockResolvedValue("");
    const service = new ProcessTreeService("win32", run);

    await service.killTree(42, [43, 44]);

    expect(run).toHaveBeenCalledWith(
      "taskkill.exe",
      ["/PID", "42", "/T", "/F"],
      expect.objectContaining({ windowsHide: true }),
    );
    expect(run).toHaveBeenCalledWith(
      "taskkill.exe",
      ["/PID", "43", "/F"],
      expect.objectContaining({ windowsHide: true }),
    );
  });
});
