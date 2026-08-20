export const PORTAL_ROLES = Object.freeze([
  "player",
  "creator",
  "administrator",
  "super_administrator",
]);

export const ASSIGNABLE_PORTAL_ROLES = new Set([
  "player",
  "creator",
  "administrator",
]);

export const PORTAL_CAPABILITIES = Object.freeze({
  FEEDBACK_VIEW: "feedback.view",
  FEEDBACK_MANAGE: "feedback.manage",
  USERS_VIEW: "users.view",
  USERS_ROLES_UPDATE: "users.roles.update",
  HOSTING_VIEW: "hosting.view",
  HOSTING_GAME_CREATE: "hosting.game.create",
  HOSTING_VERSION_CREATE: "hosting.version.create",
  HOSTING_OWN_MANAGE: "hosting.own.manage",
  HOSTING_ALL_MANAGE: "hosting.all.manage",
  HOSTING_REVIEW: "hosting.review",
  HOSTING_PUBLISH_DIRECT: "hosting.publish.direct",
  HOSTING_CAPACITY_VIEW: "hosting.capacity.view",
  SYSTEM_MONITOR_VIEW: "system.monitor.view",
  RELEASE_VIEW: "release.view",
  RELEASE_UPLOAD: "release.upload",
});

const ALL_CAPABILITIES = Object.freeze(Object.values(PORTAL_CAPABILITIES));
const ROLE_CAPABILITIES = Object.freeze({
  player: Object.freeze([]),
  creator: Object.freeze([
    PORTAL_CAPABILITIES.HOSTING_VIEW,
    PORTAL_CAPABILITIES.HOSTING_GAME_CREATE,
    PORTAL_CAPABILITIES.HOSTING_VERSION_CREATE,
    PORTAL_CAPABILITIES.HOSTING_OWN_MANAGE,
  ]),
  administrator: Object.freeze([
    PORTAL_CAPABILITIES.FEEDBACK_VIEW,
    PORTAL_CAPABILITIES.FEEDBACK_MANAGE,
    PORTAL_CAPABILITIES.USERS_VIEW,
    PORTAL_CAPABILITIES.HOSTING_VIEW,
    PORTAL_CAPABILITIES.HOSTING_GAME_CREATE,
    PORTAL_CAPABILITIES.HOSTING_VERSION_CREATE,
    PORTAL_CAPABILITIES.HOSTING_ALL_MANAGE,
    PORTAL_CAPABILITIES.HOSTING_REVIEW,
    PORTAL_CAPABILITIES.HOSTING_PUBLISH_DIRECT,
    PORTAL_CAPABILITIES.RELEASE_VIEW,
  ]),
  super_administrator: ALL_CAPABILITIES,
});

const CAPABILITY_SET = new Set(ALL_CAPABILITIES);

export function getCapabilities(role) {
  return ROLE_CAPABILITIES[role] || [];
}

export function hasCapability(role, capability) {
  return (
    CAPABILITY_SET.has(capability) &&
    getCapabilities(role).includes(capability)
  );
}
