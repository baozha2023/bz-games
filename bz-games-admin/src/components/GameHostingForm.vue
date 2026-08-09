<template>
  <n-modal v-model:show="show" preset="card" :title="title" style="width: min(1120px, 96vw)" :mask-closable="!saving" :close-on-esc="!saving">
    <n-tabs v-model:value="activeTab" type="line" animated>
      <n-tab-pane v-if="showGameFields" name="game" tab="游戏信息">
        <div class="form-grid">
          <n-form-item label="游戏 ID" required><n-input v-model:value="game.id" :disabled="mode !== 'create-game'" placeholder="com.example.game" /></n-form-item>
          <n-form-item label="名称" required><n-input v-model:value="game.name" maxlength="100" /></n-form-item>
          <n-form-item label="作者" required><n-input v-model:value="game.author" maxlength="100" /></n-form-item>
          <n-form-item label="作者地址"><n-input v-model:value="game.author_url" placeholder="https://..." /></n-form-item>
          <n-form-item label="游戏类型" required><n-select v-model:value="game.type" :options="gameTypeOptions" /></n-form-item>
          <n-form-item label="可见性"><n-select v-model:value="game.visibility" clearable :options="visibilityOptions" /></n-form-item>
          <n-form-item label="最少玩家"><n-input-number v-model:value="game.minPlayers" :min="1" clearable /></n-form-item>
          <n-form-item label="最多玩家"><n-input-number v-model:value="game.maxPlayers" :min="1" clearable /></n-form-item>
          <n-form-item label="推荐展示"><n-switch v-model:value="game.featured" /></n-form-item>
          <n-form-item label="摘要" required class="span-2"><n-input v-model:value="game.summary" type="textarea" maxlength="200" show-count /></n-form-item>
          <n-form-item label="标签" class="span-2"><n-input v-model:value="game.tagsText" placeholder="每行一个标签" type="textarea" :rows="3" /></n-form-item>
          <n-form-item label="截图地址" class="span-2"><n-input v-model:value="game.screenshotsText" placeholder="每行一个 HTTP(S) 地址" type="textarea" :rows="3" /></n-form-item>
          <n-form-item label="外部图标地址"><n-input v-model:value="game.iconUrl" :disabled="!!files.icon" placeholder="可留空或填写 HTTP(S) 地址" /></n-form-item>
          <n-form-item label="外部封面地址"><n-input v-model:value="game.coverUrl" :disabled="!!files.cover" placeholder="可留空或填写 HTTP(S) 地址" /></n-form-item>
        </div>
      </n-tab-pane>

      <n-tab-pane v-if="showVersionFields" name="version" tab="版本信息">
        <div class="form-grid">
          <n-form-item label="版本" required><n-input v-model:value="version.version" :disabled="mode === 'edit-version'" placeholder="1.0.0" /></n-form-item>
          <n-form-item label="平台版本" required><n-input v-model:value="version.platformVersion" placeholder=">=3.1.0" /></n-form-item>
          <n-form-item label="发布时间"><n-date-picker v-model:value="version.publishedAt" type="datetime" clearable style="width: 100%" /></n-form-item>
          <n-form-item label="预发布版本"><n-switch v-model:value="version.isPrerelease" /></n-form-item>
          <n-form-item label="版本描述" required class="span-2"><n-input v-model:value="version.description" type="textarea" :rows="3" /></n-form-item>
          <n-form-item label="更新说明" class="span-2"><n-input v-model:value="version.releaseNotes" type="textarea" :rows="5" /></n-form-item>
          <n-form-item v-if="mode === 'add-version' && canPublishDirect" label="设为最新版本"><n-switch v-model:value="setLatest" /></n-form-item>
        </div>
      </n-tab-pane>

      <n-tab-pane v-if="showVersionFields" name="manifest" tab="Manifest">
        <n-space vertical>
          <n-checkbox v-model:checked="manifestEnabled">配置版本 Manifest 覆盖信息</n-checkbox>
          <div v-if="manifestEnabled" class="form-grid">
            <n-form-item label="游戏名称"><n-input v-model:value="manifest.name" /></n-form-item>
            <n-form-item label="作者"><n-input v-model:value="manifest.author" /></n-form-item>
            <n-form-item label="描述" class="span-2"><n-input v-model:value="manifest.description" type="textarea" /></n-form-item>
            <n-form-item label="作者地址"><n-input v-model:value="manifest.author_url" placeholder="https://..." /></n-form-item>
            <n-form-item label="游戏类型"><n-select v-model:value="manifest.type" clearable :options="gameTypeOptions" /></n-form-item>
            <n-form-item label="平台版本形式"><n-select v-model:value="manifest.platformMode" :options="platformModeOptions" /></n-form-item>
            <n-form-item v-if="manifest.platformMode === 'range'" label="平台范围"><n-input v-model:value="manifest.platformRange" placeholder=">=3.1.0" /></n-form-item>
            <template v-else>
              <n-form-item label="最低平台版本"><n-input v-model:value="manifest.platformMin" placeholder="3.1.0" /></n-form-item>
              <n-form-item label="最高平台版本"><n-input v-model:value="manifest.platformMax" placeholder="4.0.0" /></n-form-item>
            </template>
            <n-form-item label="入口"><n-input v-model:value="manifest.entry" placeholder="index.html、serve 或 url" /></n-form-item>
            <n-form-item label="网页地址"><n-input v-model:value="manifest.web_url" placeholder="entry=url 时填写" /></n-form-item>
            <n-form-item label="包内图标路径"><n-input v-model:value="manifest.icon" /></n-form-item>
            <n-form-item label="包内封面路径"><n-input v-model:value="manifest.cover" /></n-form-item>
            <n-form-item label="包内视频路径"><n-input v-model:value="manifest.video" /></n-form-item>
            <n-form-item label="加密本地存储"><n-switch v-model:value="manifest.encryptLocalStorage" /></n-form-item>
            <n-form-item label="联机最少玩家"><n-input-number v-model:value="manifest.minPlayers" :min="1" clearable /></n-form-item>
            <n-form-item label="联机最多玩家"><n-input-number v-model:value="manifest.maxPlayers" :min="1" clearable /></n-form-item>
          </div>
        </n-space>
      </n-tab-pane>

      <n-tab-pane v-if="showVersionFields" name="advanced" tab="高级配置">
        <n-space v-if="manifestEnabled" vertical :size="18">
          <n-form-item label="启动参数"><n-dynamic-input v-model:value="manifest.args" placeholder="每项一个参数" /></n-form-item>
          <n-form-item label="环境变量"><n-dynamic-input v-model:value="manifest.env" :on-create="() => ({ key: '', value: '' })"><template #default="{ value }"><n-space style="width: 100%"><n-input v-model:value="value.key" placeholder="变量名" /><n-input v-model:value="value.value" placeholder="值" /></n-space></template></n-dynamic-input></n-form-item>
          <n-divider>统计项</n-divider>
          <n-dynamic-input v-model:value="manifest.statistics" :on-create="newStatistic"><template #default="{ value }"><n-space style="width: 100%" align="center"><n-input v-model:value="value.id" placeholder="统计 ID" /><n-select v-model:value="value.kind" :options="statisticKindOptions" style="width: 150px" /><n-input v-if="value.kind !== 'id'" v-model:value="value.label" placeholder="显示名称" /><n-select v-if="value.kind === 'details'" v-model:value="value.mode" :options="statisticModeOptions" style="width: 130px" /></n-space></template></n-dynamic-input>
          <n-divider>成就</n-divider>
          <n-dynamic-input v-model:value="manifest.achievements" :on-create="newAchievement"><template #default="{ value }"><div class="achievement-row"><n-input v-model:value="value.id" placeholder="成就 ID" /><n-input v-model:value="value.title" placeholder="标题" /><n-input v-model:value="value.icon" placeholder="包内图标路径（可选）" /><n-input v-model:value="value.description" type="textarea" placeholder="描述" /></div></template></n-dynamic-input>
        </n-space>
        <n-text v-else depth="3">请先在 Manifest 页启用覆盖配置。</n-text>
      </n-tab-pane>

      <n-tab-pane v-if="showFiles" name="files" tab="托管资源">
        <n-space vertical :size="20">
          <n-form-item label="ZIP 游戏包" :required="mode !== 'edit-version'">
            <n-space vertical :size="8">
              <n-text v-if="mode === 'edit-version'" class="current-asset">
                当前文件：<template v-if="existingAsset('package')"><strong>{{ existingAsset('package')!.fileName }}</strong>（{{ formatBytes(existingAsset('package')!.size) }}）</template><template v-else>未上传</template>
              </n-text>
              <input :key="fileInputKey" type="file" accept=".zip,application/zip" @change="emit('select-asset', 'package', $event)" />
              <n-text depth="3">{{ mode === "edit-version" ? "选择新文件将替换当前 ZIP；不选择则保持不变。" : "" }}上限 {{ formatBytes(maxPackageBytes) }}</n-text>
            </n-space>
          </n-form-item>
          <n-form-item label="游戏图标">
            <n-space vertical :size="8">
              <n-text v-if="mode === 'edit-version'" class="current-asset">
                当前文件：<template v-if="existingAsset('icon')"><strong>{{ existingAsset('icon')!.fileName }}</strong>（{{ formatBytes(existingAsset('icon')!.size) }}）</template><template v-else>未上传</template>
              </n-text>
              <input :key="fileInputKey" type="file" accept="image/png,image/jpeg,image/webp" @change="emit('select-asset', 'icon', $event)" />
              <n-text depth="3">{{ mode === "edit-version" ? "选择新文件将替换当前图标；不选择则保持不变。" : "可选，" }}PNG/JPEG/WebP，上限 {{ formatBytes(maxImageBytes) }}</n-text>
            </n-space>
          </n-form-item>
          <n-form-item label="游戏封面">
            <n-space vertical :size="8">
              <n-text v-if="mode === 'edit-version'" class="current-asset">
                当前文件：<template v-if="existingAsset('cover')"><strong>{{ existingAsset('cover')!.fileName }}</strong>（{{ formatBytes(existingAsset('cover')!.size) }}）</template><template v-else>未上传</template>
              </n-text>
              <input :key="fileInputKey" type="file" accept="image/png,image/jpeg,image/webp" @change="emit('select-asset', 'cover', $event)" />
              <n-text depth="3">{{ mode === "edit-version" ? "选择新文件将替换当前封面；不选择则保持不变。" : "可选，" }}PNG/JPEG/WebP，上限 {{ formatBytes(maxImageBytes) }}</n-text>
            </n-space>
          </n-form-item>
          <n-progress v-if="saving" type="line" :percentage="uploadProgress" />
        </n-space>
      </n-tab-pane>
    </n-tabs>
    <template #action><n-space justify="end"><n-button :disabled="saving" @click="show = false">取消</n-button><n-button type="primary" :loading="saving" @click="emit('submit')">保存</n-button></n-space></template>
  </n-modal>
