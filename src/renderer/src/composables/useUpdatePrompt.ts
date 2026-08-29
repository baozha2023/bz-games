import { ref, shallowRef } from "vue";
import type { UpdateState } from "../../../shared/types";

const visible = ref(false);
const state = shallowRef<UpdateState | null>(null);

export function showUpdatePrompt(next: UpdateState): boolean {
  if (next.status !== "available" || !next.latestVersion) return false;
  state.value = next;
  visible.value = true;
  return true;
}

export function hideUpdatePrompt(): void {
  visible.value = false;
}

export function setUpdateState(next: UpdateState): void {
  state.value = next;
  if (next.status === "available" && next.automatic) visible.value = true;
}

export function useUpdatePrompt() {
  return { visible, state, showUpdatePrompt, hideUpdatePrompt, setUpdateState };
}
