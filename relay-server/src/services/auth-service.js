import crypto from "node:crypto";

import { clearCookie, escapeHtml, parseCookies, readBearerToken, redirect, sendHtml, setCookie } from "../utils/http.js";
import { sendJson } from "../utils/ws.js";

const GITHUB_AUTHORIZE_URL = "https://github.com/login/oauth/authorize";
const GITHUB_ACCESS_TOKEN_URL = "https://github.com/login/oauth/access_token";
const GITHUB_USER_API_URL = "https://api.github.com/user";
const GITHUB_EMAILS_API_URL = "https://api.github.com/user/emails";

function hashToken(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function createRandomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString("base64url");
}

function serializeUser(user) {
  return {
    id: String(user.id),
    githubId: user.github_id,
    login: user.login,
    name: user.name || "",
    avatarUrl: user.avatar_url || "",
    profileUrl: user.profile_url || "",
    email: user.email || "",
    createdAt: user.created_at,
    updatedAt: user.updated_at,
    lastLoginAt: user.last_login_at,
  };
}

function resolveReturnTo(rawValue) {
  if (typeof rawValue !== "string" || !rawValue.trim()) return "";
  const value = rawValue.trim();
  if (
    value.startsWith("bzgames://") ||
    value.startsWith("http://127.0.0.1:") ||
    value.startsWith("http://localhost:")
  ) {
    return value;
  }
  return "";
}

