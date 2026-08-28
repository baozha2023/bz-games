import { describe, expect, it } from "vitest";
import { buildGameProcessEnvironment, buildWebGameConfig } from "./game-launch";

const context = {
  locale: "ja-JP" as const,
  platformVersion: "4.0.0",
  apiPort: 38080,
  apiToken: "token",
  playerId: "player",
  playerName: "Player",
  playerAvatar: "avatar",
  gameId: "com.example.game",
  gameVersion: "1.0.0",
  roomId: "room",
  isHost: true,
  isMultiple: false,
};

describe("game locale injection", () => {
  it("injects BZ_LOCALE into native games", () => {
    expect(buildGameProcessEnvironment({}, undefined, context).BZ_LOCALE).toBe(
      "ja-JP",
    );
  });

  it("injects locale into local Web game BZ_CONFIG", () => {
    expect(buildWebGameConfig(context).locale).toBe("ja-JP");
  });
});
