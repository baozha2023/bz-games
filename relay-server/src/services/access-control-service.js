import { sendJson } from "../utils/ws.js";

export function createAccessControlService({ config, authService }) {
  function isAdmin(auth) {
    return auth?.user?.role === "administrator";
  }

  async function requireAuthenticated(req, res) {
    const resolution = await authService.getSessionFromRequest(req);
    if (resolution.status !== "authenticated") {
      authService.sendAuthFailure(res, resolution.status);
      return null;
    }
    return { ...resolution.auth, isAdmin: isAdmin(resolution.auth) };
  }

  async function requireAdmin(req, res) {
    const auth = await requireAuthenticated(req, res);
    if (!auth) return null;
    if (!auth.isAdmin) {
      sendJson(res, 403, { error: "forbidden" });
      return null;
    }
    return auth;
  }

  async function requireCreator(req, res) {
    const auth = await requireAuthenticated(req, res);
    if (!auth) return null;
    if (!auth.isAdmin && auth.user.role !== "creator") {
      sendJson(res, 403, { error: "forbidden" });
      return null;
    }
    return auth;
  }

  function requirePortalOrigin(req, res) {
    const origin = String(req.headers.origin || "");
    if (!req.headers.cookie) return true;
    let allowedOrigin = "";
    try {
      allowedOrigin = new URL(config.PORTAL_PUBLIC_URL).origin;
    } catch {}
    if (!allowedOrigin || origin !== allowedOrigin) {
      sendJson(res, 403, { error: "invalid_origin" });
      return false;
    }
    return true;
  }

  return {
    isAdmin,
    requireAuthenticated,
    requireCreator,
    requireAdmin,
    requirePortalOrigin,
  };
}
