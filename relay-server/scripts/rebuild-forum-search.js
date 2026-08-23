import { config } from "../src/config.js";
import { createForumSearchService } from "../src/services/forum-search-service.js";
import { createMySqlService } from "../src/services/mysql-service.js";

if (!config.ELASTICSEARCH_ENABLED || !config.ELASTICSEARCH_URL) {
  throw new Error("ELASTICSEARCH_ENABLED=true and ELASTICSEARCH_URL are required");
}

const mySqlService = createMySqlService({ config });
const searchService = createForumSearchService({ config });
await mySqlService.ensureReady();
await searchService.ensureIndex();
const [rows] = await mySqlService.query(
  `SELECT id, title, body, created_at
   FROM forum_posts
   WHERE status = 0
   ORDER BY created_at ASC, id ASC`,
);
for (const row of rows) {
  await searchService.upsertPost({
    id: String(row.id),
    title: row.title,
    body: row.body,
    createdAt: new Date(row.created_at).toISOString(),
  });
}
console.log(`Forum search index rebuilt: ${rows.length} posts`);
