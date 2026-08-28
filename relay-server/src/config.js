function parseBoolean(value, fallback = false) {
  if (value === undefined) return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
}

export const config = {
  PORT: Number(process.env.PORT || 38091),
  HOST: (process.env.HOST || "127.0.0.1").trim(),
  ROOM_TTL_MS: Number(process.env.ROOM_TTL_MS || 60000),
  HEARTBEAT_INTERVAL_MS: Number(process.env.HEARTBEAT_INTERVAL_MS || 30000),
  MAX_TEXT_BYTES: Number(process.env.MAX_TEXT_BYTES || 1024 * 1024),
  MAX_BINARY_BYTES: Number(process.env.MAX_BINARY_BYTES || 12 * 1024 * 1024),
  MAX_PLATFORM_CLOUD_SNAPSHOT_BYTES: Number(
    process.env.MAX_PLATFORM_CLOUD_SNAPSHOT_BYTES || 128 * 1024 * 1024,
  ),
  PLATFORM_SNAPSHOT_GC_GRACE_MS: Number(
    process.env.PLATFORM_SNAPSHOT_GC_GRACE_MS || 5 * 60 * 1000,
  ),
  CLOUD_V2_MAINTENANCE: parseBoolean(process.env.CLOUD_V2_MAINTENANCE),
  MAX_FEEDBACK_REQUEST_BYTES: Number(
    process.env.MAX_FEEDBACK_REQUEST_BYTES || 24 * 1024 * 1024,
  ),
  MAX_FEEDBACK_TEXT_LENGTH: Number(
    process.env.MAX_FEEDBACK_TEXT_LENGTH || 5000,
  ),
  MAX_FEEDBACK_IMAGES: Number(process.env.MAX_FEEDBACK_IMAGES || 4),
  MAX_FEEDBACK_IMAGE_BYTES: Number(
    process.env.MAX_FEEDBACK_IMAGE_BYTES || 5 * 1024 * 1024,
  ),
  GAME_HOSTING_STORAGE_DIR: (
    process.env.GAME_HOSTING_STORAGE_DIR || "/var/lib/bz-games-hosting"
  ).trim(),
  MAX_GAME_HOSTING_FILE_BYTES: Number(
    process.env.MAX_GAME_HOSTING_FILE_BYTES || 200 * 1024 * 1024,
  ),
  MAX_GAME_HOSTING_IMAGE_BYTES: Number(
    process.env.MAX_GAME_HOSTING_IMAGE_BYTES || 5 * 1024 * 1024,
  ),
  MAX_GAME_HOSTING_TOTAL_BYTES: Number(
    process.env.MAX_GAME_HOSTING_TOTAL_BYTES || 5 * 1024 * 1024 * 1024,
  ),
  DESKTOP_RELEASE_STORAGE_DIR: (
    process.env.DESKTOP_RELEASE_STORAGE_DIR || "/var/lib/bz-games-releases"
  ).trim(),
  MAX_DESKTOP_RELEASE_FILE_BYTES: Number(
    process.env.MAX_DESKTOP_RELEASE_FILE_BYTES || 512 * 1024 * 1024,
  ),
  DESKTOP_RELEASE_BANDWIDTH_BPS: Number(
    process.env.DESKTOP_RELEASE_BANDWIDTH_BPS || 100_000_000,
  ),
  FEEDBACK_AUTHENTICATED_COOLDOWN_MS: Number(
    process.env.FEEDBACK_AUTHENTICATED_COOLDOWN_MS || 12 * 60 * 60 * 1000,
  ),
  RATE_LIMIT_RESERVATION_TTL_MS: Number(
    process.env.RATE_LIMIT_RESERVATION_TTL_MS || 5 * 60 * 1000,
  ),
  MAX_FORUM_REQUEST_BYTES: Number(
    process.env.MAX_FORUM_REQUEST_BYTES || 24 * 1024 * 1024,
  ),
  MAX_FORUM_TITLE_LENGTH: Number(
    process.env.MAX_FORUM_TITLE_LENGTH || 80,
  ),
  MAX_FORUM_BODY_LENGTH: Number(
    process.env.MAX_FORUM_BODY_LENGTH || 5000,
  ),
  MAX_FORUM_COMMENT_LENGTH: Number(
    process.env.MAX_FORUM_COMMENT_LENGTH || 1000,
  ),
  MAX_FORUM_IMAGES: Number(process.env.MAX_FORUM_IMAGES || 4),
  MAX_FORUM_IMAGE_BYTES: Number(
    process.env.MAX_FORUM_IMAGE_BYTES || 5 * 1024 * 1024,
  ),
  FORUM_PLAYER_POST_COOLDOWN_MS: Number(
    process.env.FORUM_PLAYER_POST_COOLDOWN_MS || 24 * 60 * 60 * 1000,
  ),
  FORUM_ADMIN_POST_COOLDOWN_MS: Number(
    process.env.FORUM_ADMIN_POST_COOLDOWN_MS || 60 * 60 * 1000,
  ),
  FORUM_PLAYER_COMMENT_COOLDOWN_MS: Number(
    process.env.FORUM_PLAYER_COMMENT_COOLDOWN_MS || 30 * 60 * 1000,
  ),
  FORUM_ADMIN_COMMENT_COOLDOWN_MS: Number(
    process.env.FORUM_ADMIN_COMMENT_COOLDOWN_MS || 5 * 60 * 1000,
  ),
  ELASTICSEARCH_ENABLED: parseBoolean(process.env.ELASTICSEARCH_ENABLED),
  ELASTICSEARCH_URL: (process.env.ELASTICSEARCH_URL || "").trim(),
  ELASTICSEARCH_USERNAME: (process.env.ELASTICSEARCH_USERNAME || "").trim(),
  ELASTICSEARCH_PASSWORD: process.env.ELASTICSEARCH_PASSWORD || "",
  ELASTICSEARCH_INDEX_ALIAS: (
    process.env.ELASTICSEARCH_INDEX_ALIAS || "bz_forum_posts"
  ).trim(),
  ELASTICSEARCH_REQUEST_TIMEOUT_MS: Number(
    process.env.ELASTICSEARCH_REQUEST_TIMEOUT_MS || 5000,
  ),
  FORUM_SEARCH_WORKER_INTERVAL_MS: Number(
    process.env.FORUM_SEARCH_WORKER_INTERVAL_MS || 5000,
  ),
  PORTAL_PUBLIC_URL: (process.env.PORTAL_PUBLIC_URL || "").trim(),
  ADMIN_STATIC_DIR: (process.env.ADMIN_STATIC_DIR || "").trim(),
  RELAY_TOKEN: (process.env.RELAY_TOKEN || "").trim(),
  MAX_ROOMS: Number(process.env.MAX_ROOMS || 80),
  MAX_CLIENTS: Number(process.env.MAX_CLIENTS || 400),
  MAX_CLIENTS_PER_ROOM: Number(process.env.MAX_CLIENTS_PER_ROOM || 10),
  MAX_EVENT_LOOP_DELAY_MS: Number(process.env.MAX_EVENT_LOOP_DELAY_MS || 250),
  MONGODB_URI: (process.env.MONGODB_URI || "").trim(),
  MONGODB_DB_NAME: (process.env.MONGODB_DB_NAME || "bz_games").trim(),
  MONGODB_BUCKET_NAME: (process.env.MONGODB_BUCKET_NAME || "userFiles").trim(),
  MYSQL_HOST: (process.env.MYSQL_HOST || "127.0.0.1").trim(),
  MYSQL_PORT: Number(process.env.MYSQL_PORT || 3306),
  MYSQL_USER: (process.env.MYSQL_USER || "").trim(),
  MYSQL_PASSWORD: process.env.MYSQL_PASSWORD || "",
  MYSQL_DATABASE: (process.env.MYSQL_DATABASE || "bz_games").trim(),
  GITHUB_CLIENT_ID: (process.env.GITHUB_CLIENT_ID || "").trim(),
  GITHUB_CLIENT_SECRET: (process.env.GITHUB_CLIENT_SECRET || "").trim(),
  GITHUB_CALLBACK_URL: (process.env.GITHUB_CALLBACK_URL || "").trim(),
  GITHUB_OAUTH_SCOPE: (
    process.env.GITHUB_OAUTH_SCOPE || "read:user user:email"
  ).trim(),
  SESSION_COOKIE_NAME: (
    process.env.SESSION_COOKIE_NAME || "bz_games_session"
  ).trim(),
  OAUTH_SESSION_TTL_MS: Number(
    process.env.OAUTH_SESSION_TTL_MS || 30 * 24 * 60 * 60 * 1000,
  ),
  AUTH_EXPIRED_SESSION_RETENTION_MS: Number(
    process.env.AUTH_EXPIRED_SESSION_RETENTION_MS || 7 * 24 * 60 * 60 * 1000,
  ),
  OAUTH_STATE_TTL_MS: Number(process.env.OAUTH_STATE_TTL_MS || 10 * 60 * 1000),
};
