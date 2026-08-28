import { Writable } from "node:stream";
import { pipeline } from "node:stream/promises";

import { parser } from "stream-json";

const SNAPSHOT_PROTOCOL_VERSION = 2;
const SNAPSHOT_DATA_MODEL_VERSION = 4;
const MAX_KEY_LENGTH = 64;
const MAX_CREATED_AT_LENGTH = 128;
const STRING_FIELDS = new Set(["createdAt", "config", "databaseSql"]);
const NUMBER_FIELDS = new Map([
  ["formatVersion", SNAPSHOT_PROTOCOL_VERSION],
  ["dataModelVersion", SNAPSHOT_DATA_MODEL_VERSION],
]);
const EXPECTED_FIELDS = new Set([...STRING_FIELDS, ...NUMBER_FIELDS.keys()]);

export class SnapshotFormatError extends Error {
  constructor() {
    super("snapshot_format_invalid");
    this.name = "SnapshotFormatError";
  }
}

function invalid() {
  throw new SnapshotFormatError();
}

class SnapshotTokenValidator {
  constructor() {
    this.rootStarted = false;
    this.rootEnded = false;
    this.collectingKey = false;
    this.key = "";
    this.currentField = "";
    this.collectingString = false;
    this.createdAt = "";
    this.seen = new Set();
  }

  consume(token) {
    if (this.rootEnded) invalid();
    switch (token.name) {
      case "startObject":
        if (this.rootStarted) invalid();
        this.rootStarted = true;
        return;
      case "endObject":
        if (
          !this.rootStarted ||
          this.collectingKey ||
          this.currentField ||
          this.collectingString ||
          this.seen.size !== EXPECTED_FIELDS.size
        ) {
          invalid();
        }
        this.rootEnded = true;
        return;
      case "startKey":
        if (!this.rootStarted || this.collectingKey || this.currentField) {
          invalid();
        }
        this.collectingKey = true;
        this.key = "";
        return;
      case "endKey":
        if (
          !this.collectingKey ||
          !EXPECTED_FIELDS.has(this.key) ||
          this.seen.has(this.key)
        ) {
          invalid();
        }
        this.collectingKey = false;
        this.currentField = this.key;
        this.key = "";
        return;
      case "stringChunk":
        if (this.collectingKey) {
          this.key += token.value;
          if (this.key.length > MAX_KEY_LENGTH) invalid();
          return;
        }
        if (!this.collectingString || !this.currentField) invalid();
        if (this.currentField === "createdAt") {
          this.createdAt += token.value;
          if (this.createdAt.length > MAX_CREATED_AT_LENGTH) invalid();
        }
        return;
      case "startString":
        if (!STRING_FIELDS.has(this.currentField) || this.collectingString) {
          invalid();
        }
        this.collectingString = true;
        this.createdAt = "";
        return;
      case "endString":
        if (!this.collectingString || !STRING_FIELDS.has(this.currentField)) {
          invalid();
        }
        if (
          this.currentField === "createdAt" &&
          !Number.isFinite(Date.parse(this.createdAt))
        ) {
          invalid();
        }
        this.finishField();
        return;
      case "numberValue": {
        const expected = NUMBER_FIELDS.get(this.currentField);
        if (expected === undefined || Number(token.value) !== expected) invalid();
        this.finishField();
        return;
      }
      default:
        invalid();
    }
  }

  finishField() {
    this.seen.add(this.currentField);
    this.currentField = "";
    this.collectingString = false;
    this.createdAt = "";
  }

  finish() {
    if (!this.rootStarted || !this.rootEnded) invalid();
  }
}

export async function validatePlatformSnapshotStream(readable) {
  const validator = new SnapshotTokenValidator();
  const tokenSink = new Writable({
    objectMode: true,
    write(token, _encoding, callback) {
      try {
        validator.consume(token);
        callback();
      } catch (error) {
        callback(error);
      }
    },
  });

  try {
    await pipeline(
      readable,
      parser.asStream({
        packKeys: false,
        packStrings: false,
        packNumbers: true,
        streamKeys: true,
        streamStrings: true,
        streamNumbers: false,
      }),
      tokenSink,
    );
    validator.finish();
  } catch (error) {
    if (error instanceof SnapshotFormatError) throw error;
    throw new SnapshotFormatError();
  }
}
