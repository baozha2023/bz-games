<template>
  <n-space vertical :size="18">
    <n-card v-if="auth.can('hosting.capacity.view')">
      <n-space justify="space-between" align="center">
        <div>
          <strong>托管容量</strong>
          <div class="muted">
            已使用 {{ formatBytes(usedBytes) }} /
            {{ formatBytes(maxTotalBytes) }}
          </div>
        </div>
      </n-space>
      <n-progress
        type="line"
        :percentage="usagePercent"
        :indicator-placement="'inside'"
        style="margin-top: 14px"
      />
    </n-card>

    <n-card title="托管游戏">
      <template #header-extra>
        <n-button
          v-if="auth.can('hosting.game.create')"
          type="primary"
          @click="openCreateGame"
          >新增</n-button
        >
      </template>
      <n-space align="center" style="margin-bottom: 16px">
        <n-input
          v-model:value="query"
          clearable
          placeholder="搜索游戏 ID、名称、版本或文件名"
          style="width: 360px"
          @keyup.enter="applySearch"
        />
        <n-button type="primary" @click="applySearch">查询</n-button>
        <n-button @click="resetSearch">重置</n-button>
      </n-space>
      <n-data-table
        :columns="columns"
        :data="treeRows"
        :loading="loading"
        :row-key="(row: TreeRow) => row.key"
        :scroll-x="1520"
        default-expand-all
      />
      <n-pagination
        v-model:page="page"
        :page-size="pageSize"
        :item-count="total"
        show-size-picker
        :page-sizes="[10, 20, 50, 100]"
        style="margin-top: 16px; justify-content: flex-end"
        @update:page="load"
        @update:page-size="changePageSize"
      />
    </n-card>
  </n-space>

  <GameHostingForm
    v-model:show="showFormModal"
    v-model:active-tab="activeTab"
    v-model:manifest-enabled="manifestEnabled"
    v-model:set-latest="setLatest"
    v-model:game="gameForm"
    v-model:version="versionForm"
    v-model:manifest="manifestForm"
    :mode="formMode"
    :title="formTitle"
    :can-publish-direct="auth.can('hosting.publish.direct')"
    :saving="saving"
    :upload-progress="uploadProgress"
    :max-package-bytes="maxPackageBytes"
    :max-image-bytes="maxImageBytes"
    :file-input-key="fileInputKey"
    :files="files"
    :existing-assets="editingVersion?.assets || []"
    :can-upload-version-images="canUploadVersionImages"
    @select-asset="selectAsset"
    @next="nextStep"
    @previous="previousStep"
    @submit="submitForm"
  />

  <n-modal
    v-model:show="showDeleteModal"
    preset="card"
    title="确认删除"
    style="width: 500px"
  >
    <p>{{ deleteMessage }}</p>
    <template #action>
      <n-space justify="end">
        <n-button @click="showDeleteModal = false">取消</n-button>
        <n-button type="error" :loading="deleting" @click="confirmDelete"
          >删除</n-button
        >
      </n-space>
    </template>
  </n-modal>

  <n-modal
    v-model:show="showReviewModal"
    preset="card"
    :title="reviewDecision === 'approved' ? '通过审核' : '驳回投稿'"
    style="width: 520px"
  >
    <n-space vertical :size="16">
      <n-input
        v-if="reviewDecision === 'rejected'"
        v-model:value="reviewReason"
        type="textarea"
        :rows="5"
        maxlength="2000"
        show-count
        placeholder="必须填写驳回原因"
      />
      <n-form-item
        v-if="reviewDecision === 'approved' && reviewTarget?.kind === 'version'"
        label="设为最新版本"
      >
        <n-switch v-model:value="reviewSetLatest" />
      </n-form-item>
    </n-space>
    <template #action>
      <n-space justify="end">
        <n-button :disabled="reviewing" @click="showReviewModal = false"
          >取消</n-button
        >
        <n-button
          :type="reviewDecision === 'approved' ? 'primary' : 'error'"
          :loading="reviewing"
          @click="submitReview"
          >确认</n-button
        >
      </n-space>
    </template>
  </n-modal>
</template>

<script setup lang="ts">
import { computed, h, onMounted, reactive, ref } from "vue";
import {
  NButton,
  NSpace,
  NTag,
  type DataTableColumns,
  useMessage,
} from "naive-ui";
import { useRouter } from "vue-router";
import { api, ApiError, upload } from "../api";
import { useAuthStore } from "../stores/auth";
import GameHostingForm from "../components/GameHostingForm.vue";
import {
  buildEntrySpecificManifestFields,
  validateManifestRuntimeRelations,
} from "../utils/manifest-entry";

type FormMode = "create-game" | "add-version" | "edit-game" | "edit-version";
type AssetRole = "package" | "icon" | "cover";
type Locale = "zh-CN" | "zh-TW" | "en-US" | "ja-JP" | "de-DE";
const SUPPORTED_LOCALES: Locale[] = [
  "zh-CN",
  "zh-TW",
  "en-US",
  "ja-JP",
  "de-DE",
];

