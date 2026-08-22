import { sendJson } from "../utils/ws.js";
import { requireHttpRelayToken } from "../utils/relay-auth.js";

const MAX_PRESENCE_BODY_BYTES = 1024;
const ONLINE_TIMEOUT_MS = 90_000;
const CLEANUP_INTERVAL_MS = 30_000;

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let exceeded = false;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_PRESENCE_BODY_BYTES) {
        exceeded = true;
        return;
      }
      chunks.push(chunk);
    });
    req.once("end", () => {
      if (exceeded) {
        reject(new Error("request_too_large"));
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new Error("invalid_json"));
      }
    });
    req.once("error", reject);
    req.once("aborted", () => reject(new Error("request_aborted")));
  });
}

function toIso(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function isEffectivelyOnline(row, now = Date.now()) {
  if (!row?.is_online || !row.last_online_at) return false;
  const lastOnlineAt = new Date(row.last_online_at).getTime();
  return (
    Number.isFinite(lastOnlineAt) &&
    lastOnlineAt <= now &&
    now - lastOnlineAt <= ONLINE_TIMEOUT_MS
  );
}

function serializePresence(row) {
  return {
    isOnline: isEffectivelyOnline(row),
    lastOnlineAt: toIso(row.last_online_at),
  };
}

export function createPresenceService({ config, authService, mySqlService }) {
  let cleanupTimer = null;

  async function requireAuth(req, res) {
    if (!mySqlService.isEnabled()) {
      sendJson(res, 503, { error: "user_storage_not_configured" });
      return null;
    }
    const resolution = await authService.getClientSessionFromRequest(req);
    if (resolution.status !== "authenticated") {
      authService.sendAuthFailure(res, resolution.status);
      return null;
    }
    return resolution.auth;
  }

  async function updatePresence(req, res) {
    const auth = await requireAuth(req, res);
    if (!auth) return true;

    let body;
    try {
      body = await readJson(req);
    } catch (error) {
      sendJson(res, error.message === "request_too_large" ? 413 : 400, {
        error: error.message,
      });
      return true;
    }

    if (
      !body ||
      typeof body !== "object" ||
      Array.isArray(body) ||
      Object.keys(body).length !== 1 ||
      typeof body.online !== "boolean"
    ) {
      sendJson(res, 400, { error: "invalid_presence" });
      return true;
    }

    await mySqlService.ensureReady();
    if (body.online) {
      await mySqlService.query(
        "UPDATE users SET is_online = 1, last_online_at = ? WHERE id = ?",
        [new Date(), auth.user.id],
      );
    } else {
      await mySqlService.query("UPDATE users SET is_online = 0 WHERE id = ?", [
        auth.user.id,
      ]);
    }

    const [rows] = await mySqlService.query(
      "SELECT is_online, last_online_at FROM users WHERE id = ? LIMIT 1",
      [auth.user.id],
    );
    sendJson(res, 200, {
      ok: true,
      presence: serializePresence(rows[0] || { is_online: 0 }),
    });
    return true;
  }

  async function cleanupStaleUsers() {
    if (!mySqlService.isEnabled()) return;
    await mySqlService.query(
      `UPDATE users
       SET is_online = 0
       WHERE is_online = 1
         AND (last_online_at IS NULL OR last_online_at < DATE_SUB(NOW(3), INTERVAL 90 SECOND))`,
    );
  }

  function start() {
    if (cleanupTimer || !mySqlService.isEnabled()) return;
    void cleanupStaleUsers().catch((error) => {
      console.error("[presence] initial stale-user cleanup failed", error);
    });
    cleanupTimer = setInterval(() => {
      void cleanupStaleUsers().catch((error) => {
        console.error("[presence] stale-user cleanup failed", error);
      });
    }, CLEANUP_INTERVAL_MS);
    cleanupTimer.unref();
  }

  function stop() {
    if (!cleanupTimer) return;
    clearInterval(cleanupTimer);
    cleanupTimer = null;
  }

  async function handleRequest(req, res, url) {
    if (req.method === "PUT" && url.pathname === "/api/v1/me/presence") {
      if (!requireHttpRelayToken(config, req, res, url)) return true;
      return updatePresence(req, res);
    }
    return false;
  }

  return { handleRequest, start, stop, cleanupStaleUsers };
}

export { ONLINE_TIMEOUT_MS, isEffectivelyOnline };
