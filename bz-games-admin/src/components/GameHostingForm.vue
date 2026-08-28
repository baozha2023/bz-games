<template>
  <n-modal v-model:show="show" preset="card" :title="title" style="width: min(1180px, 96vw)" :mask-closable="!saving" :close-on-esc="!saving">
    <n-steps :current="currentStep + 1" size="small" class="wizard-steps">
      <n-step v-for="step in visibleSteps" :key="step.name" :title="step.title" />
    </n-steps>

    <div class="wizard-content">
      <section v-if="activeStep === 'game'" class="wizard-panel">
        <n-alert type="info" :show-icon="false" class="step-help">游戏信息遵循市场 Schema 2。默认语言必须完整填写，其他语言启用后也必须完整填写。
        </n-alert>
        <div class="form-grid">
          <n-form-item label="游戏 ID" required><n-input v-model:value="game.id" :disabled="mode !== 'create-game'" placeholder="com.example.game" /></n-form-item>
          <n-form-item label="默认语言" required><n-select v-model:value="game.defaultLocale" :options="localeOptions" /></n-form-item>
          <n-form-item label="作者" required><n-input v-model:value="game.author" maxlength="100" /></n-form-item>
          <n-form-item label="作者地址"><n-input v-model:value="game.author_url" placeholder="https://..." /></n-form-item>
          <n-form-item label="游戏类型" required><n-select v-model:value="game.type" :options="gameTypeOptions" /></n-form-item>
          <n-form-item label="可见性"><n-select v-model:value="game.visibility" clearable :options="visibilityOptions" /></n-form-item>
          <n-form-item label="最少玩家"><n-input-number v-model:value="game.minPlayers" :min="1" clearable /></n-form-item>
          <n-form-item label="最多玩家"><n-input-number v-model:value="game.maxPlayers" :min="1" clearable /></n-form-item>
          <n-form-item label="推荐展示"><n-switch v-model:value="game.featured" /></n-form-item>
        </div>
        <n-divider>游戏本地化信息</n-divider>
        <n-tabs v-model:value="gameLocaleEditor" type="line">
          <n-tab-pane v-for="locale in enabledGameLocales" :key="locale" :name="locale" :tab="localeLabel(locale)">
            <div class="form-grid">
              <n-form-item :label="localizedLabel(locale, 'gameName')" required><n-input v-model:value="game.localizations[locale].name" maxlength="100" :placeholder="localizedPlaceholder(locale, 'gameName')" /></n-form-item>
              <n-form-item :label="localizedLabel(locale, 'tags')"><n-input v-model:value="game.localizations[locale].tagsText" type="textarea" :rows="2" :placeholder="localizedPlaceholder(locale, 'tags')" /></n-form-item>
              <n-form-item :label="localizedLabel(locale, 'summary')" required class="span-2"><n-input v-model:value="game.localizations[locale].summary" type="textarea" maxlength="500" show-count :placeholder="localizedPlaceholder(locale, 'summary')" /></n-form-item>
            </div>
          </n-tab-pane>
        </n-tabs>
        <n-space class="locale-actions"><n-button v-for="locale in optionalLocales" :key="locale" size="small" :type="isGameLocaleEnabled(locale) ? 'warning' : 'default'" @click="toggleGameLocale(locale)">{{ isGameLocaleEnabled(locale) ? `移除 ${localeLabel(locale)}` : `添加 ${localeLabel(locale)}` }}</n-button></n-space>
        <div class="form-grid single-row">
          <n-form-item label="截图地址" class="span-2"><n-input v-model:value="game.screenshotsText" placeholder="每行一个 HTTP(S) 地址" type="textarea" :rows="3" /></n-form-item>
          <n-form-item label="外部图标地址"><n-input v-model:value="game.iconUrl" :disabled="!!files.icon" placeholder="可留空或填写 HTTP(S) 地址" /></n-form-item>
          <n-form-item label="外部封面地址"><n-input v-model:value="game.coverUrl" :disabled="!!files.cover" placeholder="可留空或填写 HTTP(S) 地址" /></n-form-item>
        </div>
      </section>

      <section v-else-if="activeStep === 'version'" class="wizard-panel">
        <n-alert type="info" :show-icon="false" class="step-help">版本描述和更新说明必须使用与游戏信息完全相同的语言集合。
        </n-alert>
        <div class="form-grid">
          <n-form-item label="版本" required><n-input v-model:value="version.version" :disabled="mode === 'edit-version'" placeholder="1.0.0" /></n-form-item>
          <n-form-item label="平台版本" required><n-input v-model:value="version.platformVersion" placeholder=">=3.1.0" /></n-form-item>
          <n-form-item label="发布时间"><n-date-picker v-model:value="version.publishedAt" type="datetime" clearable style="width: 100%" /></n-form-item>
          <n-form-item label="预发布版本"><n-switch v-model:value="version.isPrerelease" /></n-form-item>
          <n-form-item v-if="mode === 'add-version' && canPublishDirect" label="设为最新版本"><n-switch v-model:value="setLatest" /></n-form-item>
        </div>
        <n-divider>版本本地化信息</n-divider>
        <n-tabs v-model:value="versionLocaleEditor" type="line">
          <n-tab-pane v-for="locale in enabledGameLocales" :key="locale" :name="locale" :tab="localeLabel(locale)">
            <n-form-item :label="localizedLabel(locale, 'versionDescription')" required><n-input v-model:value="version.localizations[locale].description" type="textarea" :rows="4" :placeholder="localizedPlaceholder(locale, 'versionDescription')" /></n-form-item>
            <n-form-item :label="localizedLabel(locale, 'releaseNotes')"><n-input v-model:value="version.localizations[locale].releaseNotes" type="textarea" :rows="5" :placeholder="localizedPlaceholder(locale, 'releaseNotes')" /></n-form-item>
          </n-tab-pane>
        </n-tabs>
      </section>

      <section v-else-if="activeStep === 'manifest'" class="wizard-panel">
        <n-space vertical :size="16">
          <n-checkbox v-model:checked="manifestEnabled">配置 Manifest V2 覆盖信息</n-checkbox>
          <n-alert v-if="manifestEnabled" type="warning" :show-icon="false">覆盖内容只接受 Manifest V2。ZIP 内的 game.json 不会被服务端解压或修改；未填写覆盖时，ZIP 内文件原样保留。
          </n-alert>
          <template v-if="manifestEnabled">
            <div class="form-grid">
              <n-form-item label="Manifest 默认语言" required>
                <n-select v-model:value="manifest.defaultLocale" :options="localeOptions" disabled />
              </n-form-item>
              <n-form-item label="入口" required><n-input v-model:value="manifest.entry" placeholder="index.html、serve 或 url" /></n-form-item>
              <n-form-item label="作者"><n-input v-model:value="manifest.author" maxlength="100" /></n-form-item>
              <n-form-item label="作者地址"><n-input v-model:value="manifest.author_url" placeholder="https://..." /></n-form-item>
              <n-form-item label="平台版本形式"><n-select v-model:value="manifest.platformMode" :options="platformModeOptions" /></n-form-item>
              <n-form-item v-if="manifest.platformMode === 'range'" label="平台范围"><n-input v-model:value="manifest.platformRange" placeholder=">=3.1.0" /></n-form-item>
              <template v-else><n-form-item label="最低平台版本"><n-input v-model:value="manifest.platformMin" placeholder="3.1.0" /></n-form-item><n-form-item label="最高平台版本"><n-input v-model:value="manifest.platformMax" placeholder="4.0.0" /></n-form-item></template>
              <n-form-item label="网页地址"><n-input v-model:value="manifest.web_url" placeholder="entry=url 时填写" /></n-form-item>
              <n-form-item label="包内图标路径"><n-input v-model:value="manifest.icon" /></n-form-item>
              <n-form-item label="包内封面路径"><n-input v-model:value="manifest.cover" /></n-form-item>
              <n-form-item label="包内视频路径"><n-input v-model:value="manifest.video" /></n-form-item>
              <n-form-item label="游戏类型"><n-select v-model:value="manifest.type" clearable :options="gameTypeOptions" /></n-form-item>
              <n-form-item label="加密本地存储"><n-switch v-model:value="manifest.encryptLocalStorage" /></n-form-item>
              <n-form-item v-if="isWebEntry" label="窗口化全屏"><n-switch v-model:value="manifest.windowedFullscreen" /></n-form-item>
              <n-form-item label="联机最少玩家"><n-input-number v-model:value="manifest.minPlayers" :min="1" clearable /></n-form-item>
              <n-form-item label="联机最多玩家"><n-input-number v-model:value="manifest.maxPlayers" :min="1" clearable /></n-form-item>
            </div>
            <n-divider>Manifest 本地化信息</n-divider>
            <n-tabs v-model:value="manifestLocaleEditor" type="line">
              <n-tab-pane v-for="locale in enabledGameLocales" :key="locale" :name="locale" :tab="localeLabel(locale)">
                <div class="form-grid">
                  <n-form-item :label="localizedLabel(locale, 'manifestName')" required><n-input v-model:value="manifest.localizations[locale].name" maxlength="100" :placeholder="localizedPlaceholder(locale, 'manifestName')" /></n-form-item>
                  <n-form-item :label="localizedLabel(locale, 'manifestDescription')" required class="span-2"><n-input v-model:value="manifest.localizations[locale].description" type="textarea" :rows="4" maxlength="500" :placeholder="localizedPlaceholder(locale, 'manifestDescription')" /></n-form-item>
                </div>
              </n-tab-pane>
            </n-tabs>
          </template>
        </n-space>
      </section>

      <section v-else-if="activeStep === 'advanced'" class="wizard-panel">
        <n-space v-if="manifestEnabled" vertical :size="18">
          <n-text v-if="isWebEntry" depth="3">Web 入口不使用 Native 启动参数和环境变量。</n-text>
          <n-text v-else-if="!isNativeEntry" depth="3">请先在 Manifest 步骤配置 Native 或 Web 入口。</n-text>
          <template v-if="isNativeEntry">
            <n-form-item label="启动参数"><n-dynamic-input v-model:value="manifest.args" placeholder="每项一个参数" /></n-form-item>
            <n-form-item label="环境变量"><n-dynamic-input v-model:value="manifest.env" :on-create="newEnv"><template #default="{ value }"><n-space style="width: 100%"><n-input v-model:value="value.key" placeholder="变量名" /><n-input v-model:value="value.value" placeholder="值" /></n-space></template></n-dynamic-input></n-form-item>
          </template>
          <n-divider>统计项</n-divider>
          <n-tabs v-model:value="manifestLocaleEditor" type="line">
            <n-tab-pane v-for="locale in enabledGameLocales" :key="locale" :name="locale" :tab="localeLabel(locale)">
              <n-dynamic-input v-model:value="manifest.statistics" :on-create="newStatistic"><template #default="{ value }"><n-space style="width: 100%" align="center"><n-input v-model:value="value.id" placeholder="统计 ID" /><n-input v-model:value="value.labels[locale]" :placeholder="localizedPlaceholder(locale, 'statisticName')" :aria-label="localizedLabel(locale, 'statisticName')" /><n-select v-model:value="value.mode" :options="statisticModeOptions" style="width: 130px" /></n-space></template></n-dynamic-input>
            </n-tab-pane>
          </n-tabs>
          <n-divider>成就</n-divider>
          <n-tabs v-model:value="manifestLocaleEditor" type="line">
            <n-tab-pane v-for="locale in enabledGameLocales" :key="locale" :name="locale" :tab="localeLabel(locale)">
              <n-dynamic-input v-model:value="manifest.achievements" :on-create="newAchievement"><template #default="{ value }"><div class="achievement-row"><n-input v-model:value="value.id" placeholder="成就 ID" /><n-input v-model:value="value.translations[locale].title" :placeholder="localizedPlaceholder(locale, 'achievementTitle')" :aria-label="localizedLabel(locale, 'achievementTitle')" /><n-input v-model:value="value.icon" placeholder="包内图标路径（可选）" /><n-input v-model:value="value.translations[locale].description" type="textarea" :placeholder="localizedPlaceholder(locale, 'achievementDescription')" :aria-label="localizedLabel(locale, 'achievementDescription')" /></div></template></n-dynamic-input>
            </n-tab-pane>
          </n-tabs>
        </n-space>
        <n-empty v-else description="未配置 Manifest 覆盖，本步骤无需填写" />
      </section>

      <section v-else-if="activeStep === 'files'" class="wizard-panel">
        <n-space vertical :size="20">
          <n-alert type="info" :show-icon="false">ZIP 内的 game.json 可以是任意版本；服务端只校验托管资源本身，Manifest 覆盖由上一流程按 V2 生成。</n-alert>
          <n-form-item label="ZIP 游戏包" :required="mode !== 'edit-version'"><n-space vertical :size="8"><n-text v-if="mode === 'edit-version'" class="current-asset">当前文件：<template v-if="existingAsset('package')"><strong>{{ existingAsset('package')!.fileName }}</strong>（{{ formatBytes(existingAsset('package')!.size) }}）</template><template v-else>未上传</template></n-text><input :key="fileInputKey" type="file" accept=".zip,application/zip" @change="emit('select-asset', 'package', $event)" /><n-text depth="3">{{ mode === 'edit-version' ? '选择新文件将替换当前 ZIP；不选择则保持不变。' : '' }}上限 {{ formatBytes(maxPackageBytes) }}</n-text></n-space></n-form-item>
          <n-form-item label="游戏图标"><n-space vertical :size="8"><n-text v-if="mode === 'edit-version'" class="current-asset">当前文件：<template v-if="existingAsset('icon')"><strong>{{ existingAsset('icon')!.fileName }}</strong>（{{ formatBytes(existingAsset('icon')!.size) }}）</template><template v-else>未上传</template></n-text><input v-if="canUploadVersionImages" :key="fileInputKey" type="file" accept="image/png,image/jpeg,image/webp" @change="emit('select-asset', 'icon', $event)" /><n-text depth="3">{{ canUploadVersionImages ? (mode === 'edit-version' ? '选择新文件将替换当前图标；不选择则保持不变。' : '可选，') + `PNG/JPEG/WebP，上限 ${formatBytes(maxImageBytes)}` : '图标仅允许在游戏的唯一版本中上传。' }}</n-text></n-space></n-form-item>
          <n-form-item label="游戏封面"><n-space vertical :size="8"><n-text v-if="mode === 'edit-version'" class="current-asset">当前文件：<template v-if="existingAsset('cover')"><strong>{{ existingAsset('cover')!.fileName }}</strong>（{{ formatBytes(existingAsset('cover')!.size) }}）</template><template v-else>未上传</template></n-text><input v-if="canUploadVersionImages" :key="fileInputKey" type="file" accept="image/png,image/jpeg,image/webp" @change="emit('select-asset', 'cover', $event)" /><n-text depth="3">{{ canUploadVersionImages ? (mode === 'edit-version' ? '选择新文件将替换当前封面；不选择则保持不变。' : '可选，') + `PNG/JPEG/WebP，上限 ${formatBytes(maxImageBytes)}` : '封面仅允许在游戏的唯一版本中上传。' }}</n-text></n-space></n-form-item>
          <n-progress v-if="saving" type="line" :percentage="uploadProgress" />
        </n-space>
      </section>
    </div>

    <template #action><n-space justify="space-between" style="width: 100%"><n-button :disabled="saving || currentStep === 0" @click="emit('previous')">上一步</n-button><n-space><n-button :disabled="saving" @click="show = false">取消</n-button><n-button v-if="!isLastStep" type="primary" :disabled="saving" @click="emit('next')">下一步</n-button><n-button v-else type="primary" :loading="saving" @click="emit('submit')">保存</n-button></n-space></n-space></template>
  </n-modal>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { getManifestEntryKind } from "../utils/manifest-entry";

