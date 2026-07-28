import fs from "node:fs";
import path from "node:path";

const CONTENT_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

function getStat(filePath) {
  try {
    return fs.statSync(filePath);
  } catch {
    return null;
  }
}

function getRealPath(filePath) {
  try {
    return fs.realpathSync(filePath);
  } catch {
    return "";
  }
}

function isInsideRoot(root, candidate) {
  return candidate === root || candidate.startsWith(`${root}${path.sep}`);
}

function sendFile(req, res, filePath, stat) {
  const extension = path.extname(filePath).toLowerCase();
  const isHtml = extension === ".html";
  res.writeHead(200, {
    "content-type": CONTENT_TYPES[extension] || "application/octet-stream",
    "content-length": String(stat.size),
    "cache-control": isHtml
      ? "no-cache, no-store, must-revalidate"
      : "public, max-age=31536000, immutable",
    "content-security-policy":
      "default-src 'self'; img-src 'self' data: blob: https:; " +
      "style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; " +
      "object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
    "permissions-policy": "camera=(), microphone=(), geolocation=()",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
  });
  if (req.method === "HEAD") {
    res.end();
    return;
  }
  fs.createReadStream(filePath)
    .once("error", () => res.destroy())
    .pipe(res);
}

export function createAdminStaticService({ config }) {
  const root = config.ADMIN_STATIC_DIR
    ? path.resolve(config.ADMIN_STATIC_DIR)
    : "";

  function handleRequest(req, res, url) {
    if (!root || !["GET", "HEAD"].includes(req.method)) return false;
    if (url.pathname === "/admin") {
      res.writeHead(302, {
        location: "/admin/",
        "cache-control": "no-store",
      });
      res.end();
      return true;
    }
    if (!url.pathname.startsWith("/admin/")) return false;
    if (!getStat(root)?.isDirectory()) {
      res.writeHead(503, { "content-type": "text/plain; charset=utf-8" });
      res.end("Admin frontend is not deployed.");
      return true;
    }

    let relativePath;
    try {
      relativePath = decodeURIComponent(url.pathname.slice("/admin/".length));
    } catch {
      res.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
      res.end("Bad request.");
      return true;
    }
    const realRoot = getRealPath(root);
    const candidate = path.resolve(root, relativePath || "index.html");
    if (!realRoot || !isInsideRoot(root, candidate)) {
      res.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
      res.end("Bad request.");
      return true;
    }
    const filePath = getStat(candidate)?.isFile()
      ? candidate
      : path.join(root, "index.html");
    const realFilePath = getRealPath(filePath);
    const fileStat = getStat(realFilePath);
    if (!isInsideRoot(realRoot, realFilePath) || !fileStat?.isFile()) {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end("Not found.");
      return true;
    }
    sendFile(req, res, realFilePath, fileStat);
    return true;
  }

  return { handleRequest };
}
