<template>
  <n-space vertical :size="18">
    <n-card>
      <n-space justify="space-between" align="center">
        <div>
          <strong>托管容量</strong>
          <div class="muted">
            已使用 {{ formatBytes(usedBytes) }} / {{ formatBytes(maxTotalBytes) }}
          </div>
        </div>
        <n-button type="primary" @click="openCreateGame">新增</n-button>
      </n-space>
      <n-progress
        type="line"
        :percentage="usagePercent"
        :indicator-placement="'inside'"
        style="margin-top: 14px"
      />
    </n-card>

    <n-card title="托管游戏">
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
    :mode="formMode"
    :title="formTitle"
    :can-publish-direct="auth.can('hosting.publishDirect')"
    :saving="saving"
    :upload-progress="uploadProgress"
    :max-package-bytes="maxPackageBytes"
    :max-image-bytes="maxImageBytes"
    :file-input-key="fileInputKey"
    :game="gameForm"
    :version="versionForm"
    :manifest="manifestForm"
    :files="files"
    :existing-assets="editingVersion?.assets || []"
    @select-asset="selectAsset"
    @submit="submitForm"
  />

  <n-modal v-model:show="showDeleteModal" preset="card" title="确认删除" style="width: 500px">
    <p>{{ deleteMessage }}</p>
    <template #action>
      <n-space justify="end">
        <n-button @click="showDeleteModal = false">取消</n-button>
        <n-button type="error" :loading="deleting" @click="confirmDelete">删除</n-button>
      </n-space>
    </template>
  </n-modal>

  <n-modal v-model:show="showReviewModal" preset="card" :title="reviewDecision === 'approved' ? '通过审核' : '驳回投稿'" style="width: 520px">
    <n-space vertical :size="16">
      <n-input v-if="reviewDecision === 'rejected'" v-model:value="reviewReason" type="textarea" :rows="5" maxlength="2000" show-count placeholder="必须填写驳回原因" />
      <n-form-item v-if="reviewDecision === 'approved' && reviewTarget?.kind === 'version'" label="设为最新版本">
        <n-switch v-model:value="reviewSetLatest" />
      </n-form-item>
    </n-space>
    <template #action>
      <n-space justify="end">
        <n-button :disabled="reviewing" @click="showReviewModal = false">取消</n-button>
        <n-button :type="reviewDecision === 'approved' ? 'primary' : 'error'" :loading="reviewing" @click="submitReview">确认</n-button>
      </n-space>
    </template>
  </n-modal>
</template>

<script setup lang="ts">
import { computed, h, onMounted, reactive, ref } from "vue";
import { NButton, NSpace, NTag, NText, type DataTableColumns, useMessage } from "naive-ui";
import { useRouter } from "vue-router";
import { api, ApiError, upload } from "../api";
import { useAuthStore } from "../stores/auth";
import GameHostingForm from "../components/GameHostingForm.vue";

type FormMode = "create-game" | "add-version" | "edit-game" | "edit-version";
type AssetRole = "package" | "icon" | "cover";

