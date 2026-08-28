import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";

import {
  SnapshotFormatError,
  validatePlatformSnapshotStream,
} from "../src/services/cloud-snapshot-validator.js";

function fragmented(value, chunkSize = 3) {
  const bytes = Buffer.from(value);
  const chunks = [];
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    chunks.push(bytes.subarray(offset, offset + chunkSize));
  }
  return Readable.from(chunks);
}

const validSnapshot = {
  formatVersion: 2,
  dataModelVersion: 4,
  createdAt: "2026-08-28T00:00:00.000Z",
  config: "encrypted-config",
  databaseSql: "BEGIN; COMMIT;",
};

test("validates a fragmented canonical cloud snapshot without assembling it", async () => {
  await validatePlatformSnapshotStream(
    fragmented(JSON.stringify(validSnapshot), 1),
  );
});

test("rejects duplicate, extra, nested, malformed, and mistyped fields", async () => {
  const invalidPayloads = [
    '{"formatVersion":2,"formatVersion":2,"dataModelVersion":4,"createdAt":"2026-08-28T00:00:00Z","config":"x","databaseSql":"x"}',
    JSON.stringify({ ...validSnapshot, extra: true }),
    JSON.stringify({ ...validSnapshot, config: { value: "x" } }),
    JSON.stringify({ ...validSnapshot, formatVersion: 1 }),
    JSON.stringify({ ...validSnapshot, createdAt: "not-a-date" }),
    JSON.stringify(validSnapshot).slice(0, -1),
  ];

  for (const payload of invalidPayloads) {
    await assert.rejects(
      validatePlatformSnapshotStream(fragmented(payload)),
      (error) =>
        error instanceof SnapshotFormatError &&
        error.message === "snapshot_format_invalid",
    );
  }
});
