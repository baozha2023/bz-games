import { registerGameIpc } from "./game.ipc";
import { registerMarketIpc } from "./market.ipc";
import { registerRoomIpc } from "./room.ipc";
import { registerSystemIpc } from "./system.ipc";
import { registerStorageIpc } from "./storage.ipc";
import { registerStatisticsIpc } from "./statistics.ipc";
import { registerLogIpc } from "./log.ipc";
import { registerBackupIpc } from "./backup.ipc";
import { registerUpdateIpc } from "./update.ipc";

export function registerAllIpc() {
  registerLogIpc();
  registerGameIpc();
  registerMarketIpc();
  registerRoomIpc();
  registerSystemIpc();
  registerStorageIpc();
  registerStatisticsIpc();
  registerBackupIpc();
  registerUpdateIpc();
}