interface GameMetadata {
  id: string; name: string; author: string; author_url?: string; type: string; summary: string;
  tags?: string[]; iconUrl?: string; coverUrl?: string; screenshots?: string[]; featured?: boolean;
  visibility?: string; minPlayers?: number; maxPlayers?: number;
}
interface VersionMetadata {
  version: string; description: string; platformVersion: string; publishedAt?: string;
  releaseNotes?: string; isPrerelease?: boolean; gameManifest?: Record<string, unknown>;
}
interface HostedAsset {
  id: string; role: AssetRole; fileName: string; contentType: string; size: number;
  sha256: string; createdAt: string; logicalUrl: string;
}
interface HostedVersion {
  id: string; version: string; metadata: VersionMetadata; status: "pending" | "approved" | "rejected";
  reviewReason: string; reviewer: string; reviewedAt?: string; uploader: string;
  createdAt: string; updatedAt: string; assets: HostedAsset[];
}
interface HostedRevision {
  id: string; metadata: GameMetadata; status: "pending" | "approved" | "rejected";
  reviewReason: string; submitter: string; reviewer: string; reviewedAt?: string;
  createdAt: string; updatedAt: string;
}
interface HostedGame {
  gameId: string; metadata: GameMetadata; published: boolean; latestVersion: string | null;
  owner: string; updater: string; createdAt: string; updatedAt: string;
  revisions: HostedRevision[]; versions: HostedVersion[];
}
interface TreeResponse {
  games: HostedGame[]; total: number; page: number; pageSize: number; usedBytes: number;
  maxPackageBytes: number; maxImageBytes: number; maxTotalBytes: number; role: "creator" | "administrator";
}
interface TreeRow {
  key: string; kind: "game" | "revision" | "version" | "asset"; label: string; status?: string; size?: number;
  sha256?: string; uploader?: string; createdAt?: string; logicalUrl?: string; game: HostedGame;
  revision?: HostedRevision; version?: HostedVersion; asset?: HostedAsset; children?: TreeRow[];
}
interface EnvRow { key: string; value: string }
interface StatisticRow { id: string; kind: "id" | "label" | "details"; label: string; mode: "increment" | "full" }
interface AchievementRow { id: string; title: string; description: string; icon: string }

const GAME_ID_PATTERN = /^[a-z0-9]+(?:\.[a-z0-9-]+)+$/;
const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
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
const deleteTarget = ref<{ game: HostedGame; version?: HostedVersion; revision?: HostedRevision } | null>(null);
const reviewTarget = ref<{ kind: "version"; item: HostedVersion } | { kind: "revision"; item: HostedRevision } | null>(null);
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
const files = reactive<Record<AssetRole, File | null>>({ package: null, icon: null, cover: null });
const fileInputKey = ref(0);
let loadSequence = 0;

const gameForm = reactive({
  id: "", name: "", author: "", author_url: "", type: "singleplayer", summary: "",
  tagsText: "", iconUrl: "", coverUrl: "", screenshotsText: "", featured: false,
  visibility: "public" as string | null, minPlayers: null as number | null, maxPlayers: null as number | null,
});
const versionForm = reactive({
  version: "", description: "", platformVersion: ">=3.1.0", publishedAt: null as number | null,
  releaseNotes: "", isPrerelease: false,
});
const manifestForm = reactive({
  name: "", description: "", author: "", author_url: "", platformMode: "range" as "range" | "tuple",
  platformRange: "", platformMin: "", platformMax: "", entry: "", web_url: "", icon: "", cover: "", video: "",
  encryptLocalStorage: false, type: null as string | null, minPlayers: null as number | null,
  maxPlayers: null as number | null, args: [] as string[], env: [] as EnvRow[], statistics: [] as StatisticRow[],
  achievements: [] as AchievementRow[],
});

const roleLabels: Record<AssetRole, string> = { package: "ZIP 游戏包", icon: "图标", cover: "封面" };
const statusLabels: Record<string, string> = { pending: "待审核", approved: "已通过", rejected: "已驳回" };

const showGameFields = computed(() => ["create-game", "edit-game"].includes(formMode.value));
const showVersionFields = computed(() => formMode.value !== "edit-game");
const showFiles = computed(() => formMode.value !== "edit-game");
const formTitle = computed(() => ({
  "create-game": "新增游戏", "add-version": `新增版本 · ${editingGame.value?.gameId || ""}`,
  "edit-game": `编辑游戏 · ${editingGame.value?.gameId || ""}`,
  "edit-version": `编辑版本 · ${editingGame.value?.gameId || ""}@${editingVersion.value?.version || ""}`,
}[formMode.value]));
const usagePercent = computed(() => maxTotalBytes.value > 0 ? Math.min(100, Math.round(usedBytes.value / maxTotalBytes.value * 100)) : 0);
const deleteMessage = computed(() => deleteTarget.value?.version
  ? `将删除 ${deleteTarget.value.game.gameId}@${deleteTarget.value.version.version} 及其全部资源，无法恢复。`
  : deleteTarget.value?.revision ? `将删除 ${deleteTarget.value.game.gameId} 的公共信息修订，无法恢复。`
  : `将删除 ${deleteTarget.value?.game.gameId || ""} 的全部版本和资源，无法恢复。`);

