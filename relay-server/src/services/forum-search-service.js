function encodePath(value) {
  return encodeURIComponent(String(value));
}

function toBasicAuth(username, password) {
  if (!username) return "";
  return `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
}

function isNotFound(error) {
  return error?.status === 404;
}

export function createForumSearchService({ config }) {
  const baseUrl = String(config.ELASTICSEARCH_URL || "").replace(/\/+$/, "");
  const alias = String(config.ELASTICSEARCH_INDEX_ALIAS || "bz_forum_posts");
  const physicalIndex = `${alias}_v1`;
  const enabled = config.ELASTICSEARCH_ENABLED === true && Boolean(baseUrl);
  const authorization = toBasicAuth(
    config.ELASTICSEARCH_USERNAME,
    config.ELASTICSEARCH_PASSWORD,
  );
  let ensurePromise = null;

  async function request(path, options = {}) {
    if (!enabled) throw Object.assign(new Error("search_unavailable"), { status: 503 });
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      Number(config.ELASTICSEARCH_REQUEST_TIMEOUT_MS) || 5000,
    );
    const headers = {
      accept: "application/json",
      "content-type": "application/json",
      ...(authorization ? { authorization } : {}),
      ...(options.headers || {}),
    };
    try {
      const response = await fetch(`${baseUrl}${path}`, {
        ...options,
        headers,
        signal: controller.signal,
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        const error = new Error(`elasticsearch_http_${response.status}`);
        error.status = response.status;
        error.body = body;
        throw error;
      }
      return body;
    } catch (error) {
      if (error?.name === "AbortError") {
        throw Object.assign(new Error("elasticsearch_timeout"), { status: 503 });
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  async function ensureIndex() {
    if (!enabled) return false;
    if (!ensurePromise) {
      ensurePromise = (async () => {
        try {
          await request(`/${encodePath(alias)}`);
          return true;
        } catch (error) {
          if (!isNotFound(error)) throw error;
        }

        const body = {
          settings: {
            number_of_shards: 1,
            number_of_replicas: 0,
            analysis: {
              analyzer: {
                forum_index: {
                  type: "custom",
                  tokenizer: "ik_max_word",
                },
                forum_search: {
                  type: "custom",
                  tokenizer: "ik_smart",
                },
              },
            },
          },
          mappings: {
            dynamic: "strict",
            properties: {
              postId: { type: "keyword" },
              title: {
                type: "text",
                analyzer: "forum_index",
                search_analyzer: "forum_search",
              },
              body: {
                type: "text",
                analyzer: "forum_index",
                search_analyzer: "forum_search",
              },
              createdAt: { type: "date" },
            },
          },
          aliases: {
            [alias]: {},
          },
        };
        try {
          await request(`/${encodePath(physicalIndex)}`, {
            method: "PUT",
            body: JSON.stringify(body),
          });
        } catch (error) {
          if (!error || error.status !== 400) throw error;
          await request(`/${encodePath(alias)}`);
        }
        return true;
      })().catch((error) => {
        ensurePromise = null;
        throw error;
      });
    }
    return ensurePromise;
  }

  async function upsertPost(post) {
    await ensureIndex();
    await request(`/${encodePath(alias)}/_doc/${encodePath(post.id)}`, {
      method: "PUT",
      body: JSON.stringify({
        postId: post.id,
        title: post.title,
        body: post.body,
        createdAt: post.createdAt,
      }),
    });
  }

  async function deletePost(postId) {
    await ensureIndex();
    try {
      await request(`/${encodePath(alias)}/_doc/${encodePath(postId)}`, {
        method: "DELETE",
      });
    } catch (error) {
      if (!isNotFound(error)) throw error;
    }
  }

  async function search(query, searchAfter, size = 10) {
    await ensureIndex();
    const body = {
      size,
      track_total_hits: false,
      _source: false,
      query: {
        multi_match: {
          query,
          fields: ["title^2", "body"],
          type: "best_fields",
        },
      },
      sort: ["_score", { createdAt: "desc" }, { postId: "desc" }],
    };
    if (Array.isArray(searchAfter) && searchAfter.length === 3) {
      body.search_after = searchAfter;
    }
    const response = await request(`/${encodePath(alias)}/_search`, {
      method: "POST",
      body: JSON.stringify(body),
    });
    const hits = Array.isArray(response?.hits?.hits)
      ? response.hits.hits
      : [];
    return {
      hits: hits
        .filter((hit) => hit && typeof hit._id === "string" && Array.isArray(hit.sort))
        .map((hit) => ({ id: hit._id, sort: hit.sort })),
    };
  }

  return {
    isEnabled: () => enabled,
    ensureIndex,
    upsertPost,
    deletePost,
    search,
  };
}
