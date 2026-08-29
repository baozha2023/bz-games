import { ref } from "vue";

const visible = ref(false);

export function showBackupManager(): void {
  visible.value = true;
}

export function hideBackupManager(): void {
  visible.value = false;
}

export function useBackupManager() {
  return { visible, showBackupManager, hideBackupManager };
}
