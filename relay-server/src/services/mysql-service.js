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
        avatar_url TEXT NOT NULL,
        profile_url TEXT NOT NULL,
        email VARCHAR(255) NOT NULL DEFAULT '',
        created_at DATETIME(3) NOT NULL,
        updated_at DATETIME(3) NOT NULL,
        last_login_at DATETIME(3) NOT NULL,
        PRIMARY KEY (id),
        UNIQUE KEY uniq_users_github_id (github_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
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
      CREATE TABLE IF NOT EXISTS user_file_refs (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        user_id BIGINT UNSIGNED NOT NULL,
        file_key VARCHAR(64) NOT NULL,
        file_storage_id VARCHAR(64) NOT NULL,
        version BIGINT UNSIGNED NOT NULL,
        size BIGINT UNSIGNED NOT NULL,
        sha256 CHAR(64) NOT NULL,
        content_type VARCHAR(255) NOT NULL,
        created_at DATETIME(3) NOT NULL,
        updated_at DATETIME(3) NOT NULL,
        PRIMARY KEY (id),
        UNIQUE KEY uniq_user_file_refs_user_file (user_id, file_key)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS cloud_sync_limits (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        user_id BIGINT UNSIGNED NOT NULL,
        action_type ENUM('upload', 'download') NOT NULL,
        operation_id VARCHAR(64) NOT NULL,
        last_action_at DATETIME(3) NOT NULL,
        PRIMARY KEY (id),
        UNIQUE KEY uniq_cloud_sync_limits_user_action (user_id, action_type),
        KEY idx_cloud_sync_limits_last_action_at (last_action_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS cloud_sync_operation_files (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        user_id BIGINT UNSIGNED NOT NULL,
        action_type ENUM('upload', 'download') NOT NULL,
        operation_id VARCHAR(64) NOT NULL,
        file_key VARCHAR(64) NOT NULL,
        created_at DATETIME(3) NOT NULL,
        PRIMARY KEY (id),
        UNIQUE KEY uniq_cloud_sync_operation_file (user_id, action_type, operation_id, file_key),
        KEY idx_cloud_sync_operation_files_created_at (created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS feedback (
        id CHAR(36) NOT NULL,
        content TEXT NOT NULL,
        status ENUM('new', 'reviewing', 'planned', 'resolved', 'closed') NOT NULL DEFAULT 'new',
        admin_note TEXT NOT NULL,
        submitter_type ENUM('anonymous', 'github') NOT NULL,
        user_id BIGINT UNSIGNED NULL,
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