interface GameMetadata {
  id: string;
  defaultLocale: Locale;
  localizations: Record<
    Locale,
    { name: string; summary: string; tags: string[] }
  >;
  author: string;
  author_url?: string;
  type: string;
  iconUrl?: string;
  coverUrl?: string;
  screenshots?: string[];
  featured?: boolean;
  visibility?: string;
  minPlayers?: number;
  maxPlayers?: number;
}
interface VersionMetadata {
  version: string;
  localizations: Record<Locale, { description: string; releaseNotes?: string }>;
  platformVersion: string;
  publishedAt?: string;
  releaseNotes?: string;
  isPrerelease?: boolean;
  gameManifest?: Record<string, unknown>;
}
interface HostedAsset {
  id: string;
  role: AssetRole;
  fileName: string;
  contentType: string;
  size: number;
  sha256: string;
  createdAt: string;
  logicalUrl: string;
}
interface HostedVersion {
  id: string;
  version: string;
  metadata: VersionMetadata;
  status: "pending" | "approved" | "rejected";
  reviewReason: string;
  reviewer: string;
  reviewedAt?: string;
  uploader: string;
  createdAt: string;
  updatedAt: string;
  assets: HostedAsset[];
}
interface HostedRevision {
  id: string;
  metadata: GameMetadata;
  status: "pending" | "approved" | "rejected";
  reviewReason: string;
  submitter: string;
  reviewer: string;
  reviewedAt?: string;
  createdAt: string;
  updatedAt: string;
}
interface HostedGame {
  gameId: string;
  metadata: GameMetadata;
  published: boolean;
  latestVersion: string | null;
  owner: string;
  updater: string;
  createdAt: string;
  updatedAt: string;
  revisions: HostedRevision[];
  versions: HostedVersion[];
}
interface TreeResponse {
  games: HostedGame[];
  total: number;
  page: number;
  pageSize: number;
  capacity?: { usedBytes: number; maxTotalBytes: number };
  maxPackageBytes: number;
  maxImageBytes: number;
  role: "creator" | "administrator" | "super_administrator";
}
interface TreeRow {
  key: string;
  kind: "game" | "revision" | "version" | "asset";
  label: string;
  status?: string;
  size?: number;
  sha256?: string;
  uploader?: string;
  createdAt?: string;
  logicalUrl?: string;
  game: HostedGame;
  revision?: HostedRevision;
  version?: HostedVersion;
  asset?: HostedAsset;
  children?: TreeRow[];
}
interface EnvRow {
  key: string;
  value: string;
}
interface StatisticRow {
  id: string;
  mode: "increment" | "full";
  labels: Record<Locale, string>;
}
interface AchievementRow {
  id: string;
  icon: string;
  translations: Record<Locale, { title: string; description: string }>;
}

const GAME_ID_PATTERN = /^[a-z0-9]+(?:\.[a-z0-9-]+)+$/;
const SEMVER_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const router = useRouter();
const auth = useAuthStore();
const message = useMessage();
const games = ref<HostedGame[]>([]);
const loading = ref(false);
const saving = ref(false);
const deleting = ref(false);
const showFormModal = ref(false);
const showDeleteModal = ref(false);
const showReviewModal = ref(false);
const activeTab = ref("game");
const formMode = ref<FormMode>("create-game");
const editingGame = ref<HostedGame | null>(null);
const editingVersion = ref<HostedVersion | null>(null);
const deleteTarget = ref<{
  game: HostedGame;
  version?: HostedVersion;
  revision?: HostedRevision;
} | null>(null);
const reviewTarget = ref<
  | { kind: "version"; item: HostedVersion }
  | { kind: "revision"; item: HostedRevision }
  | null
>(null);
const reviewDecision = ref<"approved" | "rejected">("approved");
const reviewReason = ref("");
const reviewSetLatest = ref(false);
const reviewing = ref(false);
const query = ref("");
const page = ref(1);
const pageSize = ref(20);
const total = ref(0);
const usedBytes = ref(0);
const maxPackageBytes = ref(100 * 1024 * 1024);
const maxImageBytes = ref(5 * 1024 * 1024);
const maxTotalBytes = ref(5 * 1024 * 1024 * 1024);
const uploadProgress = ref(0);
const setLatest = ref(true);
const manifestEnabled = ref(false);
const files = reactive<Record<AssetRole, File | null>>({
  package: null,
  icon: null,
  cover: null,
});
const fileInputKey = ref(0);
let loadSequence = 0;

const gameForm = reactive({
  id: "",
  defaultLocale: "zh-CN" as Locale,
  localizations: {} as Record<
    Locale,
    { enabled: boolean; name: string; summary: string; tagsText: string }
  >,
  author: "",
  author_url: "",
  type: "singleplayer",
  iconUrl: "",
  coverUrl: "",
  screenshotsText: "",
  featured: false,
  visibility: "public" as string | null,
  minPlayers: null as number | null,
  maxPlayers: null as number | null,
});
const versionForm = reactive({
  version: "",
  localizations: {} as Record<
    Locale,
    { description: string; releaseNotes: string }
  >,
  platformVersion: ">=3.1.0",
  publishedAt: null as number | null,
  isPrerelease: false,
});
const manifestForm = reactive({
  defaultLocale: "zh-CN" as Locale,
  localizations: {} as Record<Locale, { name: string; description: string }>,
  author: "",
  author_url: "",
  platformMode: "range" as "range" | "tuple",
  platformRange: "",
  platformMin: "",
  platformMax: "",
  entry: "",
  web_url: "",
  icon: "",
  cover: "",
  video: "",
  encryptLocalStorage: false,
  windowedFullscreen: false,
  type: null as string | null,
  minPlayers: null as number | null,
  maxPlayers: null as number | null,
  args: [] as string[],
  env: [] as EnvRow[],
  statistics: [] as StatisticRow[],
  achievements: [] as AchievementRow[],
});

const roleLabels: Record<AssetRole, string> = {
  package: "ZIP 游戏包",
  icon: "图标",
  cover: "封面",
};
const statusLabels: Record<string, string> = {
  pending: "待审核",
  approved: "已通过",
  rejected: "已驳回",
};

const canUploadVersionImages = computed(() => {
  if (formMode.value === "create-game") return true;
  const versionCount = editingGame.value?.versions.length ?? 0;
  if (formMode.value === "add-version") return versionCount === 0;
  return formMode.value === "edit-version" && versionCount === 1;
});
const formTitle = computed(
  () =>
    ({
      "create-game": "新增游戏",
      "add-version": `新增版本 · ${editingGame.value?.gameId || ""}`,
      "edit-game": `编辑游戏 · ${editingGame.value?.gameId || ""}`,
      "edit-version": `编辑版本 · ${editingGame.value?.gameId || ""}@${editingVersion.value?.version || ""}`,
    })[formMode.value],
);
const usagePercent = computed(() =>
  maxTotalBytes.value > 0
    ? Math.min(100, Math.round((usedBytes.value / maxTotalBytes.value) * 100))
    : 0,
);
const deleteMessage = computed(() =>
  deleteTarget.value?.version
    ? `将删除 ${deleteTarget.value.game.gameId}@${deleteTarget.value.version.version} 及其全部资源，无法恢复。`
    : deleteTarget.value?.revision
      ? `将删除 ${deleteTarget.value.game.gameId} 的公共信息修订，无法恢复。`
      : `将删除 ${deleteTarget.value?.game.gameId || ""} 的全部版本和资源，无法恢复。`,
);

