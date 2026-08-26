import { ref } from "vue";

const visible = ref(false);

export function showMigrationNotice(): void {
  visible.value = true;
}

export function hideMigrationNotice(): void {
  visible.value = false;
}

export function useMigrationNotice() {
  return { visible, showMigrationNotice, hideMigrationNotice };
}
