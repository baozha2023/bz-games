import fs from "node:fs/promises";
import os from "node:os";

import { sendJson } from "../utils/ws.js";
import { PORTAL_CAPABILITIES } from "./portal-authorization.js";

function cpuSnapshot(cpus) {
  return cpus.reduce(
    (total, cpu) => {
      const times = Object.values(cpu.times || {});
      total.idle += Number(cpu.times?.idle || 0);
      total.total += times.reduce((sum, value) => sum + Number(value || 0), 0);
      return total;
    },
    { idle: 0, total: 0 },
  );
}

export function calculateCpuUsage(previous, current) {
  if (!previous || !current) return 0;
  const total = current.total - previous.total;
  const idle = current.idle - previous.idle;
  if (total <= 0) return 0;
  return Math.max(0, Math.min(100, ((total - idle) / total) * 100));
}

export function parseLinuxNetworkTotals(value) {
  let receivedBytes = 0;
  let transmittedBytes = 0;
  for (const line of String(value || "")
    .split("\n")
    .slice(2)) {
    const [rawInterface, rawCounters] = line.split(":");
    const interfaceName = String(rawInterface || "").trim();
    if (!interfaceName || interfaceName === "lo" || !rawCounters) continue;
    const counters = rawCounters.trim().split(/\s+/).map(Number);
    if (counters.length < 9 || counters.some((item) => !Number.isFinite(item)))
      continue;
    receivedBytes += counters[0];
    transmittedBytes += counters[8];
  }
  return { receivedBytes, transmittedBytes };
}

export function createSystemMonitorService({
  config,
  state,
  accessControlService,
  mySqlService = null,
  osModule = os,
  fsModule = fs,
  now = () => Date.now(),
}) {
  let previousCpu = null;
  let previousNetwork = null;

  async function readNetworkTotals() {
    if (osModule.platform() !== "linux") {
      return { receivedBytes: 0, transmittedBytes: 0 };
    }
    try {
      return parseLinuxNetworkTotals(
        await fsModule.readFile("/proc/net/dev", "utf8"),
      );
    } catch {
      return { receivedBytes: 0, transmittedBytes: 0 };
    }
  }

  async function readDisk() {
    try {
      const stats = await fsModule.statfs(config.GAME_HOSTING_STORAGE_DIR);
      const blockSize = Number(stats.bsize || 0);
      const totalBytes = Number(stats.blocks || 0) * blockSize;
      const availableBytes = Number(stats.bavail || 0) * blockSize;
      const usedBytes = Math.max(0, totalBytes - availableBytes);
      return {
        totalBytes,
        usedBytes,
        usagePercent: totalBytes ? (usedBytes / totalBytes) * 100 : 0,
      };
    } catch {
      return {
        totalBytes: 0,
        usedBytes: 0,
        usagePercent: 0,
      };
    }
  }

  async function countOnlineUsers() {
    if (!mySqlService?.isEnabled?.()) return 0;
    try {
      const [rows] = await mySqlService.query(
        `SELECT COUNT(*) AS online_users
         FROM users
         WHERE is_online = 1
           AND last_online_at IS NOT NULL
           AND last_online_at >= DATE_SUB(NOW(3), INTERVAL 90 SECOND)`,
      );
      return Number(rows[0]?.online_users || 0);
    } catch {
      return 0;
    }
  }

  async function collect() {
    const sampledAt = now();
    const cpus = osModule.cpus();
    const currentCpu = cpuSnapshot(cpus);
    const usagePercent = calculateCpuUsage(previousCpu, currentCpu);
    previousCpu = currentCpu;

    const networkTotals = await readNetworkTotals();
    const elapsedSeconds = previousNetwork
      ? Math.max(0.001, (sampledAt - previousNetwork.sampledAt) / 1000)
      : 0;
    const receiveBytesPerSecond = elapsedSeconds
      ? Math.max(
          0,
          networkTotals.receivedBytes - previousNetwork.receivedBytes,
        ) / elapsedSeconds
      : 0;
    const transmitBytesPerSecond = elapsedSeconds
      ? Math.max(
          0,
          networkTotals.transmittedBytes - previousNetwork.transmittedBytes,
        ) / elapsedSeconds
      : 0;
    previousNetwork = { ...networkTotals, sampledAt };

    const totalMemory = osModule.totalmem();
    const availableMemory = osModule.freemem();
    const usedMemory = Math.max(0, totalMemory - availableMemory);
    const [disk, onlineUsers] = await Promise.all([
      readDisk(),
      countOnlineUsers(),
    ]);

    return {
      timestamp: new Date(sampledAt).toISOString(),
      cpu: {
        usagePercent,
      },
      memory: {
        totalBytes: totalMemory,
        usedBytes: usedMemory,
        usagePercent: totalMemory ? (usedMemory / totalMemory) * 100 : 0,
      },
      disk,
      network: {
        receiveBytesPerSecond,
        transmitBytesPerSecond,
      },
      rooms: {
        count: state.rooms.size,
        clients: state.clients.size,
        maxRooms: config.MAX_ROOMS,
        maxClients: config.MAX_CLIENTS,
      },
      onlineUsers,
      runtime: {
        processUptimeSeconds: process.uptime(),
      },
    };
  }

  async function handleRequest(req, res, url) {
    if (
      req.method !== "GET" ||
      url.pathname !== "/api/portal/v1/system-monitor"
    ) {
      return false;
    }
    if (
      !(await accessControlService.requireCapability(
        req,
        res,
        PORTAL_CAPABILITIES.SYSTEM_MONITOR_VIEW,
      ))
    ) {
      return true;
    }
    sendJson(res, 200, await collect());
    return true;
  }

  return { collect, handleRequest };
}
