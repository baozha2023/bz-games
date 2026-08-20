import { sendJson } from "../utils/ws.js";
import { getCapabilities, hasCapability } from "./portal-authorization.js";

export function createAccessControlService({ config, authService }) {
  function requirePortalOrigin(req, res) {
    const origin = String(req.headers.origin || "");
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

  async function requirePortalSession(req, res, options = {}) {
    if (options.requireOrigin && !requirePortalOrigin(req, res)) return null;
    const resolution = await authService.getPortalSessionFromRequest(req);
    if (resolution.status !== "authenticated") {
      authService.sendAuthFailure(res, resolution.status);
      return null;
    }
    return resolution.auth;
  }

  async function requireCapability(req, res, capability, options = {}) {
    const auth = await requirePortalSession(req, res, options);
    if (!auth) return null;
    const role = auth.user.role;
    if (!hasCapability(role, capability)) {
      sendJson(res, 403, { error: "forbidden" });
      return null;
    }
    const capabilities = getCapabilities(role);
    return {
      ...auth,
      capabilities,
      can: (candidate) => capabilities.includes(candidate),
    };
  }

  return { requirePortalSession, requireCapability };
}
