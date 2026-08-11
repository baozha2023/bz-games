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
        :scroll-x="1370"
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

    <n-modal
      v-model:show="showRoleModal"
      preset="card"
      title="调整用户角色"
      style="width: 460px"
      :mask-closable="!savingRole"
      :close-on-esc="!savingRole"
    >
      <n-space vertical :size="18">
        <n-text>
          将用户 <strong>{{ editingUser?.login }}</strong> 的角色调整为：
        </n-text>
        <n-select v-model:value="selectedRole" :options="roleOptions" />
        <n-space justify="end">
          <n-button :disabled="savingRole" @click="closeRoleModal"
            >取消</n-button
          >
          <n-button
            type="primary"
            :loading="savingRole"
            :disabled="!selectedRole || selectedRole === editingUser?.role"
            @click="saveRole"
          >
            确认调整
          </n-button>
        </n-space>
      </n-space>
    </n-modal>
  </n-space>
</template>

<script setup lang="ts">
import { computed, h, onMounted, ref } from "vue";
import {
  NAvatar,
  NButton,
  NTag,
  type DataTableColumns,
  useMessage,
} from "naive-ui";

import { api, ApiError } from "../api";
import type { PortalRole } from "../rbac";
import { useAuthStore } from "../stores/auth";

type AssignablePortalRole = "player" | "creator" | "administrator";

interface PortalUser {
  id: string;
  githubId: string;
  login: string;
  name: string;
  avatarUrl: string;
  profileUrl: string;
  email: string;
  role: PortalRole;
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
const auth = useAuthStore();
const items = ref<PortalUser[]>([]);
const loading = ref(false);
const query = ref("");
const page = ref(1);
const pageSize = ref(20);
const total = ref(0);
let loadSequence = 0;
const showRoleModal = ref(false);
const editingUser = ref<PortalUser | null>(null);
const selectedRole = ref<AssignablePortalRole | null>(null);
const savingRole = ref(false);

const roleOptions: Array<{ label: string; value: AssignablePortalRole }> = [
  { label: "玩家", value: "player" },
  { label: "创作者", value: "creator" },
  { label: "管理员", value: "administrator" },
];

const roleLabels: Record<PortalRole, string> = {
  player: "玩家",
  creator: "创作者",
  administrator: "管理员",
  super_administrator: "超级管理员",
};

function roleTagType(role: PortalRole) {
  return role === "super_administrator"
    ? "warning"
    : role === "administrator"
      ? "success"
      : role === "creator"
        ? "info"
        : "default";
}

function formatTime(value: string) {
  return value ? new Date(value).toLocaleString() : "-";
}

const baseColumns: DataTableColumns<PortalUser> = [
  {
    title: "头像",
    key: "avatar",
    width: 72,
    render: (row) =>
      h(NAvatar, { round: true, size: 36, src: row.avatarUrl || undefined }),
  },
  {
    title: "GitHub 用户",
    key: "login",
    width: 180,
    render: (row) =>
      row.profileUrl
        ? h(
            "a",
            {
              href: row.profileUrl,
              target: "_blank",
              rel: "noopener noreferrer",
            },
            row.login,
          )
        : row.login,
  },
  {
    title: "名称",
    key: "name",
    width: 160,
    ellipsis: { tooltip: true },
    render: (row) => row.name || "-",
  },
  { title: "GitHub ID", key: "githubId", width: 140 },
  {
    title: "邮箱",
    key: "email",
    width: 220,
    ellipsis: { tooltip: true },
    render: (row) => row.email || "-",
  },
  {
    title: "角色",
    key: "role",
    width: 140,
    render: (row) =>
      h(
        NTag,
        { type: roleTagType(row.role), size: "small" },
        { default: () => roleLabels[row.role] },
      ),
  },
  {
    title: "注册时间",
    key: "createdAt",
    width: 180,
    render: (row) => formatTime(row.createdAt),
  },
  {
    title: "最近登录",
    key: "lastLoginAt",
    width: 180,
    render: (row) => formatTime(row.lastLoginAt),
  },
];

const columns = computed<DataTableColumns<PortalUser>>(() => {
  if (!auth.can("users.roles.update")) return baseColumns;
  return [
    ...baseColumns,
    {
      title: "操作",
      key: "actions",
      width: 120,
      fixed: "right",
      render: (row) =>
        h(
          NButton,
          {
            size: "small",
            disabled:
              row.id === auth.user?.id || row.role === "super_administrator",
            onClick: () => openRoleModal(row),
          },
          { default: () => "调整角色" },
        ),
    },
  ];
});

function openRoleModal(user: PortalUser) {
  if (
    user.id === auth.user?.id ||
    user.role === "super_administrator" ||
    !auth.can("users.roles.update")
  ) {
    return;
  }
  editingUser.value = user;
  selectedRole.value = user.role;
  showRoleModal.value = true;
}

function closeRoleModal() {
  if (savingRole.value) return;
  showRoleModal.value = false;
  editingUser.value = null;
  selectedRole.value = null;
}

async function saveRole() {
  const user = editingUser.value;
  const role = selectedRole.value;
  if (!user || !role || role === user.role) return;
  savingRole.value = true;
  try {
    await api(`/api/portal/v1/users/${encodeURIComponent(user.id)}/role`, {
      method: "PATCH",
      body: JSON.stringify({ role }),
    });
    message.success(`${user.login} 已调整为${roleLabels[role]}`);
    showRoleModal.value = false;
    editingUser.value = null;
    selectedRole.value = null;
    await load();
  } catch (error) {
    const labels: Record<string, string> = {
      protected_user_role: "该用户的角色受保护，无法调整",
      invalid_user_role: "目标角色无效",
      user_not_found: "用户不存在或已被删除",
    };
    const code = error instanceof ApiError ? error.message : "";
    message.error(labels[code] || "角色调整失败");
  } finally {
    savingRole.value = false;
  }
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
    const result = await api<UserListResponse>(
      `/api/portal/v1/users?${params}`,
    );
    if (sequence !== loadSequence) return;
    items.value = result.items;
    total.value = result.total;
  } catch (error) {
    if (error instanceof ApiError && error.status === 403)
      message.error("当前账号无权查看用户列表");
    else
      message.error(
        error instanceof Error ? error.message : "用户列表加载失败",
      );
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