function lines(value: string) { return value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean); }
function formatBytes(value = 0) {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "KiB", "MiB", "GiB"];
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), 3);
  return `${(value / 1024 ** index).toFixed(index ? 2 : 0)} ${units[index]}`;
}
function formatTime(value?: string) { return value ? new Date(value).toLocaleString() : "-"; }

function resetForms() {
  Object.assign(gameForm, { id: "", name: "", author: "", author_url: "", type: "singleplayer", summary: "", tagsText: "", iconUrl: "", coverUrl: "", screenshotsText: "", featured: false, visibility: "public", minPlayers: null, maxPlayers: null });
  Object.assign(versionForm, { version: "", description: "", platformVersion: ">=3.1.0", publishedAt: null, releaseNotes: "", isPrerelease: false });
  Object.assign(manifestForm, { name: "", description: "", author: "", author_url: "", platformMode: "range", platformRange: "", platformMin: "", platformMax: "", entry: "", web_url: "", icon: "", cover: "", video: "", encryptLocalStorage: false, type: null, minPlayers: null, maxPlayers: null, args: [], env: [], statistics: [], achievements: [] });
  manifestEnabled.value = false; setLatest.value = true; uploadProgress.value = 0;
  files.package = null; files.icon = null; files.cover = null; fileInputKey.value += 1;
}

function hydrateGame(metadata: GameMetadata) {
  Object.assign(gameForm, { ...metadata, author_url: metadata.author_url || "", tagsText: (metadata.tags || []).join("\n"), iconUrl: metadata.iconUrl || "", coverUrl: metadata.coverUrl || "", screenshotsText: (metadata.screenshots || []).join("\n"), featured: metadata.featured || false, visibility: metadata.visibility || null, minPlayers: metadata.minPlayers || null, maxPlayers: metadata.maxPlayers || null });
}
function hydrateVersion(metadata: VersionMetadata) {
  Object.assign(versionForm, { version: metadata.version, description: metadata.description, platformVersion: metadata.platformVersion, publishedAt: metadata.publishedAt ? Date.parse(metadata.publishedAt) : null, releaseNotes: metadata.releaseNotes || "", isPrerelease: metadata.isPrerelease || false });
  const manifest = metadata.gameManifest as Record<string, unknown> | undefined;
  manifestEnabled.value = !!manifest;
  if (!manifest) return;
  const platform = manifest.platformVersion;
  const multiplayer = manifest.multiplayer as { minPlayers?: number; maxPlayers?: number } | undefined;
  Object.assign(manifestForm, {
    name: manifest.name || "", description: manifest.description || "", author: manifest.author || "", author_url: manifest.author_url || "",
    platformMode: Array.isArray(platform) ? "tuple" : "range", platformRange: typeof platform === "string" ? platform : "",
    platformMin: Array.isArray(platform) ? platform[0] : "", platformMax: Array.isArray(platform) ? platform[1] : "",
    entry: manifest.entry || "", web_url: manifest.web_url || "", icon: manifest.icon || "", cover: manifest.cover || "", video: manifest.video || "",
    encryptLocalStorage: !!manifest.encryptLocalStorage, type: manifest.type || null, minPlayers: multiplayer?.minPlayers || null,
    maxPlayers: multiplayer?.maxPlayers || null, args: Array.isArray(manifest.args) ? [...manifest.args] : [],
    env: Object.entries((manifest.env as Record<string, string>) || {}).map(([key, value]) => ({ key, value })),
    statistics: decodeStatistics(manifest.statistics), achievements: Array.isArray(manifest.achievements) ? manifest.achievements.map((item) => ({ ...(item as AchievementRow), icon: (item as AchievementRow).icon || "" })) : [],
  });
}
function decodeStatistics(value: unknown): StatisticRow[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    if (typeof item === "string") return { id: item, kind: "id", label: "", mode: "increment" };
    const [id, definition] = Object.entries(item as Record<string, unknown>)[0] || ["", ""];
    if (typeof definition === "string") return { id, kind: "label", label: definition, mode: "increment" };
    const details = definition as { label?: string; mode?: "increment" | "full" };
    return { id, kind: "details", label: details.label || "", mode: details.mode || "increment" };
  });
}