</template>

<script setup lang="ts">
import { computed } from "vue";

type FormMode = "create-game" | "add-version" | "edit-game" | "edit-version";
type AssetRole = "package" | "icon" | "cover";
interface ExistingAsset { role: AssetRole; fileName: string; size: number }
const show = defineModel<boolean>("show", { required: true });
const activeTab = defineModel<string>("activeTab", { required: true });
const manifestEnabled = defineModel<boolean>("manifestEnabled", { required: true });
const setLatest = defineModel<boolean>("setLatest", { required: true });
const props = defineProps<{
  mode: FormMode; title: string; canPublishDirect: boolean; saving: boolean; uploadProgress: number;
  maxPackageBytes: number; maxImageBytes: number; fileInputKey: number;
  game: Record<string, any>; version: Record<string, any>; manifest: Record<string, any>;
  files: Record<string, File | null>;
  existingAssets: ExistingAsset[];
}>();
const emit = defineEmits<{ submit: []; "select-asset": [role: "package" | "icon" | "cover", event: Event] }>();
const showGameFields = computed(() => ["create-game", "edit-game"].includes(props.mode));
const showVersionFields = computed(() => props.mode !== "edit-game");
const showFiles = computed(() => props.mode !== "edit-game");
const existingAssetsByRole = computed(() => new Map(props.existingAssets.map((asset) => [asset.role, asset])));
const gameTypeOptions = [{ label: "单人游戏", value: "singleplayer" }, { label: "多人游戏", value: "multiplayer" }, { label: "单人/多人", value: "singlemultiple" }, { label: "网络游戏", value: "networkgame" }];
const visibilityOptions = [{ label: "公开", value: "public" }, { label: "隐藏", value: "hidden" }, { label: "已弃用", value: "deprecated" }];
const platformModeOptions = [{ label: "SemVer 范围", value: "range" }, { label: "最低/最高版本", value: "tuple" }];
const statisticKindOptions = [{ label: "仅 ID", value: "id" }, { label: "显示名称", value: "label" }, { label: "名称与模式", value: "details" }];
const statisticModeOptions = [{ label: "增量", value: "increment" }, { label: "完整值", value: "full" }];
const newStatistic = () => ({ id: "", kind: "id", label: "", mode: "increment" });
const newAchievement = () => ({ id: "", title: "", description: "", icon: "" });
function formatBytes(value = 0) { if (!Number.isFinite(value) || value <= 0) return "0 B"; const units = ["B", "KiB", "MiB", "GiB"]; const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), 3); return `${(value / 1024 ** index).toFixed(index ? 2 : 0)} ${units[index]}`; }
function existingAsset(role: AssetRole) { return existingAssetsByRole.value.get(role); }
</script>

<style scoped>
.form-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0 24px; }
.span-2 { grid-column: span 2; }
.achievement-row { display: grid; grid-template-columns: 1fr 1fr 1.2fr; gap: 10px; width: 100%; }
.achievement-row > :last-child { grid-column: span 3; }
.current-asset { overflow-wrap: anywhere; }
@media (max-width: 760px) { .form-grid { grid-template-columns: 1fr; } .span-2 { grid-column: span 1; } }
</style>
