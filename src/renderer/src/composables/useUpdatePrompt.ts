import { ref, shallowRef } from "vue";
import type { UpdateState } from "../../../shared/types";

const visible = ref(false);
const updateState = shallowRef<UpdateState | null>(null);

export function showUpdatePrompt(state: UpdateState): boolean {
  if (state.status !== "available" || !state.latestVersion) return false;
  if (visible.value) return false;

  updateState.value = state;
  visible.value = true;
  return true;
}

export function hideUpdatePrompt() {
  visible.value = false;
  updateState.value = null;
}

export function useUpdatePrompt() {
  return {
    visible,
    updateState,
    showUpdatePrompt,
    hideUpdatePrompt,
  };
}