type FormMode = "create-game" | "add-version" | "edit-game" | "edit-version";
type AssetRole = "package" | "icon" | "cover";
type Locale = "zh-CN" | "zh-TW" | "en-US" | "ja-JP" | "de-DE";
type LocalizedField = "gameName" | "tags" | "summary" | "versionDescription" | "releaseNotes" | "manifestName" | "manifestDescription" | "statisticName" | "achievementTitle" | "achievementDescription";
const SUPPORTED_LOCALES: Locale[] = ["zh-CN", "zh-TW", "en-US", "ja-JP", "de-DE"];
const LOCALE_LABELS: Record<Locale, string> = { "zh-CN": "简体中文", "zh-TW": "繁體中文", "en-US": "English", "ja-JP": "日本語", "de-DE": "Deutsch" };
const LOCALIZED_LABELS: Record<Locale, Record<LocalizedField, string>> = {
  "zh-CN": {
    gameName: "名称",
    tags: "标签",
    summary: "摘要",
    versionDescription: "版本描述",
    releaseNotes: "更新说明",
    manifestName: "游戏名称",
    manifestDescription: "游戏描述",
    statisticName: "统计名称",
    achievementTitle: "成就标题",
    achievementDescription: "成就描述",
  },
  "zh-TW": {
    gameName: "名稱",
    tags: "標籤",
    summary: "摘要",
    versionDescription: "版本描述",
    releaseNotes: "更新說明",
    manifestName: "遊戲名稱",
    manifestDescription: "遊戲描述",
    statisticName: "統計名稱",
    achievementTitle: "成就標題",
    achievementDescription: "成就描述",
  },
  "en-US": {
    gameName: "Name",
    tags: "Tags",
    summary: "Summary",
    versionDescription: "Version description",
    releaseNotes: "Release notes",
    manifestName: "Game name",
    manifestDescription: "Game description",
    statisticName: "Statistic name",
    achievementTitle: "Achievement title",
    achievementDescription: "Achievement description",
  },
  "ja-JP": {
    gameName: "ゲーム名",
    tags: "タグ",
    summary: "概要",
    versionDescription: "バージョンの説明",
    releaseNotes: "更新内容",
    manifestName: "ゲーム名",
    manifestDescription: "ゲームの説明",
    statisticName: "統計名",
    achievementTitle: "実績タイトル",
    achievementDescription: "実績の説明",
  },
  "de-DE": {
    gameName: "Name",
    tags: "Tags",
    summary: "Zusammenfassung",
    versionDescription: "Versionsbeschreibung",
    releaseNotes: "Versionshinweise",
    manifestName: "Spielname",
    manifestDescription: "Spielbeschreibung",
    statisticName: "Statistikname",
    achievementTitle: "Erfolgstitel",
    achievementDescription: "Erfolgsbeschreibung",
  },
};
const LOCALIZED_PLACEHOLDERS: Record<Locale, Record<LocalizedField, string>> = {
  "zh-CN": {
    gameName: "请输入游戏名称",
    tags: "每行输入一个标签",
    summary: "请输入游戏摘要",
    versionDescription: "请输入版本描述",
    releaseNotes: "请输入更新说明",
    manifestName: "请输入游戏名称",
    manifestDescription: "请输入游戏描述",
    statisticName: "请输入统计名称",
    achievementTitle: "请输入成就标题",
    achievementDescription: "请输入成就描述",
  },
  "zh-TW": {
    gameName: "請輸入遊戲名稱",
    tags: "每行輸入一個標籤",
    summary: "請輸入遊戲摘要",
    versionDescription: "請輸入版本描述",
    releaseNotes: "請輸入更新說明",
    manifestName: "請輸入遊戲名稱",
    manifestDescription: "請輸入遊戲描述",
    statisticName: "請輸入統計名稱",
    achievementTitle: "請輸入成就標題",
    achievementDescription: "請輸入成就描述",
  },
  "en-US": {
    gameName: "Enter the game name",
    tags: "Enter one tag per line",
    summary: "Enter a game summary",
    versionDescription: "Enter the version description",
    releaseNotes: "Enter the release notes",
    manifestName: "Enter the game name",
    manifestDescription: "Enter the game description",
    statisticName: "Enter the statistic name",
    achievementTitle: "Enter the achievement title",
    achievementDescription: "Enter the achievement description",
  },
  "ja-JP": {
    gameName: "ゲーム名を入力してください",
    tags: "1行に1つタグを入力してください",
    summary: "ゲーム概要を入力してください",
    versionDescription: "バージョンの説明を入力してください",
    releaseNotes: "更新内容を入力してください",
    manifestName: "ゲーム名を入力してください",
    manifestDescription: "ゲームの説明を入力してください",
    statisticName: "統計名を入力してください",
    achievementTitle: "実績タイトルを入力してください",
    achievementDescription: "実績の説明を入力してください",
  },
  "de-DE": {
    gameName: "Spielnamen eingeben",
    tags: "Ein Tag pro Zeile",
    summary: "Spielzusammenfassung eingeben",
    versionDescription: "Versionsbeschreibung eingeben",
    releaseNotes: "Versionshinweise eingeben",
    manifestName: "Spielnamen eingeben",
    manifestDescription: "Spielbeschreibung eingeben",
    statisticName: "Statistiknamen eingeben",
    achievementTitle: "Erfolgstitel eingeben",
    achievementDescription: "Erfolgsbeschreibung eingeben",
  },
};
interface ExistingAsset { role: AssetRole; fileName: string; size: number }
const show = defineModel<boolean>("show", { required: true });
const activeTab = defineModel<string>("activeTab", { required: true });
const manifestEnabled = defineModel<boolean>("manifestEnabled", { required: true });
const setLatest = defineModel<boolean>("setLatest", { required: true });
const props = defineProps<{ mode: FormMode; title: string; canPublishDirect: boolean; saving: boolean; uploadProgress: number; maxPackageBytes: number; maxImageBytes: number; fileInputKey: number; files: Record<string, File | null>; existingAssets: ExistingAsset[]; canUploadVersionImages: boolean }>();
const game = defineModel<Record<string, any>>("game", { required: true });
const version = defineModel<Record<string, any>>("version", { required: true });
const manifest = defineModel<Record<string, any>>("manifest", { required: true });
const emit = defineEmits<{ submit: []; next: []; previous: []; "select-asset": [role: AssetRole, event: Event] }>();
const visibleSteps = computed(() => { const steps = [] as Array<{ name: string; title: string }>; if (["create-game", "edit-game"].includes(props.mode)) steps.push({ name: "game", title: "游戏信息" }); if (props.mode !== "edit-game") steps.push({ name: "version", title: "版本信息" }, { name: "manifest", title: "Manifest V2" }, { name: "advanced", title: "高级配置" }, { name: "files", title: "托管资源" }); return steps; });
const activeStep = computed(() => activeTab.value);
const currentStep = computed(() => Math.max(0, visibleSteps.value.findIndex((step) => step.name === activeStep.value)));
const isLastStep = computed(() => currentStep.value === visibleSteps.value.length - 1);
const localeOptions = SUPPORTED_LOCALES.map((value) => ({ label: LOCALE_LABELS[value], value }));
const gameTypeOptions = [{ label: "单人游戏", value: "singleplayer" }, { label: "多人游戏", value: "multiplayer" }, { label: "单人/多人", value: "singlemultiple" }, { label: "网络游戏", value: "networkgame" }];
const visibilityOptions = [{ label: "公开", value: "public" }, { label: "隐藏", value: "hidden" }, { label: "已弃用", value: "deprecated" }];
const platformModeOptions = [{ label: "SemVer 范围", value: "range" }, { label: "最低/最高版本", value: "tuple" }];
const statisticModeOptions = [{ label: "增量", value: "increment" }, { label: "完整值", value: "full" }];
const gameLocaleEditor = ref<Locale>("zh-CN");
const versionLocaleEditor = ref<Locale>("zh-CN");
const manifestLocaleEditor = ref<Locale>("zh-CN");
const enabledGameLocales = computed<Locale[]>(() => { const configured = SUPPORTED_LOCALES.filter((locale) => game.value.localizations?.[locale]?.enabled); return configured.length ? configured : [game.value.defaultLocale || "zh-CN"]; });
const optionalLocales = computed(() => SUPPORTED_LOCALES.filter((locale) => locale !== game.value.defaultLocale));
const entryKind = computed(() => getManifestEntryKind(manifest.value.entry));
const isWebEntry = computed(() => entryKind.value === "web");
const isNativeEntry = computed(() => entryKind.value === "native");
watch(enabledGameLocales, (locales) => { if (!locales.includes(gameLocaleEditor.value)) gameLocaleEditor.value = locales[0]; if (!locales.includes(versionLocaleEditor.value)) versionLocaleEditor.value = locales[0]; if (!locales.includes(manifestLocaleEditor.value)) manifestLocaleEditor.value = locales[0]; }, { immediate: true });
watch(() => game.value.defaultLocale, (locale) => {
  if (!locale) return;
  if (game.value.localizations?.[locale]) game.value.localizations[locale].enabled = true;
  if (manifest.value.defaultLocale !== locale) manifest.value.defaultLocale = locale;
}, { immediate: true });
function localeLabel(locale: Locale) { return LOCALE_LABELS[locale]; }
function localizedLabel(locale: Locale, field: LocalizedField) { return LOCALIZED_LABELS[locale][field]; }
function localizedPlaceholder(locale: Locale, field: LocalizedField) { return LOCALIZED_PLACEHOLDERS[locale][field]; }
function isGameLocaleEnabled(locale: Locale) { return Boolean(game.value.localizations?.[locale]?.enabled); }
function toggleGameLocale(locale: Locale) { if (locale === game.value.defaultLocale) return; game.value.localizations[locale].enabled = !game.value.localizations[locale].enabled; }
function newEnv() { return { key: "", value: "" }; }
function newStatistic() { return { id: "", mode: "increment", labels: Object.fromEntries(SUPPORTED_LOCALES.map((locale) => [locale, ""])) }; }
function newAchievement() { return { id: "", icon: "", translations: Object.fromEntries(SUPPORTED_LOCALES.map((locale) => [locale, { title: "", description: "" }])) }; }
function existingAsset(role: AssetRole) { return new Map(props.existingAssets.map((asset) => [asset.role, asset])).get(role); }
function formatBytes(value = 0) { if (!Number.isFinite(value) || value <= 0) return "0 B"; const units = ["B", "KiB", "MiB", "GiB"]; const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), 3); return `${(value / 1024 ** index).toFixed(index ? 2 : 0)} ${units[index]}`; }
</script>

<style scoped>
.wizard-steps { margin-bottom: 24px; }
.wizard-content { min-height: 500px; }
.wizard-panel { padding: 0 4px; }
.step-help { margin-bottom: 18px; }
.form-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0 24px; }
.single-row { margin-top: 18px; }
.span-2 { grid-column: span 2; }
.locale-actions { margin-top: 6px; }
.achievement-row { display: grid; grid-template-columns: 1fr 1fr 1.2fr; gap: 10px; width: 100%; }
.achievement-row > :last-child { grid-column: span 3; }
.current-asset { overflow-wrap: anywhere; }
@media (max-width: 760px) { .form-grid { grid-template-columns: 1fr; } .span-2 { grid-column: span 1; } .achievement-row { grid-template-columns: 1fr; } .achievement-row > :last-child { grid-column: span 1; } }
</style>
