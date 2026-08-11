import { sendJson } from "../utils/ws.js";
import {
  ASSIGNABLE_PORTAL_ROLES,
  PORTAL_CAPABILITIES,
} from "./portal-authorization.js";

const MAX_ROLE_BODY_BYTES = 4096;
const MAX_USER_ID = 18_446_744_073_709_551_615n;

function escapeLike(value) {
  return value.replace(/[\\%_]/g, "\\$&");
}

function githubProfileUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:" && url.hostname === "github.com"
      ? url.toString()
      : "";
  } catch {
    return "";
  }
}

function parseUserId(value) {
  if (!/^[1-9]\d{0,19}$/.test(value)) return "";
  try {
    return BigInt(value) <= MAX_USER_ID ? value : "";
  } catch {
    return "";
  }
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let exceeded = false;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_ROLE_BODY_BYTES) {
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

function serializeUser(row) {
  return {
    id: String(row.id),
    githubId: row.github_id,
    login: row.login,
    name: row.name || "",
    avatarUrl: row.avatar_url || "",
    profileUrl: githubProfileUrl(row.profile_url),
    email: row.email || "",
    role: row.role,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastLoginAt: row.last_login_at,
  };
}

export function createPortalUserService({
  mySqlService,
  accessControlService,
}) {
  async function listUsers(req, res, url) {
    const auth = await accessControlService.requireCapability(
      req,
      res,
      PORTAL_CAPABILITIES.USERS_VIEW,
    );
    if (!auth) return;

    const page = Number(url.searchParams.get("page") || 1);
    const pageSize = Number(url.searchParams.get("pageSize") || 20);
    if (
      !Number.isInteger(page) ||
      page < 1 ||
      page > 1_000_000 ||
      !Number.isInteger(pageSize) ||
      pageSize < 1 ||
      pageSize > 100
    ) {
      sendJson(res, 400, { error: "invalid_pagination" });
      return;
    }
    const query = String(url.searchParams.get("q") || "")
      .trim()
      .slice(0, 200);
    const where = query
      ? "WHERE github_id LIKE ? ESCAPE '\\\\' OR login LIKE ? ESCAPE '\\\\' OR name LIKE ? ESCAPE '\\\\' OR email LIKE ? ESCAPE '\\\\'"
      : "";
    const pattern = `%${escapeLike(query)}%`;
    const params = query ? [pattern, pattern, pattern, pattern] : [];
    const [counts] = await mySqlService.query(
      `SELECT COUNT(*) AS total FROM users ${where}`,
      params,
    );
    const [rows] = await mySqlService.query(
      `SELECT id, github_id, login, name, avatar_url, profile_url, email, role,
              created_at, updated_at, last_login_at
       FROM users ${where}
       ORDER BY last_login_at DESC, id DESC LIMIT ? OFFSET ?`,
      [...params, pageSize, (page - 1) * pageSize],
    );
    sendJson(res, 200, {
      items: rows.map(serializeUser),
      total: Number(counts[0]?.total || 0),
      page,
      pageSize,
    });
  }

  async function updateRole(req, res, rawUserId) {
    const auth = await accessControlService.requireCapability(
      req,
      res,
      PORTAL_CAPABILITIES.USERS_ROLES_UPDATE,
      { requireOrigin: true },
    );
    if (!auth) return;

    const userId = parseUserId(rawUserId);
    if (!userId) {
      sendJson(res, 400, { error: "invalid_user_id" });
      return;
    }
    let body;
    try {
      body = await readJson(req);
    } catch (error) {
      sendJson(res, error.message === "request_too_large" ? 413 : 400, {
        error: error.message,
      });
      return;
    }
    if (
      !body ||
      typeof body !== "object" ||
      Array.isArray(body) ||
      Object.keys(body).length !== 1 ||
      !ASSIGNABLE_PORTAL_ROLES.has(body.role)
    ) {
      sendJson(res, 400, { error: "invalid_user_role" });
      return;
    }

    const result = await mySqlService.transaction(async (connection) => {
      const [rows] = await connection.query(
        "SELECT id, role FROM users WHERE id = ? LIMIT 1 FOR UPDATE",
        [userId],
      );
      const target = rows[0];
      if (!target) return { status: 404, error: "user_not_found" };
      if (
        String(target.id) === String(auth.user.id) ||
        target.role === "super_administrator"
      ) {
        return { status: 403, error: "protected_user_role" };
      }
      const updatedAt = new Date();
      await connection.query(
        "UPDATE users SET role = ?, updated_at = ? WHERE id = ?",
        [body.role, updatedAt, userId],
      );
      return { status: 200, role: body.role, updatedAt };
    });
    if (result.error) {
      sendJson(res, result.status, { error: result.error });
      return;
    }
    sendJson(res, 200, {
      ok: true,
      user: { id: userId, role: result.role, updatedAt: result.updatedAt },
    });
  }

  async function handleRequest(req, res, url) {
    const roleMatch = /^\/api\/portal\/v1\/users\/([^/]+)\/role$/.exec(
      url.pathname,
    );
    const isUsersPath = url.pathname === "/api/portal/v1/users";
    if (!isUsersPath && !roleMatch) return false;
    if (!mySqlService.isEnabled()) {
      sendJson(res, 503, { error: "user_storage_not_configured" });
      return true;
    }
    if (isUsersPath && req.method === "GET") {
      await listUsers(req, res, url);
      return true;
    }
    if (roleMatch && req.method === "PATCH") {
      await updateRole(req, res, roleMatch[1]);
      return true;
    }
    sendJson(res, 404, { error: "not_found" });
    return true;
  }

  return { handleRequest };
}
