export type PortalRole = "player" | "creator" | "administrator";

export type PortalCapability =
  | "feedback.read"
  | "users.read"
  | "hosting.view"
  | "hosting.create"
  | "hosting.manageOwn"
  | "hosting.review"
  | "hosting.manageAll"
  | "hosting.publishDirect";

const ROLE_CAPABILITIES: Record<PortalRole, ReadonlySet<PortalCapability>> = {
  player: new Set(),
  creator: new Set(["hosting.view", "hosting.create", "hosting.manageOwn"]),
  administrator: new Set([
    "feedback.read",
    "users.read",
    "hosting.view",
    "hosting.create",
    "hosting.manageOwn",
    "hosting.review",
    "hosting.manageAll",
    "hosting.publishDirect",
  ]),
};

export function hasCapability(role: PortalRole, capability: PortalCapability): boolean {
  return ROLE_CAPABILITIES[role].has(capability);
}
