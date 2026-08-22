import { execFile, type ExecFileOptions } from "child_process";

export interface ProcessTreeRecord {
  pid: number;
  ppid: number;
}

export type ProcessCommandRunner = (
  file: string,
  args: string[],
  options: ExecFileOptions,
) => Promise<string>;

const PROCESS_COMMAND_TIMEOUT_MS = 5_000;
const PROCESS_COMMAND_MAX_BUFFER = 4 * 1024 * 1024;

function runCommand(
  file: string,
  args: string[],
  options: ExecFileOptions,
): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(file, args, options, (error, stdout) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(stdout.toString());
    });
  });
}

function assertValidPid(pid: number): void {
  if (!Number.isInteger(pid) || pid <= 0) {
    throw new Error(`Invalid process id: ${pid}`);
  }
}

export function parseUnixProcessTable(output: string): ProcessTreeRecord[] {
  const records: ProcessTreeRecord[] = [];
  for (const line of output.split(/\r?\n/)) {
    const match = line.trim().match(/^(\d+)\s+(\d+)$/);
    if (!match) continue;
    records.push({ pid: Number(match[1]), ppid: Number(match[2]) });
  }
  return records;
}

export function parseWindowsProcessTable(output: string): ProcessTreeRecord[] {
  if (!output.trim()) return [];

  const parsed: unknown = JSON.parse(output);
  const rows = Array.isArray(parsed) ? parsed : [parsed];
  const records: ProcessTreeRecord[] = [];

  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const value = row as Record<string, unknown>;
    const pid = Number(value.ProcessId ?? value.processId);
    const ppid = Number(value.ParentProcessId ?? value.parentProcessId);
    if (!Number.isInteger(pid) || pid <= 0) continue;
    if (!Number.isInteger(ppid) || ppid < 0) continue;
    records.push({ pid, ppid });
  }

  return records;
}

export function collectProcessTree(
  records: readonly ProcessTreeRecord[],
  rootPid: number,
): Set<number> {
  assertValidPid(rootPid);

  const childrenByParent = new Map<number, number[]>();
  for (const record of records) {
    if (!Number.isInteger(record.pid) || record.pid <= 0) continue;
    if (!Number.isInteger(record.ppid) || record.ppid < 0) continue;
    const children = childrenByParent.get(record.ppid) || [];
    children.push(record.pid);
    childrenByParent.set(record.ppid, children);
  }

  const tree = new Set<number>();
  const pending = [rootPid];
  while (pending.length > 0) {
    const pid = pending.pop();
    if (pid === undefined || tree.has(pid)) continue;
    tree.add(pid);
    for (const childPid of childrenByParent.get(pid) || []) {
      if (!tree.has(childPid)) pending.push(childPid);
    }
  }
  return tree;
}

export class ProcessTreeService {
  constructor(
    private readonly platform: NodeJS.Platform = process.platform,
    private readonly run: ProcessCommandRunner = runCommand,
  ) {}

  async listTree(rootPid: number): Promise<Set<number>> {
    const records = await this.listProcessRecords();
    const tree = collectProcessTree(records, rootPid);
    const knownPids = new Set(records.map((record) => record.pid));
    for (const pid of Array.from(tree)) {
      if (!knownPids.has(pid)) tree.delete(pid);
    }
    return tree;
  }

  async isTreeAlive(
    rootPid: number,
    knownPids: Iterable<number>,
  ): Promise<boolean> {
    assertValidPid(rootPid);
    const records = await this.listProcessRecords();
    const livePids = new Set(records.map((record) => record.pid));
    const liveTree = collectProcessTree(records, rootPid);
    for (const pid of liveTree) {
      if (livePids.has(pid)) return true;
    }
    for (const pid of knownPids) {
      if (Number.isInteger(pid) && pid > 0 && livePids.has(pid)) return true;
    }
    return false;
  }

  async killTree(rootPid: number, knownPids: Iterable<number>): Promise<void> {
    assertValidPid(rootPid);
    const pids = new Set<number>([rootPid]);
    for (const pid of knownPids) {
      if (Number.isInteger(pid) && pid > 0) pids.add(pid);
    }

    if (this.platform === "win32") {
      await Promise.all([
        this.run("taskkill.exe", ["/PID", String(rootPid), "/T", "/F"], {
          windowsHide: true,
          timeout: PROCESS_COMMAND_TIMEOUT_MS,
        }).catch(() => ""),
        ...Array.from(pids)
          .filter((pid) => pid !== rootPid)
          .map((pid) =>
            this.run("taskkill.exe", ["/PID", String(pid), "/F"], {
              windowsHide: true,
              timeout: PROCESS_COMMAND_TIMEOUT_MS,
            }).catch(() => ""),
          ),
      ]);
      return;
    }

    try {
      process.kill(-rootPid, "SIGTERM");
    } catch {}

    for (const pid of pids) {
      if (pid === rootPid) continue;
      try {
        process.kill(pid, "SIGTERM");
      } catch {}
    }
  }

  private async listProcessRecords(): Promise<ProcessTreeRecord[]> {
    const output = await this.run(
      this.platform === "win32" ? "powershell.exe" : "ps",
      this.platform === "win32"
        ? [
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            "$ErrorActionPreference='Stop'; Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId | ConvertTo-Json -Compress",
          ]
        : ["-axo", "pid=,ppid="],
      {
        windowsHide: true,
        timeout: PROCESS_COMMAND_TIMEOUT_MS,
        maxBuffer: PROCESS_COMMAND_MAX_BUFFER,
      },
    );

    return this.platform === "win32"
      ? parseWindowsProcessTable(output)
      : parseUnixProcessTable(output);
  }
}

export const processTreeService = new ProcessTreeService();
