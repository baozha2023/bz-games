import {registerGameIpc} from "./game.ipc";
import {registerMarketIpc} from "./market.ipc";
import {registerRoomIpc} from "./room.ipc";
import {registerSystemIpc} from "./system.ipc";
import {registerStorageIpc} from "./storage.ipc";
import {registerStatisticsIpc} from "./statistics.ipc";

export function registerAllIpc() {
    registerGameIpc();
    registerMarketIpc();
    registerRoomIpc();
    registerSystemIpc();
    registerStorageIpc();
    registerStatisticsIpc();
}