function lines(value: string) {
  return value
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
}
function emptyGameLocalizations() {
  return Object.fromEntries(
    SUPPORTED_LOCALES.map((locale) => [
      locale,
      { enabled: locale === "zh-CN", name: "", summary: "", tagsText: "" },
    ]),
  ) as Record<
    Locale,
    { enabled: boolean; name: string; summary: string; tagsText: string }
  >;
}
function emptyVersionLocalizations() {
  return Object.fromEntries(
    SUPPORTED_LOCALES.map((locale) => [
      locale,
      { description: "", releaseNotes: "" },
    ]),
  ) as Record<Locale, { description: string; releaseNotes: string }>;
}
function emptyManifestLocalizations() {
  return Object.fromEntries(
    SUPPORTED_LOCALES.map((locale) => [locale, { name: "", description: "" }]),
  ) as Record<Locale, { name: string; description: string }>;
}
function formatBytes(value = 0) {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "KiB", "MiB", "GiB"];
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), 3);
  return `${(value / 1024 ** index).toFixed(index ? 2 : 0)} ${units[index]}`;
}
function formatTime(value?: string) {
  return value ? new Date(value).toLocaleString() : "-";
}
function localizedGameName(metadata: GameMetadata) {
  return (
    metadata.localizations?.[metadata.defaultLocale]?.name ||
    Object.values(metadata.localizations || {})[0]?.name ||
    metadata.id
  );
}

function resetForms() {
  Object.assign(gameForm, {
    id: "",
    defaultLocale: "zh-CN",
    localizations: emptyGameLocalizations(),
    author: "",
    author_url: "",
    type: "singleplayer",
    iconUrl: "",
    coverUrl: "",
    screenshotsText: "",
    featured: false,
    visibility: "public",
    minPlayers: null,
    maxPlayers: null,
  });
  Object.assign(versionForm, {
    version: "",
    localizations: emptyVersionLocalizations(),
    platformVersion: ">=3.1.0",
    publishedAt: null,
    isPrerelease: false,
  });
  Object.assign(manifestForm, {
    defaultLocale: "zh-CN",
    localizations: emptyManifestLocalizations(),
    author: "",
    author_url: "",
    platformMode: "range",
    platformRange: "",
    platformMin: "",
    platformMax: "",
    entry: "",
    web_url: "",
    icon: "",
    cover: "",
    video: "",
    encryptLocalStorage: false,
    windowedFullscreen: false,
    type: null,
    minPlayers: null,
    maxPlayers: null,
    args: [],
    env: [],
    statistics: [],
    achievements: [],
  });
  manifestEnabled.value = false;
  setLatest.value = true;
  uploadProgress.value = 0;
  files.package = null;
  files.icon = null;
  files.cover = null;
  fileInputKey.value += 1;
}

function hydrateGame(metadata: GameMetadata) {
  const localizations = emptyGameLocalizations();
  for (const locale of SUPPORTED_LOCALES) {
    const value = metadata.localizations?.[locale];
    if (value)
      localizations[locale] = {
        enabled: true,
        name: value.name || "",
        summary: value.summary || "",
        tagsText: (value.tags || []).join("\n"),
      };
  }
  Object.assign(gameForm, {
    id: metadata.id,
    defaultLocale: metadata.defaultLocale || "zh-CN",
    localizations,
    author: metadata.author || "",
    author_url: metadata.author_url || "",
    type: metadata.type || "singleplayer",
    iconUrl: metadata.iconUrl || "",
    coverUrl: metadata.coverUrl || "",
    screenshotsText: (metadata.screenshots || []).join("\n"),
    featured: metadata.featured || false,
    visibility: metadata.visibility || null,
    minPlayers: metadata.minPlayers || null,
    maxPlayers: metadata.maxPlayers || null,
  });
}
function hydrateVersion(metadata: VersionMetadata) {
  const localizations = emptyVersionLocalizations();
  for (const locale of SUPPORTED_LOCALES) {
    const value = metadata.localizations?.[locale];
    if (value)
      localizations[locale] = {
        description: value.description || "",
        releaseNotes: value.releaseNotes || "",
      };
  }
  Object.assign(versionForm, {
    version: metadata.version,
    localizations,
    platformVersion: metadata.platformVersion,
    publishedAt: metadata.publishedAt ? Date.parse(metadata.publishedAt) : null,
    isPrerelease: metadata.isPrerelease || false,
  });
  const manifest = metadata.gameManifest as Record<string, unknown> | undefined;
  manifestEnabled.value = !!manifest;
  if (!manifest) return;
  const manifestLocalizations = emptyManifestLocalizations();
  for (const locale of SUPPORTED_LOCALES) {
    const value = (
      manifest.localizations as
        | Record<string, Record<string, unknown>>
        | undefined
    )?.[locale];
    if (value)
      manifestLocalizations[locale] = {
        name: typeof value.name === "string" ? value.name : "",
        description:
          typeof value.description === "string" ? value.description : "",
      };
  }
  const statistics = Array.isArray(manifest.statistics)
    ? (manifest.statistics as Array<Record<string, unknown>>).map((item) => {
        const labels = Object.fromEntries(
          SUPPORTED_LOCALES.map((locale) => [locale, ""]),
        ) as Record<Locale, string>;
        for (const locale of SUPPORTED_LOCALES) {
          const label = (
            manifest.localizations as
              | Record<string, Record<string, unknown>>
              | undefined
          )?.[locale]?.statistics as Record<string, unknown> | undefined;
          if (label && typeof label[item.id as string] === "string")
            labels[locale] = label[item.id as string] as string;
        }
        return {
          id: String(item.id || ""),
          mode: item.mode === "full" ? "full" : "increment",
          labels,
        } as StatisticRow;
      })
    : [];
  const achievements = Array.isArray(manifest.achievements)
    ? (manifest.achievements as Array<Record<string, unknown>>).map((item) => {
        const translations = Object.fromEntries(
          SUPPORTED_LOCALES.map((locale) => [
            locale,
            { title: "", description: "" },
          ]),
        ) as Record<Locale, { title: string; description: string }>;
        for (const locale of SUPPORTED_LOCALES) {
          const localized = (
            manifest.localizations as
              | Record<string, Record<string, unknown>>
              | undefined
          )?.[locale]?.achievements as Record<string, unknown> | undefined;
          const value = localized?.[item.id as string] as
            | Record<string, unknown>
            | undefined;
          if (value)
            translations[locale] = {
              title: typeof value.title === "string" ? value.title : "",
              description:
                typeof value.description === "string" ? value.description : "",
            };
        }
        return {
          id: String(item.id || ""),
          icon: typeof item.icon === "string" ? item.icon : "",
          translations,
        } as AchievementRow;
      })
    : [];
  const platform = manifest.platformVersion;
  const multiplayer = manifest.multiplayer as
    | { minPlayers?: number; maxPlayers?: number }
    | undefined;
  Object.assign(manifestForm, {
    defaultLocale: (manifest.defaultLocale as Locale) || gameForm.defaultLocale,
    localizations: manifestLocalizations,
    author: manifest.author || "",
    author_url: manifest.author_url || "",
    platformMode: Array.isArray(platform) ? "tuple" : "range",
    platformRange: typeof platform === "string" ? platform : "",
    platformMin: Array.isArray(platform) ? platform[0] : "",
    platformMax: Array.isArray(platform) ? platform[1] : "",
    entry: manifest.entry || "",
    web_url: manifest.web_url || "",
    icon: manifest.icon || "",
    cover: manifest.cover || "",
    video: manifest.video || "",
    encryptLocalStorage: !!manifest.encryptLocalStorage,
    windowedFullscreen: manifest.windowedFullscreen === true,
    type: manifest.type || null,
    minPlayers: multiplayer?.minPlayers || null,
    maxPlayers: multiplayer?.maxPlayers || null,
    args: Array.isArray(manifest.args) ? [...manifest.args] : [],
    env: Object.entries((manifest.env as Record<string, string>) || {}).map(
      ([key, value]) => ({ key, value }),
    ),
    statistics,
    achievements,
  });
}