async function fetchGitHubJson(url, accessToken) {
  const response = await fetch(url, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${accessToken}`,
      "User-Agent": "BZ-Games Relay Server",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!response.ok) {
    throw new Error(`github_api_failed:${response.status}`);
  }
  return response.json();
}

export function createAuthService({ config, mySqlService }) {
  function isConfigured() {
    return Boolean(
      mySqlService.isEnabled() &&
        config.GITHUB_CLIENT_ID &&
        config.GITHUB_CLIENT_SECRET &&
        config.GITHUB_CALLBACK_URL,
    );
  }

  async function cleanupExpiredAuthRecords() {
    await mySqlService.query("DELETE FROM oauth_states WHERE expires_at <= UTC_TIMESTAMP(3)");
    await mySqlService.query("DELETE FROM auth_sessions WHERE expires_at <= UTC_TIMESTAMP(3)");
  }

  async function createState(returnTo) {
    await mySqlService.ensureReady();
    await cleanupExpiredAuthRecords();
    const stateToken = createRandomToken(24);
    const expiresAt = new Date(Date.now() + config.OAUTH_STATE_TTL_MS);
    await mySqlService.query(
      `INSERT INTO oauth_states (state_hash, return_to, created_at, expires_at)
       VALUES (?, ?, ?, ?)`,
      [hashToken(stateToken), returnTo, new Date(), expiresAt],
    );
    return stateToken;
  }

  async function consumeState(stateToken) {
    await mySqlService.ensureReady();
    const [rows] = await mySqlService.query(
      "SELECT * FROM oauth_states WHERE state_hash = ? LIMIT 1",
      [hashToken(stateToken)],
    );
    const record = rows[0];
    if (!record) return null;
    await mySqlService.query("DELETE FROM oauth_states WHERE id = ?", [record.id]);
    if (record.expires_at.getTime() <= Date.now()) return null;
    return record;
  }

  async function upsertGitHubUser(accessToken) {
    await mySqlService.ensureReady();
    const profile = await fetchGitHubJson(GITHUB_USER_API_URL, accessToken);
    let email = typeof profile.email === "string" ? profile.email : "";
    if (!email) {
      try {
        const emails = await fetchGitHubJson(GITHUB_EMAILS_API_URL, accessToken);
        const primary = Array.isArray(emails) ? emails.find((item) => item?.primary) : null;
        email = primary?.email || "";
      } catch {
        email = "";
      }
    }

    const now = new Date();
    await mySqlService.query(
      `INSERT INTO users (github_id, login, name, avatar_url, profile_url, email, created_at, updated_at, last_login_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         login = VALUES(login),
         name = VALUES(name),
         avatar_url = VALUES(avatar_url),
         profile_url = VALUES(profile_url),
         email = VALUES(email),
         updated_at = VALUES(updated_at),
         last_login_at = VALUES(last_login_at)`,
      [
        String(profile.id),
        profile.login || "",
        profile.name || "",
        profile.avatar_url || "",
        profile.html_url || "",
        email,
        now,
        now,
        now,
      ],
    );
    const [rows] = await mySqlService.query(
      "SELECT * FROM users WHERE github_id = ? LIMIT 1",
      [String(profile.id)],
    );
    return rows[0];
  }

  async function createSession(userId) {
    await mySqlService.ensureReady();
    await cleanupExpiredAuthRecords();
    const token = createRandomToken(32);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + config.OAUTH_SESSION_TTL_MS);
    await mySqlService.query(
      `INSERT INTO auth_sessions (token_hash, user_id, created_at, updated_at, expires_at)
       VALUES (?, ?, ?, ?, ?)`,
      [hashToken(token), userId, now, now, expiresAt],
    );
    return { token, expiresAt };
  }

  async function deleteSessionByToken(token) {
    if (!token) return;
    await mySqlService.ensureReady();
    await mySqlService.query("DELETE FROM auth_sessions WHERE token_hash = ?", [
      hashToken(token),
    ]);
  }

  async function getSessionFromRequest(req) {
    if (!mySqlService.isEnabled()) return null;
    await mySqlService.ensureReady();
    await cleanupExpiredAuthRecords();
    const cookies = parseCookies(req);
    const sessionToken = readBearerToken(req) || cookies[config.SESSION_COOKIE_NAME] || "";
    if (!sessionToken) return null;

    const [rows] = await mySqlService.query(
      `SELECT s.*, u.id AS user_id_value, u.github_id, u.login, u.name, u.avatar_url, u.profile_url, u.email,
              u.created_at AS user_created_at, u.updated_at AS user_updated_at, u.last_login_at
       FROM auth_sessions s
       INNER JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ?
       LIMIT 1`,
      [hashToken(sessionToken)],
    );
    const row = rows[0];
    if (!row) return null;

    await mySqlService.query("UPDATE auth_sessions SET updated_at = ? WHERE id = ?", [
      new Date(),
      row.id,
    ]);

    return {
      session: {
        id: row.id,
        user_id: row.user_id,
        expiresAt: row.expires_at,
      },
      sessionToken,
      user: {
        id: row.user_id_value,
        github_id: row.github_id,
        login: row.login,
        name: row.name,
        avatar_url: row.avatar_url,
        profile_url: row.profile_url,
        email: row.email,
        created_at: row.user_created_at,
        updated_at: row.user_updated_at,
        last_login_at: row.last_login_at,
      },
    };
  }

  async function handleGitHubStart(req, res, url) {
    if (!isConfigured()) {
      sendJson(res, 503, { error: "auth_not_configured" });
      return true;
    }
    const returnTo = resolveReturnTo(url.searchParams.get("returnTo"));
    const stateToken = await createState(returnTo);
    const authorizeUrl = new URL(GITHUB_AUTHORIZE_URL);
    authorizeUrl.searchParams.set("client_id", config.GITHUB_CLIENT_ID);
    authorizeUrl.searchParams.set("redirect_uri", config.GITHUB_CALLBACK_URL);
    authorizeUrl.searchParams.set("scope", config.GITHUB_OAUTH_SCOPE);
    authorizeUrl.searchParams.set("state", stateToken);
    redirect(res, authorizeUrl.toString());
    return true;
  }

  async function handleGitHubCallback(req, res, url) {
    if (!isConfigured()) {
      sendJson(res, 503, { error: "auth_not_configured" });
      return true;
    }
    const code = url.searchParams.get("code") || "";
    const stateToken = url.searchParams.get("state") || "";
    if (!code || !stateToken) {
      sendJson(res, 400, { error: "invalid_oauth_callback" });
      return true;
    }
    const state = await consumeState(stateToken);
    if (!state) {
      sendJson(res, 400, { error: "invalid_oauth_state" });
      return true;
    }

    const tokenResponse = await fetch(GITHUB_ACCESS_TOKEN_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "User-Agent": "BZ-Games Relay Server",
      },
      body: JSON.stringify({
        client_id: config.GITHUB_CLIENT_ID,
        client_secret: config.GITHUB_CLIENT_SECRET,
        code,
        redirect_uri: config.GITHUB_CALLBACK_URL,
      }),
    });
    const tokenPayload = await tokenResponse.json();
    if (!tokenResponse.ok || !tokenPayload.access_token) {
      sendJson(res, 502, {
        error: "github_token_exchange_failed",
        details: tokenPayload.error || tokenPayload.error_description || "",
      });
      return true;
    }

    const user = await upsertGitHubUser(tokenPayload.access_token);
    const { token, expiresAt } = await createSession(user.id);
    const secureCookie = config.GITHUB_CALLBACK_URL.startsWith("https://");
    setCookie(res, config.SESSION_COOKIE_NAME, token, {
      maxAge: config.OAUTH_SESSION_TTL_MS / 1000,
      secure: secureCookie,
    });

    if (state.return_to) {
      const redirectUrl = new URL(state.return_to);
      redirectUrl.hash = new URLSearchParams({
        session_token: token,
        expires_at: expiresAt.toISOString(),
        login: user.login,
        name: user.name || "",
        profile_url: user.profile_url || "",
      }).toString();
      redirect(res, redirectUrl.toString());
      return true;
    }

    sendHtml(
      res,
      200,
      `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <title>BZ-Games GitHub 登录成功</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      body { font-family: Arial, sans-serif; background: #f6f7fb; color: #111827; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
      .card { width: min(92vw, 480px); background: #fff; border-radius: 16px; padding: 24px; box-shadow: 0 12px 40px rgba(15, 23, 42, 0.12); }
      h1 { font-size: 22px; margin: 0 0 12px; }
      p { line-height: 1.7; margin: 8px 0; }
      code { background: #f3f4f6; padding: 2px 6px; border-radius: 6px; }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>登录成功</h1>
      <p>GitHub 账号 <code>${escapeHtml(user.login)}</code> 已绑定到 BZ-Games 登录服务。</p>
      <p>当前浏览器已写入会话 Cookie，未来客户端接入后可直接读取你的云端数据。</p>
      <p>现在可以关闭此页面。</p>
    </div>
  </body>
</html>`,
    );
    return true;
  }

  async function handleAuthMe(req, res) {
    if (!mySqlService.isEnabled()) {
      sendJson(res, 503, { error: "auth_not_configured" });
      return true;
    }
    const auth = await getSessionFromRequest(req);
    if (!auth) {
      sendJson(res, 401, { error: "unauthorized" });
      return true;
    }
    sendJson(res, 200, {
      user: serializeUser(auth.user),
      expiresAt: auth.session.expiresAt,
    });
    return true;
  }

  async function handleAuthLogout(req, res) {
    if (!mySqlService.isEnabled()) {
      sendJson(res, 503, { error: "auth_not_configured" });
      return true;
    }
    const cookies = parseCookies(req);
    const token = readBearerToken(req) || cookies[config.SESSION_COOKIE_NAME] || "";
    if (token) {
      await deleteSessionByToken(token);
    }
    clearCookie(res, config.SESSION_COOKIE_NAME, {
      secure: config.GITHUB_CALLBACK_URL.startsWith("https://"),
    });
    sendJson(res, 200, { ok: true });
    return true;
  }

  async function handleRequest(req, res, url) {
    if (req.method === "GET" && url.pathname === "/auth/github/start") {
      return handleGitHubStart(req, res, url);
    }
    if (req.method === "GET" && url.pathname === "/auth/github/callback") {
      return handleGitHubCallback(req, res, url);
    }
    if (req.method === "GET" && url.pathname === "/api/auth/me") {
      return handleAuthMe(req, res);
    }
    if (req.method === "POST" && url.pathname === "/api/auth/logout") {
      return handleAuthLogout(req, res);
    }
    return false;
  }

  return {
    getSessionFromRequest,
    handleRequest,
    isConfigured,
  };
}
