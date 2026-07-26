import { roomClient } from "./RoomClient";
import { roomServer } from "./RoomServer";

export function findMatchingRoom(gameId: string, gameVersion: string) {
  return [roomServer.room, roomClient.room].find(
    (room) =>
      room?.gameId === gameId && room.gameVersion === gameVersion,
  );
}
