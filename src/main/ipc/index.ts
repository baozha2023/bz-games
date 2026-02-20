import { registerGameIpc } from './game.ipc';
import { registerRoomIpc } from './room.ipc';
import { registerSystemIpc } from './system.ipc';

export function registerAllIpc() {
  registerGameIpc();
  registerRoomIpc();
  registerSystemIpc();
}
