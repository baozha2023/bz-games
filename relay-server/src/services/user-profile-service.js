import { sendJson } from "../utils/ws.js";
import { requireHttpRelayToken } from "../utils/relay-auth.js";

const MAX_PROFILE_BODY_BYTES = 4096;
const NICKNAME_PATTERN = /^[^<>"'`&\\/]+$/;

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let exceeded = false;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_PROFILE_BODY_BYTES) {
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

function parseNickname(value) {
  if (typeof value !== "string") return "";
  const nickname = value.trim();
  if (
    !nickname ||
    nickname.length > 16 ||
    !NICKNAME_PATTERN.test(nickname)
  ) {
    return "";
  }
  return nickname;
}

export function createUserProfileService({ config, authService, mySqlService }) {
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

  async function updateProfile(req, res) {
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
      Object.keys(body).length !== 1
    ) {
      sendJson(res, 400, { error: "invalid_profile" });
      return true;
    }

    const nickname = parseNickname(body.nickname);
    if (!nickname) {
      sendJson(res, 400, { error: "invalid_nickname" });
      return true;
    }

    await mySqlService.ensureReady();
    const updatedAt = new Date();
    await mySqlService.query(
      "UPDATE users SET nickname = ?, updated_at = ? WHERE id = ?",
      [nickname, updatedAt, auth.user.id],
    );
    sendJson(res, 200, {
      ok: true,
      user: {
        id: String(auth.user.id),
        nickname,
      },
    });
    return true;
  }

  async function handleRequest(req, res, url) {
    if (req.method === "PATCH" && url.pathname === "/api/v1/me/profile") {
      if (!requireHttpRelayToken(config, req, res, url)) return true;
      return updateProfile(req, res);
    }
    return false;
  }

  return { handleRequest };
}