function buildGamePayload(): GameMetadata {
  const payload: GameMetadata = {
    id: gameForm.id.trim(),
    defaultLocale: gameForm.defaultLocale,
    localizations: Object.fromEntries(
      SUPPORTED_LOCALES.filter(
        (locale) => gameForm.localizations[locale]?.enabled,
      ).map((locale) => [
        locale,
        {
          name: gameForm.localizations[locale].name.trim(),
          summary: gameForm.localizations[locale].summary.trim(),
          tags: lines(gameForm.localizations[locale].tagsText),
        },
      ]),
    ) as Record<Locale, { name: string; summary: string; tags: string[] }>,
    author: gameForm.author.trim(),
    type: gameForm.type,
  };
  if (gameForm.author_url.trim())
    payload.author_url = gameForm.author_url.trim();
  if (gameForm.iconUrl.trim()) payload.iconUrl = gameForm.iconUrl.trim();
  if (gameForm.coverUrl.trim()) payload.coverUrl = gameForm.coverUrl.trim();
  const screenshots = lines(gameForm.screenshotsText);
  if (screenshots.length) payload.screenshots = screenshots;
  if (gameForm.featured) payload.featured = true;
  if (gameForm.visibility) payload.visibility = gameForm.visibility;
  if (gameForm.minPlayers) payload.minPlayers = gameForm.minPlayers;
  if (gameForm.maxPlayers) payload.maxPlayers = gameForm.maxPlayers;
  return payload;
}
function buildManifest(): Record<string, unknown> | undefined {
  if (!manifestEnabled.value) return undefined;
  const result: Record<string, unknown> = {
    manifestVersion: 2,
    defaultLocale: manifestForm.defaultLocale,
    localizations: Object.fromEntries(
      SUPPORTED_LOCALES.filter(
        (locale) => gameForm.localizations[locale]?.enabled,
      ).map((locale) => [
        locale,
        {
          name: manifestForm.localizations[locale].name.trim(),
          description: manifestForm.localizations[locale].description.trim(),
          achievements: Object.fromEntries(
            manifestForm.achievements
              .filter((item) => item.id.trim())
              .map((item) => [item.id.trim(), item.translations[locale]]),
          ),
          statistics: Object.fromEntries(
            manifestForm.statistics
              .filter((item) => item.id.trim())
              .map((item) => [item.id.trim(), item.labels[locale].trim()]),
          ),
        },
      ]),
    ),
  };
  for (const key of [
    "author",
    "author_url",
    "entry",
    "web_url",
    "icon",
    "cover",
    "video",
  ] as const) {
    const value = manifestForm[key].trim();
    if (value) result[key] = value;
  }
  if (
    manifestForm.platformMode === "range" &&
    manifestForm.platformRange.trim()
  )
    result.platformVersion = manifestForm.platformRange.trim();
  if (
    manifestForm.platformMode === "tuple" &&
    manifestForm.platformMin.trim() &&
    manifestForm.platformMax.trim()
  )
    result.platformVersion = [
      manifestForm.platformMin.trim(),
      manifestForm.platformMax.trim(),
    ];
  if (manifestForm.encryptLocalStorage) result.encryptLocalStorage = true;
  if (manifestForm.type) result.type = manifestForm.type;
  if (manifestForm.minPlayers && manifestForm.maxPlayers)
    result.multiplayer = {
      minPlayers: manifestForm.minPlayers,
      maxPlayers: manifestForm.maxPlayers,
    };
  const args = manifestForm.args.map((item) => item.trim()).filter(Boolean);
  const env = Object.fromEntries(
    manifestForm.env
      .filter((item) => item.key.trim())
      .map((item) => [item.key.trim(), item.value]),
  );
  Object.assign(
    result,
    buildEntrySpecificManifestFields({
      entry: manifestForm.entry,
      windowedFullscreen: manifestForm.windowedFullscreen,
      args,
      env,
    }),
  );
  const statistics = manifestForm.statistics
    .filter((item) => item.id.trim())
    .map((item) => ({ id: item.id.trim(), mode: item.mode }));
  result.statistics = statistics;
  const achievements = manifestForm.achievements
    .filter((item) => item.id.trim())
    .map((item) => ({
      id: item.id.trim(),
      ...(item.icon.trim() ? { icon: item.icon.trim() } : {}),
    }));
  result.achievements = achievements;
  return result;
}
function buildVersionPayload(): VersionMetadata {
  const payload: VersionMetadata = {
    version: versionForm.version.trim(),
    localizations: Object.fromEntries(
      SUPPORTED_LOCALES.filter(
        (locale) => gameForm.localizations[locale]?.enabled,
      ).map((locale) => {
        const releaseNotes =
          versionForm.localizations[locale].releaseNotes.trim();
        return [
          locale,
          {
            description: versionForm.localizations[locale].description.trim(),
            ...(releaseNotes ? { releaseNotes } : {}),
          },
        ];
      }),
    ) as Record<Locale, { description: string; releaseNotes?: string }>,
    platformVersion: versionForm.platformVersion.trim(),
  };
  if (versionForm.publishedAt)
    payload.publishedAt = new Date(versionForm.publishedAt).toISOString();
  if (versionForm.isPrerelease) payload.isPrerelease = true;
  const manifest = buildManifest();
  if (manifest) payload.gameManifest = manifest;
  return payload;
}

