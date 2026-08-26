import { computed, ref } from "vue";
import {
  getForumCommand,
  type ForumCommandDefinition,
  type ForumCommandName,
  type ForumCommandStage,
} from "../services/forum-command-registry";

export type ForumPickerStage = "mention" | "commands" | ForumCommandStage;

export function useForumCommandController() {
  const stage = ref<ForumPickerStage>("commands");
  const selectedCommand = ref<ForumCommandName | null>(null);
  const definition = computed(() =>
    selectedCommand.value ? getForumCommand(selectedCommand.value) : null,
  );

  function start(command: ForumCommandDefinition): ForumCommandStage {
    selectedCommand.value = command.name;
    stage.value = command.flow[0];
    return stage.value;
  }

  function restore(
    commandName: ForumCommandName,
    targetStage?: ForumCommandStage,
  ): ForumCommandStage {
    const command = getForumCommand(commandName);
    selectedCommand.value = commandName;
    const next = targetStage || command.flow[0];
    if (!command.flow.includes(next))
      throw new Error("invalid_forum_command_stage");
    stage.value = next;
    return next;
  }

  function advance(): ForumCommandStage | null {
    const command = definition.value;
    if (!command) return null;
    const currentIndex = command.flow.indexOf(stage.value as ForumCommandStage);
    const next = command.flow[currentIndex + 1];
    if (!next) return null;
    stage.value = next;
    return next;
  }

  function retreat(): ForumCommandStage | null {
    const command = definition.value;
    if (!command) {
      stage.value = "commands";
      return null;
    }
    const currentIndex = command.flow.indexOf(stage.value as ForumCommandStage);
    const previous = currentIndex > 0 ? command.flow[currentIndex - 1] : null;
    stage.value = previous || "commands";
    return previous;
  }

  function showCommands(): void {
    stage.value = "commands";
  }

  function showMention(): void {
    selectedCommand.value = null;
    stage.value = "mention";
  }

  function reset(): void {
    selectedCommand.value = null;
    stage.value = "commands";
  }

  return {
    definition,
    selectedCommand,
    stage,
    advance,
    reset,
    restore,
    retreat,
    showCommands,
    showMention,
    start,
  };
}
