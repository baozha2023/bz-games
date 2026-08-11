export const PORTAL_ROLES = [
  "player",
  "creator",
  "administrator",
  "super_administrator",
] as const;

export type PortalRole = (typeof PORTAL_ROLES)[number];

export const PORTAL_CAPABILITIES = [
  "feedback.view",
  "feedback.manage",
  "users.view",
  "users.roles.update",
  "hosting.view",
  "hosting.game.create",
  "hosting.version.create",
  "hosting.own.manage",
  "hosting.all.manage",
  "hosting.review",
  "hosting.publish.direct",
  "release.view",
  "release.upload",
] as const;

export type PortalCapability = (typeof PORTAL_CAPABILITIES)[number];

const ROLE_SET = new Set<string>(PORTAL_ROLES);
const CAPABILITY_SET = new Set<string>(PORTAL_CAPABILITIES);

export function isPortalRole(value: unknown): value is PortalRole {
  return typeof value === "string" && ROLE_SET.has(value);
}

export function isPortalCapability(value: unknown): value is PortalCapability {
  return typeof value === "string" && CAPABILITY_SET.has(value);
}
