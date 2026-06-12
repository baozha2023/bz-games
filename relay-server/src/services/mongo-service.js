import { GridFSBucket, MongoClient } from "mongodb";

export function createMongoService({ config }) {
  let client = null;
  let database = null;
  let bucket = null;
  let initPromise = null;

  async function ensureReady() {
    if (!config.MONGODB_URI) {
      throw new Error("mongodb_not_configured");
    }
    if (database) return database;
    if (!initPromise) {
      initPromise = (async () => {
        client = new MongoClient(config.MONGODB_URI);
        await client.connect();
        database = client.db(config.MONGODB_DB_NAME);
        bucket = new GridFSBucket(database, { bucketName: config.MONGODB_BUCKET_NAME });
        return database;
      })().catch((error) => {
        initPromise = null;
        client = null;
        database = null;
        bucket = null;
        throw error;
      });
    }
    return initPromise;
  }

  function isEnabled() {
    return Boolean(config.MONGODB_URI);
  }

  function getBucket() {
    if (!bucket) {
      throw new Error("mongodb_not_ready");
    }
    return bucket;
  }

  return {
    ensureReady,
    getBucket,
    isEnabled,
  };
}
