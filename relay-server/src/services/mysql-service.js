import mysql from "mysql2/promise";

export function createMySqlService({ config }) {
  let pool = null;
  let initPromise = null;

  async function ensureSchema() {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        github_id VARCHAR(64) NOT NULL,
        login VARCHAR(255) NOT NULL,
        name VARCHAR(255) NOT NULL DEFAULT '',
        nickname VARCHAR(16) NOT NULL DEFAULT '玩家',
        is_online TINYINT(1) NOT NULL DEFAULT 0,
        last_online_at DATETIME(3) NULL,
        avatar_url TEXT NOT NULL,
        profile_url TEXT NOT NULL,
        email VARCHAR(255) NOT NULL DEFAULT '',
        role ENUM('player', 'creator', 'administrator', 'super_administrator') NOT NULL DEFAULT 'player',
        created_at DATETIME(3) NOT NULL,
        updated_at DATETIME(3) NOT NULL,
        last_login_at DATETIME(3) NOT NULL,
        PRIMARY KEY (id),
        UNIQUE KEY uniq_users_github_id (github_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    const bootstrapTime = new Date();
    await pool.query(
      `INSERT INTO users
         (github_id, login, name, avatar_url, profile_url, email, role,
          created_at, updated_at, last_login_at)
       VALUES (?, ?, '', '', ?, '', 'super_administrator', ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         updated_at = IF(role = 'super_administrator', updated_at, ?),
         role = 'super_administrator'`,
      [
        "208792845",
        "baozha2023",
        "https://github.com/baozha2023",
        bootstrapTime,
        bootstrapTime,
        bootstrapTime,
        bootstrapTime,
      ],
    );
    await pool.query(`
      CREATE TABLE IF NOT EXISTS auth_sessions (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        token_hash CHAR(64) NOT NULL,
        user_id BIGINT UNSIGNED NOT NULL,
        created_at DATETIME(3) NOT NULL,
        updated_at DATETIME(3) NOT NULL,
        expires_at DATETIME(3) NOT NULL,
        PRIMARY KEY (id),
        UNIQUE KEY uniq_auth_sessions_token_hash (token_hash),
        KEY idx_auth_sessions_user_id (user_id),
        KEY idx_auth_sessions_expires_at (expires_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS oauth_states (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        state_hash CHAR(64) NOT NULL,
        return_to TEXT NOT NULL,
        created_at DATETIME(3) NOT NULL,
        expires_at DATETIME(3) NOT NULL,
        PRIMARY KEY (id),
        UNIQUE KEY uniq_oauth_states_state_hash (state_hash),
        KEY idx_oauth_states_expires_at (expires_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS user_platform_snapshots (
        user_id BIGINT UNSIGNED NOT NULL,
        file_storage_id VARCHAR(64) NOT NULL,
        snapshot_version BIGINT UNSIGNED NOT NULL,
        size BIGINT UNSIGNED NOT NULL,
        sha256 CHAR(64) NOT NULL,
        content_type VARCHAR(255) NOT NULL,
        created_at DATETIME(3) NOT NULL,
        updated_at DATETIME(3) NOT NULL,
        PRIMARY KEY (user_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS cloud_sync_limits (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        user_id BIGINT UNSIGNED NOT NULL,
        action_type ENUM('upload', 'download') NOT NULL,
        last_action_at DATETIME(3) NOT NULL,
        PRIMARY KEY (id),
        UNIQUE KEY uniq_cloud_sync_limits_user_action (user_id, action_type),
        KEY idx_cloud_sync_limits_last_action_at (last_action_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS rate_limit_records (
        github_id VARCHAR(64) NOT NULL,
        endpoint_key VARCHAR(128) NOT NULL,
        last_success_at DATETIME(3) NULL,
        reservation_token CHAR(36) NULL,
        reservation_expires_at DATETIME(3) NULL,
        created_at DATETIME(3) NOT NULL,
        updated_at DATETIME(3) NOT NULL,
        PRIMARY KEY (github_id, endpoint_key),
        KEY idx_rate_limit_records_updated_at (updated_at),
        KEY idx_rate_limit_records_reservation_expires_at (reservation_expires_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS feedback (
        id CHAR(36) NOT NULL,
        content TEXT NOT NULL,
        status ENUM('new', 'reviewing', 'planned', 'resolved', 'closed') NOT NULL DEFAULT 'new',
        admin_note TEXT NOT NULL,
        reply TEXT NOT NULL,
        submitter_type ENUM('github') NOT NULL,
        user_id BIGINT UNSIGNED NOT NULL,
        github_login VARCHAR(255) NOT NULL DEFAULT '',
        app_version VARCHAR(64) NOT NULL,
        platform VARCHAR(64) NOT NULL,
        image_count SMALLINT UNSIGNED NOT NULL DEFAULT 0,
        created_at DATETIME(3) NOT NULL,
        updated_at DATETIME(3) NOT NULL,
        PRIMARY KEY (id),
        KEY idx_feedback_status_created_at (status, created_at),
        KEY idx_feedback_created_at (created_at),
        KEY idx_feedback_user_id (user_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS feedback_images (
        id CHAR(36) NOT NULL,
        feedback_id CHAR(36) NOT NULL,
        storage_id VARCHAR(64) NOT NULL,
        file_name VARCHAR(255) NOT NULL,
        content_type VARCHAR(64) NOT NULL,
        size BIGINT UNSIGNED NOT NULL,
        created_at DATETIME(3) NOT NULL,
        PRIMARY KEY (id),
        KEY idx_feedback_images_feedback_id (feedback_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS forum_posts (
        id CHAR(36) NOT NULL,
        author_user_id BIGINT UNSIGNED NOT NULL,
        title VARCHAR(80) NOT NULL,
        body TEXT NOT NULL,
        like_count INT UNSIGNED NOT NULL DEFAULT 0,
        comment_count INT UNSIGNED NOT NULL DEFAULT 0,
        created_at DATETIME(3) NOT NULL,
        updated_at DATETIME(3) NOT NULL,
        status TINYINT UNSIGNED NOT NULL DEFAULT 0,
        deleted_at DATETIME(3) NULL,
        deleted_by BIGINT UNSIGNED NULL,
        PRIMARY KEY (id),
        KEY idx_forum_posts_status_feed (status, created_at, id),
        KEY idx_forum_posts_author (author_user_id, created_at, id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS forum_post_images (
        id CHAR(36) NOT NULL,
        post_id CHAR(36) NOT NULL,
        storage_id VARCHAR(64) NOT NULL,
        file_name VARCHAR(255) NOT NULL,
        content_type VARCHAR(64) NOT NULL,
        size BIGINT UNSIGNED NOT NULL,
        width INT UNSIGNED NOT NULL,
        height INT UNSIGNED NOT NULL,
        created_at DATETIME(3) NOT NULL,
        PRIMARY KEY (id),
        KEY idx_forum_post_images_post (post_id, created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS forum_post_likes (
        post_id CHAR(36) NOT NULL,
        user_id BIGINT UNSIGNED NOT NULL,
        created_at DATETIME(3) NOT NULL,
        PRIMARY KEY (post_id, user_id),
        KEY idx_forum_post_likes_user (user_id, post_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS forum_comments (
        id CHAR(36) NOT NULL,
        post_id CHAR(36) NOT NULL,
        author_user_id BIGINT UNSIGNED NOT NULL,
        content TEXT NOT NULL,
        like_count INT UNSIGNED NOT NULL DEFAULT 0,
        created_at DATETIME(3) NOT NULL,
        updated_at DATETIME(3) NOT NULL,
        status TINYINT UNSIGNED NOT NULL DEFAULT 0,
        deleted_at DATETIME(3) NULL,
        deleted_by BIGINT UNSIGNED NULL,
        PRIMARY KEY (id),
        KEY idx_forum_comments_status_rank (post_id, status, like_count, created_at, id),
        KEY idx_forum_comments_author (author_user_id, created_at, id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS forum_comment_likes (
        comment_id CHAR(36) NOT NULL,
        user_id BIGINT UNSIGNED NOT NULL,
        created_at DATETIME(3) NOT NULL,
        PRIMARY KEY (comment_id, user_id),
        KEY idx_forum_comment_likes_user (user_id, comment_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS forum_search_outbox (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        post_id CHAR(36) NOT NULL,
        operation ENUM('upsert', 'delete') NOT NULL,
        attempts INT UNSIGNED NOT NULL DEFAULT 0,
        next_attempt_at DATETIME(3) NOT NULL,
        locked_until DATETIME(3) NULL,
        last_error TEXT NOT NULL,
        created_at DATETIME(3) NOT NULL,
        processed_at DATETIME(3) NULL,
        PRIMARY KEY (id),
        KEY idx_forum_search_outbox_ready (processed_at, next_attempt_at, locked_until, id),
        KEY idx_forum_search_outbox_post (post_id, id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS hosted_games (
        game_id VARCHAR(200) NOT NULL,
        published_metadata_json JSON NULL,
        latest_version VARCHAR(100) NULL,
        owner_user_id BIGINT UNSIGNED NOT NULL,
        owner_github_login VARCHAR(255) NOT NULL DEFAULT '',
        updated_by_user_id BIGINT UNSIGNED NOT NULL,
        updated_by_github_login VARCHAR(255) NOT NULL DEFAULT '',
        created_at DATETIME(3) NOT NULL,
        updated_at DATETIME(3) NOT NULL,
        PRIMARY KEY (game_id),
        KEY idx_hosted_games_updated_at (updated_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS hosted_game_metadata_revisions (
        id CHAR(36) NOT NULL,
        game_id VARCHAR(200) NOT NULL,
        metadata_json JSON NOT NULL,
        status ENUM('pending', 'approved', 'rejected') NOT NULL DEFAULT 'pending',
        review_reason TEXT NOT NULL,
        submitter_user_id BIGINT UNSIGNED NOT NULL,
        submitter_github_login VARCHAR(255) NOT NULL DEFAULT '',
        reviewer_user_id BIGINT UNSIGNED NULL,
        reviewer_github_login VARCHAR(255) NOT NULL DEFAULT '',
        reviewed_at DATETIME(3) NULL,
        created_at DATETIME(3) NOT NULL,
        updated_at DATETIME(3) NOT NULL,
        PRIMARY KEY (id),
        KEY idx_hosted_game_revisions_game_status (game_id, status),
        KEY idx_hosted_game_revisions_updated_at (updated_at),
        CONSTRAINT fk_hosted_game_revisions_game
          FOREIGN KEY (game_id) REFERENCES hosted_games (game_id)
          ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS hosted_game_versions (
        id CHAR(36) NOT NULL,
        game_id VARCHAR(200) NOT NULL,
        version VARCHAR(100) NOT NULL,
        metadata_json JSON NOT NULL,
        status ENUM('pending', 'approved', 'rejected') NOT NULL DEFAULT 'pending',
        initial_revision_id CHAR(36) NULL,
        review_reason TEXT NOT NULL,
        uploader_user_id BIGINT UNSIGNED NOT NULL,
        uploader_github_login VARCHAR(255) NOT NULL DEFAULT '',
        reviewer_user_id BIGINT UNSIGNED NULL,
        reviewer_github_login VARCHAR(255) NOT NULL DEFAULT '',
        reviewed_at DATETIME(3) NULL,
        created_at DATETIME(3) NOT NULL,
        updated_at DATETIME(3) NOT NULL,
        PRIMARY KEY (id),
        UNIQUE KEY uniq_hosted_game_versions_game_version (game_id, version),
        KEY idx_hosted_game_versions_game_status (game_id, status),
        KEY idx_hosted_game_versions_created_at (created_at),
        CONSTRAINT fk_hosted_game_versions_game
          FOREIGN KEY (game_id) REFERENCES hosted_games (game_id)
          ON DELETE CASCADE,
        CONSTRAINT fk_hosted_game_versions_initial_revision
          FOREIGN KEY (initial_revision_id) REFERENCES hosted_game_metadata_revisions (id)
          ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS hosted_game_assets (
        id CHAR(36) NOT NULL,
        version_id CHAR(36) NOT NULL,
        role ENUM('package', 'icon', 'cover') NOT NULL,
        original_name VARCHAR(255) NOT NULL,
        storage_name VARCHAR(64) NOT NULL,
        content_type VARCHAR(64) NOT NULL,
        size BIGINT UNSIGNED NOT NULL,
        sha256 CHAR(64) NOT NULL,
        created_at DATETIME(3) NOT NULL,
        PRIMARY KEY (id),
        UNIQUE KEY uniq_hosted_game_assets_version_role (version_id, role),
        KEY idx_hosted_game_assets_created_at (created_at),
        CONSTRAINT fk_hosted_game_assets_version
          FOREIGN KEY (version_id) REFERENCES hosted_game_versions (id)
          ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
  }

  async function ensureReady() {
    if (!config.MYSQL_USER) {
      throw new Error("mysql_not_configured");
    }
    if (pool) return pool;
    if (!initPromise) {
      initPromise = (async () => {
        pool = mysql.createPool({
          host: config.MYSQL_HOST,
          port: config.MYSQL_PORT,
          user: config.MYSQL_USER,
          password: config.MYSQL_PASSWORD,
          database: config.MYSQL_DATABASE,
          waitForConnections: true,
          connectionLimit: 10,
          namedPlaceholders: true,
          charset: "utf8mb4",
        });
        await pool.query("SELECT 1");
        await ensureSchema();
        return pool;
      })().catch((error) => {
        initPromise = null;
        if (pool) {
          pool.end().catch(() => {});
        }
        pool = null;
        throw error;
      });
    }
    return initPromise;
  }

  function isEnabled() {
    return Boolean(config.MYSQL_USER);
  }

  async function query(sql, params = []) {
    await ensureReady();
    return pool.query(sql, params);
  }

  async function transaction(callback) {
    await ensureReady();
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const result = await callback(connection);
      await connection.commit();
      return result;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  return {
    ensureReady,
    isEnabled,
    query,
    transaction,
  };
}