function openCreateGame() {
  if (!auth.can("hosting.game.create")) return;
  resetForms();
  formMode.value = "create-game";
  editingGame.value = null;
  editingVersion.value = null;
  activeTab.value = "game";
  showFormModal.value = true;
}
function openAddVersion(game: HostedGame) {
  if (!auth.can("hosting.version.create")) return;
  resetForms();
  formMode.value = "add-version";
  editingGame.value = game;
  hydrateGame(game.metadata);
  manifestForm.defaultLocale = game.metadata.defaultLocale;
  activeTab.value = "version";
  showFormModal.value = true;
}
function openEditGame(game: HostedGame) {
  resetForms();
  formMode.value = "edit-game";
  editingGame.value = game;
  hydrateGame(game.metadata);
  activeTab.value = "game";
  showFormModal.value = true;
}
function openEditRevision(game: HostedGame, revision: HostedRevision) {
  resetForms();
  formMode.value = "edit-game";
  editingGame.value = game;
  hydrateGame(revision.metadata);
  activeTab.value = "game";
  showFormModal.value = true;
}
function openEditVersion(game: HostedGame, version: HostedVersion) {
  resetForms();
  formMode.value = "edit-version";
  editingGame.value = game;
  editingVersion.value = version;
  hydrateGame(game.metadata);
  hydrateVersion(version.metadata);
  activeTab.value = "version";
  showFormModal.value = true;
}

const wizardSteps = computed(() => {
  if (formMode.value === "edit-game") return ["game"];
  return formMode.value === "create-game"
    ? ["game", "version", "manifest", "advanced", "files"]
    : ["version", "manifest", "advanced", "files"];
});
function validateStep(step: string): string | null {
  if (step === "game") {
    const game = buildGamePayload();
    if (!GAME_ID_PATTERN.test(game.id) || !game.author || !game.type)
      return "请完整填写合法的游戏基本信息";
    const locales = Object.keys(game.localizations) as Locale[];
    if (!locales.includes(game.defaultLocale))
      return "默认语言必须启用并填写完整";
    if (
      !locales.length ||
      locales.some(
        (locale) =>
          !game.localizations[locale].name ||
          !game.localizations[locale].summary,
      )
    )
      return "每个已启用语言都必须填写名称和摘要";
    if (game.minPlayers && game.maxPlayers && game.minPlayers > game.maxPlayers)
      return "最少玩家不能大于最多玩家";
    if (files.icon && game.iconUrl) return "图标只能选择上传或外部地址其中一种";
    if (files.cover && game.coverUrl)
      return "封面只能选择上传或外部地址其中一种";
  }
  if (step === "version") {
    const version = buildVersionPayload();
    const locales = Object.keys(buildGamePayload().localizations) as Locale[];
    if (!SEMVER_PATTERN.test(version.version) || !version.platformVersion)
      return "请完整填写合法的版本信息";
    if (
      new Set(Object.keys(version.localizations)).size !== locales.length ||
      locales.some((locale) => !version.localizations[locale]?.description)
    )
      return "版本描述必须覆盖游戏的全部语言";
  }
  if (step === "manifest" && manifestEnabled.value) {
    const manifest = buildManifest()!;
    const locales = Object.keys(buildGamePayload().localizations) as Locale[];
    const localizations = manifest.localizations as Record<
      string,
      { name: string; description: string }
    >;
    if (manifest.defaultLocale !== gameForm.defaultLocale)
      return "Manifest 默认语言必须与游戏默认语言一致";
    if (
      !locales.includes(manifest.defaultLocale as Locale) ||
      locales.some(
        (locale) =>
          !localizations[locale]?.name || !localizations[locale]?.description,
      )
    )
      return "Manifest V2 的语言包必须完整覆盖游戏语言";
    const relationError = validateManifestRuntimeRelations({
      entry: manifest.entry,
      webUrl: manifest.web_url,
      type: manifest.type || gameForm.type,
      multiplayer: {
        minPlayers: manifestForm.minPlayers ?? gameForm.minPlayers,
        maxPlayers: manifestForm.maxPlayers ?? gameForm.maxPlayers,
      },
      encryptLocalStorage: manifestForm.encryptLocalStorage,
    });
    if (relationError === "entry_required") return "Manifest 必须填写入口";
    if (relationError === "web_url_required")
      return "entry 为 url 时必须填写 web_url";
    if (relationError === "web_url_forbidden")
      return "只有 entry 为 url 时才能填写 web_url";
    if (relationError === "network_entry_required")
      return "网页游戏必须使用 url 入口";
    if (relationError === "multiplayer_required")
      return "多人游戏必须填写完整的玩家人数范围";
    if (relationError === "multiplayer_forbidden")
      return "只有多人游戏类型才能填写玩家人数范围";
    if (relationError === "encrypt_local_storage_forbidden")
      return "本地存储加密只适用于网页游戏入口";
    const hasManifestMinPlayers = manifestForm.minPlayers !== null;
    const hasManifestMaxPlayers = manifestForm.maxPlayers !== null;
    if (hasManifestMinPlayers !== hasManifestMaxPlayers)
      return "Manifest 联机玩家数必须同时填写最少和最多玩家";
    if (
      hasManifestMinPlayers &&
      hasManifestMaxPlayers &&
      manifestForm.minPlayers! > manifestForm.maxPlayers!
    )
      return "Manifest 最少玩家不能大于最多玩家";
  }
  if (step === "advanced" && manifestEnabled.value) {
    const ids = manifestForm.statistics
      .map((item) => item.id.trim())
      .filter(Boolean);
    if (new Set(ids).size !== ids.length) return "统计 ID 不能重复";
    const achievementIds = manifestForm.achievements
      .map((item) => item.id.trim())
      .filter(Boolean);
    if (new Set(achievementIds).size !== achievementIds.length)
      return "成就 ID 不能重复";
    const locales = Object.keys(buildGamePayload().localizations) as Locale[];
    for (const item of manifestForm.statistics.filter((row) => row.id.trim()))
      if (locales.some((locale) => !item.labels[locale].trim()))
        return "统计名称必须覆盖全部语言";
    for (const item of manifestForm.achievements.filter((row) => row.id.trim()))
      if (
        locales.some(
          (locale) =>
            !item.translations[locale].title.trim() ||
            !item.translations[locale].description.trim(),
        )
      )
        return "成就标题和描述必须覆盖全部语言";
  }
  if (step === "files") {
    if (
      ["create-game", "add-version"].includes(formMode.value) &&
      (!files.package || !files.package.name.toLowerCase().endsWith(".zip"))
    )
      return "请选择 ZIP 游戏包";
    if (files.package && !files.package.name.toLowerCase().endsWith(".zip"))
      return "请选择 ZIP 游戏包";
    if (files.package && files.package.size > maxPackageBytes.value)
      return "ZIP 游戏包超过大小限制";
    if (!canUploadVersionImages.value && (files.icon || files.cover))
      return "只有游戏唯一版本可以上传图标和封面";
    for (const role of ["icon", "cover"] as const)
      if (files[role] && files[role]!.size > maxImageBytes.value)
        return `${roleLabels[role]}超过大小限制`;
  }
  return null;
}
function nextStep() {
  const error = validateStep(activeTab.value);
  if (error) {
    message.warning(error);
    return;
  }
  const index = wizardSteps.value.indexOf(activeTab.value);
  if (index >= 0 && index < wizardSteps.value.length - 1)
    activeTab.value = wizardSteps.value[index + 1];
}
function previousStep() {
  const index = wizardSteps.value.indexOf(activeTab.value);
  if (index > 0) activeTab.value = wizardSteps.value[index - 1];
}
function selectAsset(role: AssetRole, event: Event) {
  files[role] = (event.target as HTMLInputElement).files?.[0] || null;
}

