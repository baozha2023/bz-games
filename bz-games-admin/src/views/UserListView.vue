<template>
  <n-space vertical :size="18">
    <n-card>
      <n-space align="center">
        <n-input
          v-model:value="query"
          clearable
          placeholder="搜索 GitHub ID、用户名、名称或邮箱"
          style="width: 360px"
          @keyup.enter="applySearch"
        />
        <n-button type="primary" @click="applySearch">查询</n-button>
        <n-button @click="resetSearch">重置</n-button>
      </n-space>
    </n-card>

    <n-card>
      <n-data-table
        remote
        :columns="columns"
        :data="items"
        :loading="loading"
        :row-key="(row: PortalUser) => row.id"
        :scroll-x="1250"
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
</template>

<script setup lang="ts">
import { h, onMounted, ref } from "vue";
import { NAvatar, NTag, type DataTableColumns, useMessage } from "naive-ui";

import { api, ApiError } from "../api";

interface PortalUser {
  id: string;
  githubId: string;
  login: string;
  name: string;
  avatarUrl: string;
  profileUrl: string;
  email: string;
  role: "player" | "creator" | "administrator";
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string;
}

interface UserListResponse {
  items: PortalUser[];
  total: number;
  page: number;
  pageSize: number;
}

const message = useMessage();
const items = ref<PortalUser[]>([]);
const loading = ref(false);
const query = ref("");
const page = ref(1);
const pageSize = ref(20);
const total = ref(0);
let loadSequence = 0;

function formatTime(value: string) {
  return value ? new Date(value).toLocaleString() : "-";
}

const columns: DataTableColumns<PortalUser> = [
  { title: "头像", key: "avatar", width: 72, render: (row) => h(NAvatar, { round: true, size: 36, src: row.avatarUrl || undefined }) },
  { title: "GitHub 用户", key: "login", width: 180, render: (row) => row.profileUrl
    ? h("a", { href: row.profileUrl, target: "_blank", rel: "noopener noreferrer" }, row.login)
    : row.login },
  { title: "名称", key: "name", width: 160, ellipsis: { tooltip: true }, render: (row) => row.name || "-" },
  { title: "GitHub ID", key: "githubId", width: 140 },
  { title: "邮箱", key: "email", width: 220, ellipsis: { tooltip: true }, render: (row) => row.email || "-" },
  { title: "角色", key: "role", width: 120, render: (row) => h(NTag, { type: row.role === "administrator" ? "success" : row.role === "creator" ? "info" : "default", size: "small" }, { default: () => row.role === "administrator" ? "管理员" : row.role === "creator" ? "创作者" : "玩家" }) },
  { title: "注册时间", key: "createdAt", width: 180, render: (row) => formatTime(row.createdAt) },
  { title: "最近登录", key: "lastLoginAt", width: 180, render: (row) => formatTime(row.lastLoginAt) },
];

async function load() {
  const sequence = ++loadSequence;
  loading.value = true;
  try {
    const params = new URLSearchParams({ page: String(page.value), pageSize: String(pageSize.value) });
    if (query.value.trim()) params.set("q", query.value.trim());
    const result = await api<UserListResponse>(`/api/portal/v1/users?${params}`);
    if (sequence !== loadSequence) return;
    items.value = result.items;
    total.value = result.total;
  } catch (error) {
    if (error instanceof ApiError && error.status === 403) message.error("当前账号无权查看用户列表");
    else message.error(error instanceof Error ? error.message : "用户列表加载失败");
  } finally {
    if (sequence === loadSequence) loading.value = false;
  }
}

function applySearch() { page.value = 1; void load(); }
function resetSearch() { query.value = ""; page.value = 1; void load(); }
function changePageSize(value: number) { pageSize.value = value; page.value = 1; void load(); }
onMounted(load);
</script>
