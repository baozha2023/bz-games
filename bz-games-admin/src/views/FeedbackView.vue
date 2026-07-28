<template>
  <n-space vertical :size="18">
    <n-card>
      <n-space align="center">
        <n-input
          v-model:value="query"
          clearable
          placeholder="搜索编号、内容或 GitHub 用户"
          style="width: 320px"
          @keyup.enter="applyFilters"
        />
        <n-select
          v-model:value="status"
          clearable
          placeholder="全部状态"
          :options="statusOptions"
          style="width: 180px"
          @update:value="applyFilters"
        />
        <n-button type="primary" @click="applyFilters">查询</n-button>
        <n-button @click="resetFilters">重置</n-button>
      </n-space>
    </n-card>

    <n-card>
      <n-data-table
        remote
        :columns="columns"
        :data="items"
        :loading="loading"
        :row-key="(row: FeedbackItem) => row.id"
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

  <n-modal
    v-model:show="showDetail"
    preset="card"
    title="反馈详情"
    style="width: min(900px, 94vw)"
  >
    <n-spin :show="detailLoading">
      <n-descriptions v-if="detail" bordered :column="2">
        <n-descriptions-item label="编号">{{ detail.id }}</n-descriptions-item>
        <n-descriptions-item label="提交时间">
          {{ formatTime(detail.createdAt) }}
        </n-descriptions-item>
        <n-descriptions-item label="提交身份">
          {{ detail.submitterType === "github" ? detail.githubLogin : "匿名" }}
        </n-descriptions-item>
        <n-descriptions-item label="客户端">
          {{ detail.platform || "-" }} / {{ detail.appVersion || "-" }}
        </n-descriptions-item>
        <n-descriptions-item label="内容" :span="2">
          <div class="feedback-content">
            {{ detail.content || "（仅图片）" }}
          </div>
        </n-descriptions-item>
      </n-descriptions>

      <div v-if="detail?.images.length" class="detail-images">
        <n-image
          v-for="image in detail.images"
          :key="image.id"
          width="150"
          height="150"
          object-fit="cover"
          :src="imageUrl(detail.id, image.id)"
          :alt="image.fileName"
        />
      </div>

      <n-divider />
      <n-form v-if="detail" label-placement="top">
        <n-form-item label="处理状态">
          <n-select v-model:value="editStatus" :options="statusOptions" />
        </n-form-item>
        <n-form-item label="管理备注">
          <n-input
            v-model:value="adminNote"
            type="textarea"
            maxlength="5000"
            show-count
            :autosize="{ minRows: 3, maxRows: 8 }"
          />
        </n-form-item>
      </n-form>
    </n-spin>
    <template #action>
      <n-space justify="end">
        <n-button @click="showDetail = false">关闭</n-button>
        <n-button
          type="primary"
          :loading="saving"
          :disabled="!detail"
          @click="saveDetail"
        >
          保存
        </n-button>
      </n-space>
    </template>
  </n-modal>
</template>

<script setup lang="ts">
import { h, onMounted, ref } from "vue";
import { NButton, NTag, type DataTableColumns, useMessage } from "naive-ui";
import { useRouter } from "vue-router";

import { api, ApiError } from "../api";
import { useAuthStore } from "../stores/auth";

type FeedbackStatus = "new" | "reviewing" | "planned" | "resolved" | "closed";

interface FeedbackItem {
  id: string;
  content: string;
  status: FeedbackStatus;
  submitterType: "anonymous" | "github";
  githubLogin: string;
  imageCount: number;
  createdAt: string;
}

interface FeedbackDetail extends FeedbackItem {
  adminNote: string;
  appVersion: string;
  platform: string;
  images: Array<{
    id: string;
    fileName: string;
  }>;
}

interface FeedbackListResponse {
  items: FeedbackItem[];
  total: number;
  page: number;
  pageSize: number;
}

