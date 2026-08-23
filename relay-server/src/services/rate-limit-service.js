import crypto from "node:crypto";

const MAX_GITHUB_ID_LENGTH = 64;
const MAX_ENDPOINT_KEY_LENGTH = 128;
const MIN_RESERVATION_TTL_MS = 1_000;

export class RateLimitError extends Error {
  constructor(code, cause) {
    super(code, cause ? { cause } : undefined);
    this.name = "RateLimitError";
    this.code = code;
  }
}

function normalizeGithubId(value) {
  const githubId =
    typeof value === "string" ? value.trim() : String(value || "").trim();
  if (!githubId || githubId.length > MAX_GITHUB_ID_LENGTH) {
    throw new RateLimitError("invalid_rate_limit_identity");
  }
  return githubId;
}

function normalizeEndpointKey(value) {
  const endpointKey = typeof value === "string" ? value.trim() : "";
  if (
    !/^[a-z][a-z0-9._-]*$/.test(endpointKey) ||
    endpointKey.length > MAX_ENDPOINT_KEY_LENGTH
  ) {
    throw new RateLimitError("invalid_rate_limit_endpoint");
  }
  return endpointKey;
}

function normalizeCooldown(value) {
  const cooldownMs = Number(value);
  if (!Number.isFinite(cooldownMs) || cooldownMs < 0) {
    throw new RateLimitError("invalid_rate_limit_cooldown");
  }
  return cooldownMs;
}

function normalizeNow(value) {
  const now = value instanceof Date ? value : new Date(value || Date.now());
  if (Number.isNaN(now.getTime())) {
    throw new RateLimitError("invalid_rate_limit_time");
  }
  return now;
}

function toMillis(value) {
  if (!value) return null;
  const millis =
    value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(millis) ? millis : null;
}

function retryResult(resetAt, now) {
  const resetMillis = resetAt.getTime();
  return {
    ok: false,
    retryAfterSeconds: Math.max(
      1,
      Math.ceil((resetMillis - now.getTime()) / 1000),
    ),
    resetAt: resetAt.toISOString(),
  };
}

function isStorageError(error) {
  return !(error instanceof RateLimitError);
}

export function createRateLimitService({
  mySqlService,
  reservationTtlMs = 5 * 60 * 1000,
}) {
  const ttl = Math.max(MIN_RESERVATION_TTL_MS, Number(reservationTtlMs));
  if (!Number.isFinite(ttl)) {
    throw new RateLimitError("invalid_rate_limit_reservation_ttl");
  }

  async function selectRecord(connection, githubId, endpointKey) {
    const [rows] = await connection.query(
      `SELECT github_id, endpoint_key, last_success_at,
              reservation_token, reservation_expires_at
       FROM rate_limit_records
       WHERE github_id = ? AND endpoint_key = ?
       LIMIT 1
       FOR UPDATE`,
      [githubId, endpointKey],
    );
    return rows[0] || null;
  }

  async function ensureRecord(connection, githubId, endpointKey, now) {
    await connection.query(
      `INSERT INTO rate_limit_records
         (github_id, endpoint_key, last_success_at, reservation_token,
          reservation_expires_at, created_at, updated_at)
       VALUES (?, ?, NULL, NULL, NULL, ?, ?)
       ON DUPLICATE KEY UPDATE github_id = github_id`,
      [githubId, endpointKey, now, now],
    );
  }

  async function reserve({ githubId, endpointKey, cooldownMs, now } = {}) {
    const identity = normalizeGithubId(githubId);
    const endpoint = normalizeEndpointKey(endpointKey);
    const cooldown = normalizeCooldown(cooldownMs);
    const currentTime = normalizeNow(now);
    const token = crypto.randomUUID();
    const reservationExpiresAt = new Date(currentTime.getTime() + ttl);

    try {
      return await mySqlService.transaction(async (connection) => {
        await ensureRecord(connection, identity, endpoint, currentTime);
        const record = await selectRecord(connection, identity, endpoint);
        const pendingExpiresAt = toMillis(record.reservation_expires_at);
        if (
          pendingExpiresAt !== null &&
          pendingExpiresAt > currentTime.getTime()
        ) {
          return retryResult(new Date(pendingExpiresAt), currentTime);
        }

        const lastSuccessAt = toMillis(record.last_success_at);
        if (
          lastSuccessAt !== null &&
          lastSuccessAt + cooldown > currentTime.getTime()
        ) {
          return retryResult(new Date(lastSuccessAt + cooldown), currentTime);
        }

        await connection.query(
          `UPDATE rate_limit_records
           SET reservation_token = ?, reservation_expires_at = ?, updated_at = ?
           WHERE github_id = ? AND endpoint_key = ?`,
          [token, reservationExpiresAt, currentTime, identity, endpoint],
        );
        return { ok: true, token };
      });
    } catch (error) {
      if (error instanceof RateLimitError) throw error;
      throw new RateLimitError("rate_limit_storage_failed", error);
    }
  }

  async function commit({
    githubId,
    endpointKey,
    token,
    now,
    connection,
  } = {}) {
    const identity = normalizeGithubId(githubId);
    const endpoint = normalizeEndpointKey(endpointKey);
    const reservationToken = typeof token === "string" ? token.trim() : "";
    if (!reservationToken) {
      throw new RateLimitError("invalid_rate_limit_reservation");
    }
    const currentTime = normalizeNow(now);

    const commitOnConnection = async (activeConnection) => {
      const record = await selectRecord(activeConnection, identity, endpoint);
      if (!record || record.reservation_token !== reservationToken)
        return false;
      const [result] = await activeConnection.query(
        `UPDATE rate_limit_records
         SET last_success_at = ?, reservation_token = NULL,
             reservation_expires_at = NULL, updated_at = ?
         WHERE github_id = ? AND endpoint_key = ? AND reservation_token = ?`,
        [currentTime, currentTime, identity, endpoint, reservationToken],
      );
      return result.affectedRows === 1;
    };

    try {
      return connection
        ? await commitOnConnection(connection)
        : await mySqlService.transaction(commitOnConnection);
    } catch (error) {
      if (error instanceof RateLimitError) throw error;
      throw new RateLimitError("rate_limit_storage_failed", error);
    }
  }

  async function release({ githubId, endpointKey, token, connection } = {}) {
    const identity = normalizeGithubId(githubId);
    const endpoint = normalizeEndpointKey(endpointKey);
    const reservationToken = typeof token === "string" ? token.trim() : "";
    if (!reservationToken) return false;

    const releaseOnConnection = async (activeConnection) => {
      const [result] = await activeConnection.query(
        `UPDATE rate_limit_records
         SET reservation_token = NULL, reservation_expires_at = NULL,
             updated_at = ?
         WHERE github_id = ? AND endpoint_key = ? AND reservation_token = ?`,
        [new Date(), identity, endpoint, reservationToken],
      );
      return result.affectedRows === 1;
    };

    try {
      return connection
        ? await releaseOnConnection(connection)
        : await mySqlService.transaction(releaseOnConnection);
    } catch (error) {
      if (isStorageError(error)) {
        throw new RateLimitError("rate_limit_storage_failed", error);
      }
      throw error;
    }
  }

  return { reserve, commit, release };
}
