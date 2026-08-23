import assert from "node:assert/strict";
import test from "node:test";

import { createFeedbackService } from "../src/services/feedback-service.js";

test("feedback service does not claim forum administration routes", async () => {
  const service = createFeedbackService({
    config: {},
    mySqlService: { isEnabled: () => true },
    mongoService: {},
    authService: {},
    accessControlService: {},
    rateLimitService: {},
  });
  const handled = await service.handleRequest(
    {
      method: "GET",
      url: "/api/admin/v1/forum/posts?page=1",
      headers: { host: "localhost" },
    },
    {},
    new URL("http://localhost/api/admin/v1/forum/posts?page=1"),
  );

  assert.equal(handled, false);
});
