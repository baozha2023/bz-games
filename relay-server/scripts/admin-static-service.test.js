import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createAdminStaticService } from "../src/services/admin-static-service.js";

test("admin static service applies security headers and blocks traversal", async () => {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), "bz-admin-static-"));
  const root = path.join(parent, "admin");
  await fs.mkdir(root);
  await fs.writeFile(
    path.join(root, "index.html"),
    "<!doctype html><p>admin</p>",
  );
  await fs.writeFile(path.join(parent, "secret.txt"), "secret");

  const service = createAdminStaticService({
    config: { ADMIN_STATIC_DIR: root },
  });
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (!service.handleRequest(req, res, url)) res.writeHead(404).end();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const index = await fetch(`${baseUrl}/admin/`);
    assert.equal(index.status, 200);
    assert.match(
      index.headers.get("content-security-policy") || "",
      /script-src 'self'/,
    );
    assert.equal(index.headers.get("x-frame-options"), "DENY");

    const fallback = await fetch(`${baseUrl}/admin/feedback/123`);
    assert.equal(fallback.status, 200);
    assert.match(await fallback.text(), /admin/);

    const traversal = await fetch(`${baseUrl}/admin/%2e%2e%2fsecret.txt`);
    assert.equal(traversal.status, 400);
    assert.doesNotMatch(await traversal.text(), /secret/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(parent, { recursive: true, force: true });
  }
});