const statusOptions = [
  { label: "新反馈", value: "new" },
  { label: "处理中", value: "reviewing" },
  { label: "已规划", value: "planned" },
  { label: "已解决", value: "resolved" },
  { label: "已关闭", value: "closed" },
];
const statusLabels = Object.fromEntries(
  statusOptions.map((item) => [item.value, item.label]),
);
const statusTypes: Record<
  FeedbackStatus,
  "default" | "info" | "warning" | "success" | "error"
> = {
  new: "info",
  reviewing: "warning",
  planned: "default",
  resolved: "success",
  closed: "error",
};

const router = useRouter();
const auth = useAuthStore();
const message = useMessage();
const items = ref<FeedbackItem[]>([]);
const loading = ref(false);
const page = ref(1);
const pageSize = ref(20);
const total = ref(0);
const query = ref("");
const status = ref<FeedbackStatus | null>(null);
const showDetail = ref(false);
const detailLoading = ref(false);
const saving = ref(false);
const detail = ref<FeedbackDetail | null>(null);
const editStatus = ref<FeedbackStatus>("new");
const adminNote = ref("");
let loadSequence = 0;

function formatTime(value: string) {
  return value ? new Date(value).toLocaleString() : "-";
}

function imageUrl(feedbackId: string, imageId: string) {
  return `/api/admin/v1/feedback/${encodeURIComponent(
    feedbackId,
  )}/images/${encodeURIComponent(imageId)}`;
}

async function handleError(error: unknown) {
  if (error instanceof ApiError && [401, 403].includes(error.status)) {
    auth.user = null;
    await router.replace({ name: "login" });
    message.error(error.status === 403 ? "当前账号不是管理员" : "登录已失效");
    return;
  }
  message.error(error instanceof Error ? error.message : "请求失败");
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
    if (status.value) params.set("status", status.value);
    const body = await api<FeedbackListResponse>(
      `/api/admin/v1/feedback?${params}`,
    );
    if (sequence === loadSequence) {
      items.value = body.items;
      total.value = body.total;
    }
  } catch (error) {
    if (sequence === loadSequence) await handleError(error);
  } finally {
    if (sequence === loadSequence) loading.value = false;
  }
}

async function openDetail(row: FeedbackItem) {
  showDetail.value = true;
  detailLoading.value = true;
  detail.value = null;
  try {
    const body = await api<FeedbackDetail>(
      `/api/admin/v1/feedback/${encodeURIComponent(row.id)}`,
    );
    detail.value = body;
    editStatus.value = body.status;
    adminNote.value = body.adminNote;
  } catch (error) {
    await handleError(error);
    showDetail.value = false;
  } finally {
    detailLoading.value = false;
  }
}

async function saveDetail() {
  if (!detail.value) return;
  saving.value = true;
  try {
    await api<{ ok: true }>(
      `/api/admin/v1/feedback/${encodeURIComponent(detail.value.id)}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          status: editStatus.value,
          adminNote: adminNote.value,
        }),
      },
    );
    message.success("已保存");
    showDetail.value = false;
    await load();
  } catch (error) {
    await handleError(error);
  } finally {
    saving.value = false;
  }
}

function applyFilters() {
  page.value = 1;
  void load();
}

function resetFilters() {
  query.value = "";
  status.value = null;
  page.value = 1;
  void load();
}

function changePageSize(value: number) {
  pageSize.value = value;
  page.value = 1;
  void load();
}

const columns: DataTableColumns<FeedbackItem> = [
  {
    title: "状态",
    key: "status",
    width: 100,
    render: (row) =>
      h(
        NTag,
        { type: statusTypes[row.status], size: "small" },
        { default: () => statusLabels[row.status] },
      ),
  },
  {
    title: "内容",
    key: "content",
    ellipsis: { tooltip: true },
    render: (row) => row.content || "（仅图片）",
  },
  {
    title: "提交者",
    key: "submitter",
    width: 150,
    render: (row) =>
      row.submitterType === "github" ? row.githubLogin : "匿名",
  },
  {
    title: "图片",
    key: "imageCount",
    width: 70,
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
    width: 90,
    render: (row) =>
      h(
        NButton,
        { size: "small", onClick: () => openDetail(row) },
        { default: () => "查看" },
      ),
  },
];

onMounted(load);
</script>