async function submitForm() {
  if (
    (formMode.value === "create-game" && !auth.can("hosting.game.create")) ||
    (formMode.value === "add-version" && !auth.can("hosting.version.create")) ||
    (formMode.value.startsWith("edit-") &&
      !auth.can("hosting.own.manage") &&
      !auth.can("hosting.all.manage"))
  )
    return;
  try {
    for (const step of wizardSteps.value) {
      const error = validateStep(step);
      if (error) throw new Error(error);
    }
  } catch (error) {
    message.warning((error as Error).message);
    return;
  }

  saving.value = true;
  uploadProgress.value = 0;
  try {
    if (formMode.value === "edit-game") {
      await api(
        `/api/portal/v1/game-hosting/games/${encodeURIComponent(editingGame.value!.gameId)}`,
        { method: "PUT", body: JSON.stringify(buildGamePayload()) },
      );
    } else if (formMode.value === "edit-version") {
      const url = `/api/portal/v1/game-hosting/games/${encodeURIComponent(editingGame.value!.gameId)}/versions/${encodeURIComponent(editingVersion.value!.version)}`;
      if (files.package || files.icon || files.cover) {
        const form = new FormData();
        form.set("version", JSON.stringify(buildVersionPayload()));
        for (const role of ["package", "icon", "cover"] as const)
          if (files[role]) form.set(role, files[role]!, files[role]!.name);
        await upload(
          url,
          form,
          (percent) => (uploadProgress.value = percent),
          "PUT",
        );
      } else
        await api(url, {
          method: "PUT",
          body: JSON.stringify(buildVersionPayload()),
        });
    } else {
      const form = new FormData();
      if (formMode.value === "create-game")
        form.set("game", JSON.stringify(buildGamePayload()));
      form.set("version", JSON.stringify(buildVersionPayload()));
      if (auth.can("hosting.publish.direct"))
        form.set("setLatest", String(setLatest.value));
      for (const role of ["package", "icon", "cover"] as const)
        if (files[role]) form.set(role, files[role]!, files[role]!.name);
      const url =
        formMode.value === "create-game"
          ? "/api/portal/v1/game-hosting/games"
          : `/api/portal/v1/game-hosting/games/${encodeURIComponent(editingGame.value!.gameId)}/versions`;
      await upload(url, form, (percent) => (uploadProgress.value = percent));
    }
    message.success("保存成功");
    showFormModal.value = false;
    await load();
  } catch (error) {
    await handleError(error);
  } finally {
    saving.value = false;
  }
}

