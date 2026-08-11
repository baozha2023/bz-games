<template>
  <n-space vertical :size="18">
    <n-card title="当前正式版">
      <n-descriptions v-if="current" bordered :column="2">
        <n-descriptions-item label="版本">{{
          current.version
        }}</n-descriptions-item>
        <n-descriptions-item label="文件名">{{
          current.filename
        }}</n-descriptions-item>
        <n-descriptions-item label="大小">{{
          formatBytes(current.size)
        }}</n-descriptions-item>
        <n-descriptions-item label="SHA-256">
          <n-ellipsis style="max-width: 420px">{{ current.sha256 }}</n-ellipsis>
        </n-descriptions-item>
      </n-descriptions>
      <n-empty v-else description="尚未发布桌面安装程序" />
    </n-card>

    <n-card v-if="auth.can('release.upload')" title="上传新版本">
      <n-alert type="warning" style="margin-bottom: 18px">
        上传成功后将立即成为官网最新下载版本，并删除旧安装程序。同版本不能替换，版本号必须高于当前版本。
      </n-alert>
      <n-form label-placement="left" label-width="100" style="max-width: 760px">
        <n-form-item label="版本号">
          <n-input
            v-model:value="version"
            placeholder="例如 3.3.0"
            :disabled="uploading"
          />
        </n-form-item>
        <n-form-item label="EXE 文件">
          <input
            :key="fileInputKey"
            type="file"
            accept=".exe,application/x-msdownload"
            :disabled="uploading"
            @change="selectFile"
          />
        </n-form-item>
        <n-form-item v-if="file" label="文件信息">
          {{ file.name }} · {{ formatBytes(file.size) }} / 最大
          {{ formatBytes(maxFileBytes) }}
        </n-form-item>
        <n-progress
          v-if="uploading"
          type="line"
          :percentage="progress"
          style="margin-bottom: 18px"
        />
        <n-button
          type="primary"
          :loading="uploading"
          :disabled="!canSubmit"
          @click="submit"
        >
          上传并发布
        </n-button>
      </n-form>
    </n-card>
  </n-space>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useMessage } from "naive-ui";

import { api, ApiError, upload } from "../api";
import { useAuthStore } from "../stores/auth";

interface DesktopRelease {
  version: string;
  filename: string;
  size: number;
  sha256: string;
}

const message = useMessage();
const auth = useAuthStore();
const current = ref<DesktopRelease | null>(null);
const maxFileBytes = ref(512 * 1024 * 1024);
const version = ref("");
const file = ref<File | null>(null);
const uploading = ref(false);
const progress = ref(0);
const fileInputKey = ref(0);
const stableSemver = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const canSubmit = computed(
  () =>
    stableSemver.test(version.value.trim()) &&
    !!file.value &&
    file.value.size <= maxFileBytes.value,
);

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "KiB", "MiB", "GiB"];
  const index = Math.min(
    Math.floor(Math.log(value) / Math.log(1024)),
    units.length - 1,
  );
  return `${(value / 1024 ** index).toFixed(index ? 2 : 0)} ${units[index]}`;
}

function selectFile(event: Event) {
  const selected = (event.target as HTMLInputElement).files?.[0] || null;
  if (selected && !selected.name.toLowerCase().endsWith(".exe")) {
    message.warning("只能上传 EXE 安装程序");
    file.value = null;
    fileInputKey.value += 1;
    return;
  }
  file.value = selected;
}

async function load() {
  const result = await api<{
    release: DesktopRelease | null;
    maxFileBytes: number;
  }>("/api/admin/v1/desktop-release");
  current.value = result.release;
  maxFileBytes.value = result.maxFileBytes;
}

async function submit() {
  if (!auth.can("release.upload")) return;
  if (!canSubmit.value || !file.value) return;
  uploading.value = true;
  progress.value = 0;
  try {
    const form = new FormData();
    form.set("version", version.value.trim());
    form.set("installer", file.value, file.value.name);
    const result = await upload<{ ok: true; release: DesktopRelease }>(
      "/api/admin/v1/desktop-release",
      form,
      (value) => {
        progress.value = value;
      },
    );
    current.value = result.release;
    version.value = "";
    file.value = null;
    fileInputKey.value += 1;
    message.success(`v${result.release.version} 已发布`);
  } catch (error) {
    const code = error instanceof ApiError ? error.message : "request_failed";
    const labels: Record<string, string> = {
      invalid_desktop_release_version: "版本号格式不正确",
      invalid_desktop_release_file: "只能上传一个有效的 EXE 文件",
      desktop_release_file_required: "请选择 EXE 文件",
      desktop_release_too_large: "EXE 文件超过服务器大小限制",
      desktop_release_older_version: "新版本必须高于当前版本",
      desktop_release_version_conflict: "同版本安装程序不能替换",
      desktop_release_upload_busy: "已有版本正在上传或发布，请稍后重试",
      desktop_release_lock_failed: "服务器暂时无法锁定发布流程",
      desktop_release_publish_failed: "服务器校验或发布失败",
      invalid_origin: "管理端来源校验失败",
    };
    message.error(labels[code] || code);
  } finally {
    uploading.value = false;
  }
}

onMounted(
  () =>
    void load().catch((error) =>
      message.error(error instanceof Error ? error.message : "加载失败"),
    ),
);
</script>
