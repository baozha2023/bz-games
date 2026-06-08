declare const __BZ_CDN_BASE__: string;
declare const __BZ_OSS_BASE__: string;
declare const __BZ_MARKET_FALLBACK_INDEX_URL__: string;
declare const __BZ_REFERER__: string;
declare const __BZ_RELAY_SERVER_URL__: string;
declare const __BZ_RELAY_PUBLIC_HOST__: string;
declare const __BZ_RELAY_TOKEN__: string;
declare const __BZ_CONFIG_ENCRYPTION_SEED__: string;

export const CDN_BASE = __BZ_CDN_BASE__;

export const OSS_BASE = __BZ_OSS_BASE__;

export const MARKET_PRIMARY_INDEX_URL = "https://raw.githubusercontent.com/baozha2023/bz-games-market/master/market.json";

export const MARKET_FALLBACK_INDEX_URL = __BZ_MARKET_FALLBACK_INDEX_URL__;

export const GITHUB_API_BASE = "https://api.github.com/";

export const GITHUB_RAW_BASE = "https://raw.githubusercontent.com/";

export const REFERER = __BZ_REFERER__;

export const DEFAULT_RELAY_SERVER_URL = __BZ_RELAY_SERVER_URL__;

export const DEFAULT_RELAY_PUBLIC_HOST = __BZ_RELAY_PUBLIC_HOST__;

export const DEFAULT_RELAY_TOKEN = __BZ_RELAY_TOKEN__;

export const CONFIG_ENCRYPTION_SEED = __BZ_CONFIG_ENCRYPTION_SEED__;

export const LAN_DISCOVERY_PORT = 38081;

export const LAN_DISCOVERY_QUERY = "bz-games:room-discovery:query";

export const LAN_DISCOVERY_RESPONSE = "bz-games:room-discovery:response";

export const PLAYTIME_REWARD_INTERVAL_MS = 10 * 60 * 1000;

export const PLAYTIME_REWARD_AMOUNT = 10;

export const FLOAT_BALL_DEFAULT_SIZE = 72;

export const DB_DIR = "db";

export const DB_FILE_NAME = "db/play_sessions.db";