function buildGamePayload(): GameMetadata {
  const payload: GameMetadata = { id: gameForm.id.trim(), name: gameForm.name.trim(), author: gameForm.author.trim(), type: gameForm.type, summary: gameForm.summary.trim() };
  if (gameForm.author_url.trim()) payload.author_url = gameForm.author_url.trim();
  const tags = lines(gameForm.tagsText); if (tags.length) payload.tags = tags;
  if (gameForm.iconUrl.trim()) payload.iconUrl = gameForm.iconUrl.trim();
  if (gameForm.coverUrl.trim()) payload.coverUrl = gameForm.coverUrl.trim();
  const screenshots = lines(gameForm.screenshotsText); if (screenshots.length) payload.screenshots = screenshots;
  if (gameForm.featured) payload.featured = true;
  if (gameForm.visibility) payload.visibility = gameForm.visibility;
  if (gameForm.minPlayers) payload.minPlayers = gameForm.minPlayers;
  if (gameForm.maxPlayers) payload.maxPlayers = gameForm.maxPlayers;
  return payload;
}
function buildManifest(): Record<string, unknown> | undefined {
  if (!manifestEnabled.value) return undefined;
  const result: Record<string, unknown> = {};
  for (const key of ["name", "description", "author", "author_url", "entry", "web_url", "icon", "cover", "video"] as const) {
    const value = manifestForm[key].trim(); if (value) result[key] = value;
  }
  if (manifestForm.platformMode === "range" && manifestForm.platformRange.trim()) result.platformVersion = manifestForm.platformRange.trim();
  if (manifestForm.platformMode === "tuple" && manifestForm.platformMin.trim() && manifestForm.platformMax.trim()) result.platformVersion = [manifestForm.platformMin.trim(), manifestForm.platformMax.trim()];
  if (manifestForm.encryptLocalStorage) result.encryptLocalStorage = true;
  if (manifestForm.type) result.type = manifestForm.type;
  if (manifestForm.minPlayers && manifestForm.maxPlayers) result.multiplayer = { minPlayers: manifestForm.minPlayers, maxPlayers: manifestForm.maxPlayers };
  const args = manifestForm.args.map((item) => item.trim()).filter(Boolean); if (args.length) result.args = args;
  const env = Object.fromEntries(manifestForm.env.filter((item) => item.key.trim()).map((item) => [item.key.trim(), item.value])); if (Object.keys(env).length) result.env = env;
  const statistics = manifestForm.statistics.filter((item) => item.id.trim()).map((item) => item.kind === "id" ? item.id.trim() : item.kind === "label" ? { [item.id.trim()]: item.label.trim() } : { [item.id.trim()]: { label: item.label.trim(), mode: item.mode } });
  if (statistics.length) result.statistics = statistics;
  const achievements = manifestForm.achievements.filter((item) => item.id.trim()).map((item) => ({ id: item.id.trim(), title: item.title.trim(), description: item.description, ...(item.icon.trim() ? { icon: item.icon.trim() } : {}) }));
  if (achievements.length) result.achievements = achievements;
  return result;
}
function buildVersionPayload(): VersionMetadata {
  const payload: VersionMetadata = { version: versionForm.version.trim(), description: versionForm.description.trim(), platformVersion: versionForm.platformVersion.trim() };
  if (versionForm.publishedAt) payload.publishedAt = new Date(versionForm.publishedAt).toISOString();
  if (versionForm.releaseNotes.trim()) payload.releaseNotes = versionForm.releaseNotes.trim();
  if (versionForm.isPrerelease) payload.isPrerelease = true;
  const manifest = buildManifest(); if (manifest) payload.gameManifest = manifest;
  return payload;
}

