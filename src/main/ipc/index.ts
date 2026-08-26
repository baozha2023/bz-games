import { registerGameIpc } from "./game.ipc";
import { registerMarketIpc } from "./market.ipc";
import { registerRoomIpc } from "./room.ipc";
import { registerSystemIpc } from "./system.ipc";
import { registerStorageIpc } from "./storage.ipc";
import { registerStatisticsIpc } from "./statistics.ipc";
import { registerLogIpc } from "./log.ipc";
import { registerMigrationIpc } from "./migration.ipc";

export function registerAllIpc() {
  registerLogIpc();
  registerGameIpc();
  registerMarketIpc();
  registerRoomIpc();
  registerSystemIpc();
  registerStorageIpc();
  registerStatisticsIpc();
  registerMigrationIpc();
}
