import assert from "node:assert/strict";
import test from "node:test";

import {
  calculateCpuUsage,
  createSystemMonitorService,
  parseLinuxNetworkTotals,
} from "../src/services/system-monitor-service.js";

test("system monitor calculates CPU and Linux network deltas", async () => {
  assert.equal(
    calculateCpuUsage({ idle: 50, total: 100 }, { idle: 70, total: 200 }),
    80,
  );
  assert.deepEqual(
    parseLinuxNetworkTotals(
      "Inter-| Receive | Transmit\n face |bytes |bytes\n lo: 100 0 0 0 0 0 0 0 200\n eth0: 300 0 0 0 0 0 0 0 500",
    ),
    { receivedBytes: 300, transmittedBytes: 500 },
  );

  let time = 1_000;
  let network =
    "Inter-| Receive | Transmit\n face |bytes |bytes\n eth0: 100 0 0 0 0 0 0 0 200";
  const service = createSystemMonitorService({
    config: {
      GAME_HOSTING_STORAGE_DIR: "/storage",
      MAX_ROOMS: 80,
      MAX_CLIENTS: 400,
    },
    state: {
      rooms: new Map([["room", {}]]),
      clients: new Map([["client", {}]]),
      getEventLoopDelayMs: () => 2,
    },
    accessControlService: {},
    mySqlService: {
      isEnabled: () => true,
      query: async () => [[{ online_users: 3 }]],
    },
    now: () => time,
    osModule: {
      platform: () => "linux",
      cpus: () => [{ times: { idle: 50, user: 50 } }],
      totalmem: () => 1_000,
      freemem: () => 400,
      loadavg: () => [1, 2, 3],
      uptime: () => 100,
    },
    fsModule: {
      readFile: async () => network,
      statfs: async () => ({ bsize: 10, blocks: 100, bavail: 40 }),
    },
  });
  await service.collect();
  time = 6_000;
  network =
    "Inter-| Receive | Transmit\n face |bytes |bytes\n eth0: 600 0 0 0 0 0 0 0 1200";
  const result = await service.collect();
  assert.equal(result.network.receiveBytesPerSecond, 100);
  assert.equal(result.network.transmitBytesPerSecond, 200);
  assert.equal(result.disk.usagePercent, 60);
  assert.equal(result.rooms.count, 1);
  assert.equal(result.rooms.clients, 1);
  assert.equal(result.rooms.maxClients, 400);
  assert.equal(result.onlineUsers, 3);
  assert.equal(Number.isFinite(result.runtime.processUptimeSeconds), true);
});

test("system monitor endpoint requires its super-administrator capability", async () => {
  let allowed = false;
  let requiredCapability = "";
  const service = createSystemMonitorService({
    config: {
      GAME_HOSTING_STORAGE_DIR: "/storage",
      MAX_ROOMS: 80,
      MAX_CLIENTS: 400,
    },
    state: {
      rooms: new Map(),
      clients: new Map(),
      getEventLoopDelayMs: () => 0,
    },
    accessControlService: {
      requireCapability: async (_req, _res, capability) => {
        requiredCapability = capability;
        return allowed ? { user: { role: "super_administrator" } } : null;
      },
    },
    osModule: {
      platform: () => "linux",
      cpus: () => [{ times: { idle: 1, user: 1 } }],
      totalmem: () => 1,
      freemem: () => 1,
      loadavg: () => [0, 0, 0],
      uptime: () => 1,
    },
    fsModule: {
      readFile: async () => "",
      statfs: async () => ({ bsize: 1, blocks: 1, bavail: 1 }),
    },
  });
  const response = { writeHead() {}, end() {} };
  const request = { method: "GET" };
  const url = { pathname: "/api/portal/v1/system-monitor" };
  assert.equal(await service.handleRequest(request, response, url), true);
  assert.equal(requiredCapability, "system.monitor.view");
  allowed = true;
  assert.equal(await service.handleRequest(request, response, url), true);
});
