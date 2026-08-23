import assert from "node:assert/strict";
import test from "node:test";

import { createForumSearchService } from "../src/services/forum-search-service.js";

test("the global Elasticsearch switch disables search even when an endpoint is configured", () => {
  const service = createForumSearchService({
    config: {
      ELASTICSEARCH_ENABLED: false,
      ELASTICSEARCH_URL: "http://127.0.0.1:9200",
    },
  });

  assert.equal(service.isEnabled(), false);
});

test("search can only be enabled when the global switch and endpoint are both configured", () => {
  const service = createForumSearchService({
    config: {
      ELASTICSEARCH_ENABLED: true,
      ELASTICSEARCH_URL: "http://127.0.0.1:9200",
    },
  });

  assert.equal(service.isEnabled(), true);
});
