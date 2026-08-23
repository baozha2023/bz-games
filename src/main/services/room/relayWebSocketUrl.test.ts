import { describe, expect, it } from "vitest";

import { toRelayWebSocketUrl } from "./relayWebSocketUrl";

describe("toRelayWebSocketUrl", () => {
  it("normalizes HTTP relay origins to the Nginx WebSocket route", () => {
    expect(toRelayWebSocketUrl("http://relay.example.com:38090")).toBe(
      "ws://relay.example.com:38090/ws/",
    );
  });

  it("uses secure WebSocket for HTTPS relay origins", () => {
    expect(toRelayWebSocketUrl("https://relay.example.com/old-path")).toBe(
      "wss://relay.example.com/ws/",
    );
  });

  it("replaces an accidental path and query with the canonical route", () => {
    expect(toRelayWebSocketUrl("ws://relay.example.com:38090/rooms?x=1#hash")).toBe(
      "ws://relay.example.com:38090/ws/",
    );
  });

  it("rejects empty and invalid relay addresses", () => {
    expect(toRelayWebSocketUrl(" ")).toBe("");
    expect(toRelayWebSocketUrl("http://[invalid")).toBe("");
  });
});