async function copyText(value: string, success: string) {
  let copied = false;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      copied = true;
    }
  } catch {
    // Clipboard API may be unavailable on HTTP or denied by browser policy.
  }
  if (!copied) {
    const textarea = document.createElement("textarea");
    textarea.value = value;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    textarea.style.pointerEvents = "none";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    textarea.setSelectionRange(0, textarea.value.length);
    try {
      copied = document.execCommand("copy");
    } catch {
      copied = false;
    }
    textarea.remove();
  }
  if (copied) {
    message.success(success);
    return;
  }
  message.error("复制失败，请检查浏览器剪贴板权限");
}
async function getConfig(gameId: string) {
  return await api<Record<string, unknown>>(
    `/api/portal/v1/game-hosting/games/${encodeURIComponent(gameId)}/config`,
  );
}
async function downloadConfig(game: HostedGame) {
  try {
    const content =
      JSON.stringify(await getConfig(game.gameId), null, 2) + "\n";
    const url = URL.createObjectURL(
      new Blob([content], { type: "application/json;charset=utf-8" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `${game.gameId}.json`;
    link.click();
    URL.revokeObjectURL(url);
  } catch (error) {
    await handleError(error);
  }
}
function downloadAsset(asset: HostedAsset) {
  const link = document.createElement("a");
  link.href = `/api/portal/v1/game-hosting/assets/${encodeURIComponent(asset.id)}/download`;
  link.download = asset.fileName;
  link.click();
}
async function makeLatest(game: HostedGame, version: HostedVersion) {
  if (!auth.can("hosting.all.manage")) return;
  try {
    await api(
      `/api/portal/v1/game-hosting/games/${encodeURIComponent(game.gameId)}/latest`,
      { method: "PUT", body: JSON.stringify({ version: version.version }) },
    );
    message.success("最新版本已更新");
    await load();
  } catch (error) {
    await handleError(error);
  }
}
function requestDelete(
  game: HostedGame,
  version?: HostedVersion,
  revision?: HostedRevision,
) {
  if (
    (!version && !revision && !auth.can("hosting.all.manage")) ||
    ((version || revision) &&
      !auth.can("hosting.own.manage") &&
      !auth.can("hosting.all.manage"))
  )
    return;
  deleteTarget.value = { game, version, revision };
  showDeleteModal.value = true;
}
async function confirmDelete() {
  if (!deleteTarget.value) return;
  const { version, revision } = deleteTarget.value;
  if (
    (!version && !revision && !auth.can("hosting.all.manage")) ||
    ((version || revision) &&
      !auth.can("hosting.own.manage") &&
      !auth.can("hosting.all.manage"))
  )
    return;
  deleting.value = true;
  try {
    const { game, version, revision } = deleteTarget.value;
    const url = revision
      ? `/api/portal/v1/game-hosting/revisions/${encodeURIComponent(revision.id)}`
      : version
        ? `/api/portal/v1/game-hosting/games/${encodeURIComponent(game.gameId)}/versions/${encodeURIComponent(version.version)}`
        : `/api/portal/v1/game-hosting/games/${encodeURIComponent(game.gameId)}`;
    await api(url, { method: "DELETE" });
    message.success("删除成功");
    showDeleteModal.value = false;
    deleteTarget.value = null;
    await load();
  } catch (error) {
    await handleError(error);
  } finally {
    deleting.value = false;
  }
}

function requestReview(
  kind: "version" | "revision",
  item: HostedVersion | HostedRevision,
  decision: "approved" | "rejected",
) {
  if (!auth.can("hosting.review")) return;
  reviewTarget.value =
    kind === "version"
      ? { kind, item: item as HostedVersion }
      : { kind, item: item as HostedRevision };
  reviewDecision.value = decision;
  reviewReason.value = "";
  reviewSetLatest.value = false;
  showReviewModal.value = true;
}
async function submitReview() {
  if (!reviewTarget.value || !auth.can("hosting.review")) return;
  if (reviewDecision.value === "rejected" && !reviewReason.value.trim()) {
    message.warning("必须填写驳回原因");
    return;
  }
  reviewing.value = true;
  try {
    const target = reviewTarget.value;
    const url = `/api/portal/v1/game-hosting/reviews/${target.kind === "version" ? "versions" : "revisions"}/${encodeURIComponent(target.item.id)}`;
    await api(url, {
      method: "PUT",
      body: JSON.stringify({
        decision: reviewDecision.value,
        reason: reviewReason.value.trim(),
        expectedUpdatedAt: target.item.updatedAt,
        ...(target.kind === "version"
          ? { setLatest: reviewSetLatest.value }
          : {}),
      }),
    });
    message.success(
      reviewDecision.value === "approved" ? "审核已通过" : "投稿已驳回",
    );
    showReviewModal.value = false;
    await load();
  } catch (error) {
    await handleError(error);
  } finally {
    reviewing.value = false;
  }
}

function gameActions(game: HostedGame) {
  return [
    ...(auth.can("hosting.version.create")
      ? [
          h(
            NButton,
            { size: "small", onClick: () => openAddVersion(game) },
            { default: () => "新增版本" },
          ),
        ]
      : []),
    h(
      NButton,
      { size: "small", onClick: () => openEditGame(game) },
      { default: () => "编辑" },
    ),
    ...(game.published
      ? [
          h(
            NButton,
            { size: "small", onClick: () => downloadConfig(game) },
            { default: () => "下载 JSON" },
          ),
        ]
      : []),
    ...(auth.can("hosting.all.manage")
      ? [
          h(
            NButton,
            {
              size: "small",
              type: "error",
              onClick: () => requestDelete(game),
            },
            { default: () => "删除" },
          ),
        ]
      : []),
  ];
}
function versionActions(game: HostedGame, version: HostedVersion) {
  return [
    ...(auth.can("hosting.all.manage") || version.status !== "approved"
      ? [
          h(
            NButton,
            { size: "small", onClick: () => openEditVersion(game, version) },
            { default: () => "编辑" },
          ),
        ]
      : []),
    ...(auth.can("hosting.all.manage") &&
    game.latestVersion !== version.version &&
    version.status === "approved"
      ? [
          h(
            NButton,
            { size: "small", onClick: () => makeLatest(game, version) },
            { default: () => "设为最新" },
          ),
        ]
      : []),
    ...(auth.can("hosting.review") && version.status === "pending"
      ? [
          h(
            NButton,
            {
              size: "small",
              type: "success",
              onClick: () => requestReview("version", version, "approved"),
            },
            { default: () => "通过" },
          ),
          h(
            NButton,
            {
              size: "small",
              type: "warning",
              onClick: () => requestReview("version", version, "rejected"),
            },
            { default: () => "驳回" },
          ),
        ]
      : []),
    ...(auth.can("hosting.all.manage") || version.status !== "approved"
      ? [
          h(
            NButton,
            {
              size: "small",
              type: "error",
              onClick: () => requestDelete(game, version),
            },
            { default: () => "删除" },
          ),
        ]
      : []),
  ];
}
function revisionActions(game: HostedGame, revision: HostedRevision) {
  return [
    ...(auth.can("hosting.review") && revision.status === "pending"
      ? [
          h(
            NButton,
            {
              size: "small",
              type: "success",
              onClick: () => requestReview("revision", revision, "approved"),
            },
            { default: () => "通过" },
          ),
          h(
            NButton,
            {
              size: "small",
              type: "warning",
              onClick: () => requestReview("revision", revision, "rejected"),
            },
            { default: () => "驳回" },
          ),
        ]
      : []),
    ...(auth.can("hosting.own.manage") &&
    !auth.can("hosting.all.manage") &&
    revision.status !== "approved"
      ? [
          h(
            NButton,
            { size: "small", onClick: () => openEditRevision(game, revision) },
            { default: () => "编辑" },
          ),
        ]
      : []),
    ...(auth.can("hosting.all.manage") || revision.status !== "approved"
      ? [
          h(
            NButton,
            {
              size: "small",
              type: "error",
              onClick: () => requestDelete(game, undefined, revision),
            },
            { default: () => "删除" },
          ),
        ]
      : []),
  ];
}

const columns: DataTableColumns<TreeRow> = [
  {
    title: "游戏 / 版本 / 资源",
    key: "label",
    width: 420,
    ellipsis: { tooltip: true },
    render: (row) => (row.kind === "game" ? h("strong", row.label) : row.label),
  },
  {
    title: "状态",
    key: "status",
    width: 100,
    render: (row) =>
      row.status
        ? h(
            NTag,
            {
              type:
                row.status === "approved"
                  ? "success"
                  : row.status === "rejected"
                    ? "error"
                    : "warning",
              size: "small",
            },
            { default: () => statusLabels[row.status!] || row.status },
          )
        : "-",
  },
  {
    title: "大小",
    key: "size",
    width: 110,
    render: (row) => (row.size === undefined ? "-" : formatBytes(row.size)),
  },
  {
    title: "SHA-256",
    key: "sha256",
    width: 230,
    ellipsis: { tooltip: true },
    render: (row) => row.sha256 || "-",
  },
  {
    title: "上传/更新人",
    key: "uploader",
    width: 130,
    render: (row) => row.uploader || "-",
  },
  {
    title: "时间",
    key: "createdAt",
    width: 180,
    render: (row) => formatTime(row.createdAt),
  },
  {
    title: "操作",
    key: "actions",
    width: 460,
    fixed: "right",
    render: (row) =>
      h(
        NSpace,
        { wrap: false },
        {
          default: () =>
            row.kind === "game"
              ? gameActions(row.game)
              : row.kind === "version"
                ? versionActions(row.game, row.version!)
                : row.kind === "revision"
                  ? revisionActions(row.game, row.revision!)
                  : [
                      h(
                        NButton,
                        {
                          size: "small",
                          onClick: () => downloadAsset(row.asset!),
                        },
                        { default: () => "下载" },
                      ),
                      ...(row.version?.status === "approved"
                        ? [
                            h(
                              NButton,
                              {
                                size: "small",
                                onClick: () =>
                                  copyText(row.logicalUrl!, "资源地址已复制"),
                              },
                              { default: () => "复制地址" },
                            ),
                          ]
                        : []),
                    ],
        },
      ),
  },
];

const treeRows = computed<TreeRow[]>(() =>
  games.value.map((game) => ({
    key: `game:${game.gameId}`,
    kind: "game",
    label: `${game.gameId} · ${localizedGameName(game.metadata)}`,
    uploader: game.updater,
    createdAt: game.updatedAt,
    game,
    children: [
      ...game.revisions.map((revision) => ({
        key: `revision:${revision.id}`,
        kind: "revision" as const,
        label: `公共信息修订${revision.reviewReason ? ` · ${revision.reviewReason}` : ""}`,
        status: revision.status,
        uploader: revision.submitter,
        createdAt: revision.updatedAt,
        game,
        revision,
      })),
      ...game.versions.map((version) => ({
        key: `version:${game.gameId}:${version.version}`,
        kind: "version" as const,
        label: `${version.version}${game.latestVersion === version.version ? " · 最新" : ""}`,
        status: version.status,
        uploader: version.uploader,
        createdAt: version.createdAt,
        game,
        version,
        children: version.assets.map((asset) => ({
          key: `asset:${asset.id}`,
          kind: "asset" as const,
          label: `${roleLabels[asset.role]} · ${asset.fileName}`,
          size: asset.size,
          sha256: asset.sha256,
          createdAt: asset.createdAt,
          logicalUrl: asset.logicalUrl,
          game,
          version,
          asset,
        })),
      })),
    ],
  })),
);

async function handleError(error: unknown) {
  if (error instanceof ApiError && error.status === 401) {
    auth.user = null;
    await router.replace({ name: "login" });
    message.error("登录已失效");
    return;
  }
  if (error instanceof ApiError && error.status === 403) {
    message.error("当前账号无权执行此操作");
    return;
  }
  const code = error instanceof Error ? error.message : "request_failed";
  const labels: Record<string, string> = {
    hosted_game_exists: "该游戏已经存在",
    hosted_game_version_exists: "该游戏版本已经存在",
    game_archive_too_large: "ZIP 游戏包超过服务器限制",
    hosted_image_too_large: "图片超过服务器限制",
    game_hosting_capacity_exceeded: "托管目录容量不足",
    invalid_zip_archive: "文件不是有效 ZIP",
    invalid_hosted_image: "图片实际格式不是 PNG、JPEG 或 WebP",
    invalid_game_metadata: "游戏信息不合法",
    invalid_game_version_metadata: "版本信息不合法",
    invalid_game_manifest: "Manifest 配置不合法",
    hosted_version_images_require_unique: "只有游戏唯一版本可以上传图标和封面",
  };
  message.error(labels[code] || code);
}
async function load() {
  const sequence = ++loadSequence;
  loading.value = true;
  try {
    const params = new URLSearchParams({
      page: String(page.value),
      pageSize: String(pageSize.value),
    });
    if (query.value.trim()) params.set("q", query.value.trim());
    const result = await api<TreeResponse>(
      `/api/portal/v1/game-hosting/tree?${params}`,
    );
    if (sequence !== loadSequence) return;
    games.value = result.games;
    total.value = result.total;
    usedBytes.value = result.capacity?.usedBytes ?? 0;
    maxPackageBytes.value = result.maxPackageBytes;
    maxImageBytes.value = result.maxImageBytes;
    maxTotalBytes.value = result.capacity?.maxTotalBytes ?? 0;
  } catch (error) {
    await handleError(error);
  } finally {
    if (sequence === loadSequence) loading.value = false;
  }
}
function applySearch() {
  page.value = 1;
  void load();
}
function resetSearch() {
  query.value = "";
  page.value = 1;
  void load();
}
function changePageSize(value: number) {
  pageSize.value = value;
  page.value = 1;
  void load();
}
onMounted(load);
</script>

<style scoped>
.muted {
  color: #8c8c8c;
  margin-top: 4px;
}
</style>