function openCreateGame() { resetForms(); formMode.value = "create-game"; editingGame.value = null; editingVersion.value = null; activeTab.value = "game"; showFormModal.value = true; }
function openAddVersion(game: HostedGame) { resetForms(); formMode.value = "add-version"; editingGame.value = game; activeTab.value = "version"; showFormModal.value = true; }
function openEditGame(game: HostedGame) { resetForms(); formMode.value = "edit-game"; editingGame.value = game; hydrateGame(game.metadata); activeTab.value = "game"; showFormModal.value = true; }
function openEditRevision(game: HostedGame, revision: HostedRevision) { resetForms(); formMode.value = "edit-game"; editingGame.value = game; hydrateGame(revision.metadata); activeTab.value = "game"; showFormModal.value = true; }
function openEditVersion(game: HostedGame, version: HostedVersion) { resetForms(); formMode.value = "edit-version"; editingGame.value = game; editingVersion.value = version; hydrateVersion(version.metadata); activeTab.value = "version"; showFormModal.value = true; }
function selectAsset(role: AssetRole, event: Event) { files[role] = (event.target as HTMLInputElement).files?.[0] || null; }

async function submitForm() {
  try {
    if (showGameFields.value) {
      const game = buildGamePayload();
      if (!GAME_ID_PATTERN.test(game.id) || !game.name || !game.author || !game.summary) throw new Error("请完整填写合法的游戏信息");
      if (game.minPlayers && game.maxPlayers && game.minPlayers > game.maxPlayers) throw new Error("最少玩家不能大于最多玩家");
      if (files.icon && game.iconUrl) throw new Error("图标只能选择上传或外部地址其中一种");
      if (files.cover && game.coverUrl) throw new Error("封面只能选择上传或外部地址其中一种");
    }
    if (showVersionFields.value) {
      const version = buildVersionPayload();
      if (!SEMVER_PATTERN.test(version.version) || !version.description || !version.platformVersion) throw new Error("请完整填写合法的版本信息");
    }
    if (["create-game", "add-version"].includes(formMode.value) && (!files.package || !files.package.name.toLowerCase().endsWith(".zip"))) throw new Error("请选择 ZIP 游戏包");
    if (files.package && !files.package.name.toLowerCase().endsWith(".zip")) throw new Error("请选择 ZIP 游戏包");
    if (files.package && files.package.size > maxPackageBytes.value) throw new Error("ZIP 游戏包超过大小限制");
    for (const role of ["icon", "cover"] as const) if (files[role] && files[role]!.size > maxImageBytes.value) throw new Error(`${roleLabels[role]}超过大小限制`);
  } catch (error) { message.warning((error as Error).message); return; }

  saving.value = true; uploadProgress.value = 0;
  try {
    if (formMode.value === "edit-game") {
      await api(`/api/portal/v1/game-hosting/games/${encodeURIComponent(editingGame.value!.gameId)}`, { method: "PUT", body: JSON.stringify(buildGamePayload()) });
    } else if (formMode.value === "edit-version") {
      const url = `/api/portal/v1/game-hosting/games/${encodeURIComponent(editingGame.value!.gameId)}/versions/${encodeURIComponent(editingVersion.value!.version)}`;
      if (files.package || files.icon || files.cover) {
        const form = new FormData(); form.set("version", JSON.stringify(buildVersionPayload()));
        for (const role of ["package", "icon", "cover"] as const) if (files[role]) form.set(role, files[role]!, files[role]!.name);
        await upload(url, form, (percent) => uploadProgress.value = percent, "PUT");
      } else await api(url, { method: "PUT", body: JSON.stringify(buildVersionPayload()) });
    } else {
      const form = new FormData();
      if (formMode.value === "create-game") form.set("game", JSON.stringify(buildGamePayload()));
      form.set("version", JSON.stringify(buildVersionPayload()));
      if (auth.can("hosting.publishDirect")) form.set("setLatest", String(setLatest.value));
      for (const role of ["package", "icon", "cover"] as const) if (files[role]) form.set(role, files[role]!, files[role]!.name);
      const url = formMode.value === "create-game" ? "/api/portal/v1/game-hosting/games" : `/api/portal/v1/game-hosting/games/${encodeURIComponent(editingGame.value!.gameId)}/versions`;
      await upload(url, form, (percent) => uploadProgress.value = percent);
    }
    message.success("保存成功"); showFormModal.value = false; await load();
  } catch (error) { await handleError(error); } finally { saving.value = false; }
}

