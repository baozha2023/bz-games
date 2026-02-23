import { registerGameIpc } from './game.ipc';
import { registerRoomIpc } from './room.ipc';
import { registerSystemIpc } from './system.ipc';
import { registerStorageIpc } from './storage.ipc';

export function registerAllIpc() {
  registerGameIpc();
  registerRoomIpc();
  registerSystemIpc();
  registerStorageIpc();
}
