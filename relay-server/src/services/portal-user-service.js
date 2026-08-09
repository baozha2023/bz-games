import { sendJson } from "../utils/ws.js";

function escapeLike(value) {
  return value.replace(/[\\%_]/g, "\\$&");
}

function githubProfileUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:" && url.hostname === "github.com" ? url.toString() : "";
  } catch {
    return "";
  }
}

export function createPortalUserService({ mySqlService, accessControlService }) {
  async function handleRequest(req, res, url) {
    if (url.pathname === "/api/portal/v1/activate") {
      if (req.method !== "POST") {
        sendJson(res, 404, { error: "not_found" });
        return true;
      }
      if (!mySqlService.isEnabled()) {
        sendJson(res, 503, { error: "user_storage_not_configured" });
        return true;
      }
      if (!req.headers.cookie || req.headers.authorization) {
        sendJson(res, 403, { error: "portal_cookie_required" });
        return true;
      }
      if (!accessControlService.requirePortalOrigin(req, res)) return true;
      const auth = await accessControlService.requireAuthenticated(req, res);
      if (!auth) return true;
      if (auth.user.role === "player") {
        await mySqlService.query(
          "UPDATE users SET role = 'creator', updated_at = ? WHERE id = ? AND role = 'player'",
          [new Date(), auth.user.id],
        );
      }
      sendJson(res, 200, {
        ok: true,
        role: auth.user.role === "player" ? "creator" : auth.user.role,
      });
      return true;
    }

    if (url.pathname !== "/api/portal/v1/users") return false;
    if (req.method !== "GET") {
      sendJson(res, 404, { error: "not_found" });
      return true;
    }
    if (!mySqlService.isEnabled()) {
      sendJson(res, 503, { error: "user_storage_not_configured" });
      return true;
    }
    const auth = await accessControlService.requireAdmin(req, res);
    if (!auth) return true;

    const page = Number(url.searchParams.get("page") || 1);
    const pageSize = Number(url.searchParams.get("pageSize") || 20);
    if (!Number.isInteger(page) || page < 1 || page > 1_000_000 ||
        !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
      sendJson(res, 400, { error: "invalid_pagination" });
      return true;
    }
    const query = String(url.searchParams.get("q") || "").trim().slice(0, 200);
    const where = query
      ? "WHERE github_id LIKE ? ESCAPE '\\\\' OR login LIKE ? ESCAPE '\\\\' OR name LIKE ? ESCAPE '\\\\' OR email LIKE ? ESCAPE '\\\\'"
      : "";
    const pattern = `%${escapeLike(query)}%`;
    const params = query ? [pattern, pattern, pattern, pattern] : [];
    const [counts] = await mySqlService.query(`SELECT COUNT(*) AS total FROM users ${where}`, params);
    const [rows] = await mySqlService.query(
      `SELECT id, github_id, login, name, avatar_url, profile_url, email, role,
              created_at, updated_at, last_login_at
       FROM users ${where}
       ORDER BY last_login_at DESC, id DESC LIMIT ? OFFSET ?`,
      [...params, pageSize, (page - 1) * pageSize],
    );
    sendJson(res, 200, {
      items: rows.map((row) => ({
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
      })),
      total: Number(counts[0]?.total || 0),
      page,
      pageSize,
    });
    return true;
  }

  return { handleRequest };
}