async function copyText(value: string, success: string) {
  try { await navigator.clipboard.writeText(value); message.success(success); }
  catch { message.error("复制失败，请检查浏览器剪贴板权限"); }
}
async function getConfig(gameId: string) { return await api<Record<string, unknown>>(`/api/portal/v1/game-hosting/games/${encodeURIComponent(gameId)}/config`); }
async function downloadConfig(game: HostedGame) {
  try {
    const content = JSON.stringify(await getConfig(game.gameId), null, 2) + "\n";
    const url = URL.createObjectURL(new Blob([content], { type: "application/json;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = `${game.gameId}.json`; link.click(); URL.revokeObjectURL(url);
  } catch (error) { await handleError(error); }
}
async function makeLatest(game: HostedGame, version: HostedVersion) {
  try { await api(`/api/portal/v1/game-hosting/games/${encodeURIComponent(game.gameId)}/latest`, { method: "PUT", body: JSON.stringify({ version: version.version }) }); message.success("最新版本已更新"); await load(); }
  catch (error) { await handleError(error); }
}
function requestDelete(game: HostedGame, version?: HostedVersion, revision?: HostedRevision) { deleteTarget.value = { game, version, revision }; showDeleteModal.value = true; }
async function confirmDelete() {
  if (!deleteTarget.value) return; deleting.value = true;
  try {
    const { game, version, revision } = deleteTarget.value;
    const url = revision ? `/api/portal/v1/game-hosting/revisions/${encodeURIComponent(revision.id)}`
      : version ? `/api/portal/v1/game-hosting/games/${encodeURIComponent(game.gameId)}/versions/${encodeURIComponent(version.version)}`
      : `/api/portal/v1/game-hosting/games/${encodeURIComponent(game.gameId)}`;
    await api(url, { method: "DELETE" }); message.success("删除成功"); showDeleteModal.value = false; deleteTarget.value = null; await load();
  } catch (error) { await handleError(error); } finally { deleting.value = false; }
}

function requestReview(kind: "version" | "revision", item: HostedVersion | HostedRevision, decision: "approved" | "rejected") {
  reviewTarget.value = kind === "version" ? { kind, item: item as HostedVersion } : { kind, item: item as HostedRevision };
  reviewDecision.value = decision; reviewReason.value = ""; reviewSetLatest.value = false; showReviewModal.value = true;
}
async function submitReview() {
  if (!reviewTarget.value) return;
  if (reviewDecision.value === "rejected" && !reviewReason.value.trim()) { message.warning("必须填写驳回原因"); return; }
  reviewing.value = true;
  try {
    const target = reviewTarget.value;
    const url = `/api/portal/v1/game-hosting/reviews/${target.kind === "version" ? "versions" : "revisions"}/${encodeURIComponent(target.item.id)}`;
    await api(url, { method: "PUT", body: JSON.stringify({ decision: reviewDecision.value,
      reason: reviewReason.value.trim(), expectedUpdatedAt: target.item.updatedAt,
      ...(target.kind === "version" ? { setLatest: reviewSetLatest.value } : {}) }) });
    message.success(reviewDecision.value === "approved" ? "审核已通过" : "投稿已驳回"); showReviewModal.value = false; await load();
  } catch (error) { await handleError(error); } finally { reviewing.value = false; }
}

function gameActions(game: HostedGame) { return [
  h(NButton, { size: "small", onClick: () => openAddVersion(game) }, { default: () => "新增版本" }),
  h(NButton, { size: "small", onClick: () => openEditGame(game) }, { default: () => "编辑" }),
  ...(game.published ? [h(NButton, { size: "small", onClick: () => downloadConfig(game) }, { default: () => "下载 JSON" })] : []),
  ...(auth.can("hosting.manageAll") ? [h(NButton, { size: "small", type: "error", onClick: () => requestDelete(game) }, { default: () => "删除" })] : []),
]; }
function versionActions(game: HostedGame, version: HostedVersion) { return [
  ...(auth.can("hosting.manageAll") || version.status !== "approved" ? [h(NButton, { size: "small", onClick: () => openEditVersion(game, version) }, { default: () => "编辑" })] : []),
  ...(auth.can("hosting.manageAll") && game.latestVersion !== version.version && version.status === "approved" ? [h(NButton, { size: "small", onClick: () => makeLatest(game, version) }, { default: () => "设为最新" })] : []),
  ...(auth.can("hosting.review") && version.status === "pending" ? [
    h(NButton, { size: "small", type: "success", onClick: () => requestReview("version", version, "approved") }, { default: () => "通过" }),
    h(NButton, { size: "small", type: "warning", onClick: () => requestReview("version", version, "rejected") }, { default: () => "驳回" }),
  ] : []),
  ...(auth.can("hosting.manageAll") || version.status !== "approved" ? [h(NButton, { size: "small", type: "error", onClick: () => requestDelete(game, version) }, { default: () => "删除" })] : []),
]; }
function revisionActions(game: HostedGame, revision: HostedRevision) { return [
  ...(auth.can("hosting.review") && revision.status === "pending" ? [
    h(NButton, { size: "small", type: "success", onClick: () => requestReview("revision", revision, "approved") }, { default: () => "通过" }),
    h(NButton, { size: "small", type: "warning", onClick: () => requestReview("revision", revision, "rejected") }, { default: () => "驳回" }),
  ] : []),
  ...(auth.can("hosting.manageOwn") && !auth.can("hosting.manageAll") && revision.status !== "approved" ? [h(NButton, { size: "small", onClick: () => openEditRevision(game, revision) }, { default: () => "编辑" })] : []),
  ...((auth.can("hosting.manageAll") || revision.status !== "approved") ? [h(NButton, { size: "small", type: "error", onClick: () => requestDelete(game, undefined, revision) }, { default: () => "删除" })] : []),
]; }

const columns: DataTableColumns<TreeRow> = [
  { title: "游戏 / 版本 / 资源", key: "label", width: 420, ellipsis: { tooltip: true }, render: (row) => row.kind === "game" ? h("strong", row.label) : row.label },
  { title: "状态", key: "status", width: 100, render: (row) => row.status ? h(NTag, { type: row.status === "approved" ? "success" : row.status === "rejected" ? "error" : "warning", size: "small" }, { default: () => statusLabels[row.status!] || row.status }) : "-" },
  { title: "大小", key: "size", width: 110, render: (row) => row.size === undefined ? "-" : formatBytes(row.size) },
  { title: "SHA-256", key: "sha256", width: 230, ellipsis: { tooltip: true }, render: (row) => row.sha256 || "-" },
  { title: "上传/更新人", key: "uploader", width: 130, render: (row) => row.uploader || "-" },
  { title: "时间", key: "createdAt", width: 180, render: (row) => formatTime(row.createdAt) },
  { title: "操作", key: "actions", width: 460, fixed: "right", render: (row) => h(NSpace, { wrap: false }, { default: () => row.kind === "game" ? gameActions(row.game) : row.kind === "version" ? versionActions(row.game, row.version!) : row.kind === "revision" ? revisionActions(row.game, row.revision!) : row.version?.status === "approved" ? [h(NButton, { size: "small", onClick: () => copyText(row.logicalUrl!, "资源地址已复制") }, { default: () => "复制地址" })] : [] }) },
];

const treeRows = computed<TreeRow[]>(() => games.value.map((game) => ({
  key: `game:${game.gameId}`, kind: "game", label: `${game.gameId} · ${game.metadata.name}`, uploader: game.updater, createdAt: game.updatedAt, game,
  children: [
    ...game.revisions.map((revision) => ({
      key: `revision:${revision.id}`, kind: "revision" as const, label: `公共信息修订${revision.reviewReason ? ` · ${revision.reviewReason}` : ""}`,
      status: revision.status, uploader: revision.submitter, createdAt: revision.updatedAt, game, revision,
    })),
    ...game.versions.map((version) => ({
    key: `version:${game.gameId}:${version.version}`, kind: "version" as const, label: `${version.version}${game.latestVersion === version.version ? " · 最新" : ""}`,
    status: version.status, uploader: version.uploader, createdAt: version.createdAt, game, version,
    children: version.assets.map((asset) => ({
      key: `asset:${asset.id}`, kind: "asset" as const, label: `${roleLabels[asset.role]} · ${asset.fileName}`, size: asset.size,
      sha256: asset.sha256, createdAt: asset.createdAt, logicalUrl: asset.logicalUrl, game, version, asset,
    })),
  })),],
})));

async function handleError(error: unknown) {
  if (error instanceof ApiError && error.status === 401) { auth.user = null; await router.replace({ name: "login" }); message.error("登录已失效"); return; }
  if (error instanceof ApiError && error.status === 403) { message.error("当前账号无权执行此操作"); return; }
  const code = error instanceof Error ? error.message : "request_failed";
  const labels: Record<string, string> = {
    hosted_game_exists: "该游戏已经存在", hosted_game_version_exists: "该游戏版本已经存在",
    game_archive_too_large: "ZIP 游戏包超过服务器限制", hosted_image_too_large: "图片超过服务器限制",
    game_hosting_capacity_exceeded: "托管目录容量不足", invalid_zip_archive: "文件不是有效 ZIP",
    invalid_hosted_image: "图片实际格式不是 PNG、JPEG 或 WebP", invalid_game_metadata: "游戏信息不合法",
    invalid_game_version_metadata: "版本信息不合法", invalid_game_manifest: "Manifest 配置不合法",
  };
  message.error(labels[code] || code);
}
async function load() {
  const sequence = ++loadSequence; loading.value = true;
  try {
    const params = new URLSearchParams({ page: String(page.value), pageSize: String(pageSize.value) }); if (query.value.trim()) params.set("q", query.value.trim());
    const result = await api<TreeResponse>(`/api/portal/v1/game-hosting/tree?${params}`); if (sequence !== loadSequence) return;
    games.value = result.games; total.value = result.total; usedBytes.value = result.usedBytes; maxPackageBytes.value = result.maxPackageBytes; maxImageBytes.value = result.maxImageBytes; maxTotalBytes.value = result.maxTotalBytes;
  } catch (error) { await handleError(error); } finally { if (sequence === loadSequence) loading.value = false; }
}
function applySearch() { page.value = 1; void load(); }
function resetSearch() { query.value = ""; page.value = 1; void load(); }
function changePageSize(value: number) { pageSize.value = value; page.value = 1; void load(); }
onMounted(load);
</script>

<style scoped>
.muted { color: #8c8c8c; margin-top: 4px; }
</style>
