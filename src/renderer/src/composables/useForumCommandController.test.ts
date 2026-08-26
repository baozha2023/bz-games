import { describe, expect, it } from "vitest";
import { useForumCommandController } from "./useForumCommandController";
import { getForumCommand } from "../services/forum-command-registry";

describe("forum command controller", () => {
  it("derives forward and backward stages from the command registry", () => {
    const controller = useForumCommandController();
    expect(controller.start(getForumCommand("version"))).toBe("market");
    expect(controller.advance()).toBe("game");
    expect(controller.advance()).toBe("version");
    expect(controller.advance()).toBeNull();
    expect(controller.retreat()).toBe("game");
    expect(controller.retreat()).toBe("market");
    expect(controller.retreat()).toBeNull();
    expect(controller.stage.value).toBe("commands");
  });

  it("rejects stages that are not registered for the command", () => {
    const controller = useForumCommandController();
    expect(() => controller.restore("market", "version")).toThrow(
      "invalid_forum_command_stage",
    );
  });
});
