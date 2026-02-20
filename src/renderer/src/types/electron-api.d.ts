import type { AppSettings, RoomInfo, RoomEvent, GameRecord } from '../../../shared/types';
import type { GameManifest } from '../../../shared/game-manifest';

declare global {
  interface Window {
    electronAPI: {
      game: {
        load:     () => Promise<{ success: boolean; manifest?: GameManifest; error?: string }>;
        remove:   (id: string) => Promise<void>;
        launch:   (id: string, version?: string) => Promise<void>;
        getAll:   () => Promise<GameManifest[]>;
        getAllRecords: () => Promise<GameRecord[]>;
        getVersions: (id: string) => Promise<string[]>;
        getCover: (id: string, version?: string) => Promise<string | null>; // base64 data URL
        onProcessEvent: (callback: (type: 'start' | 'end', id: string) => void) => () => void;
        onLaunchFailed: (callback: (id: string, reason: string) => void) => () => void;
      };
      room: {
        create:     (gameId: string, version?: string) => Promise<{ port: number }>;
        join:       (gameId: string, address: string, version?: string) => Promise<{ success: boolean; error?: string }>;
        leave:      () => Promise<void>;
        ready:      () => Promise<void>;
        unready:    () => Promise<void>;
        start:      () => Promise<void>;
        setAddress: (address: string) => Promise<void>;
        getState:   () => Promise<RoomInfo | null>;
        sendChat:   (content: string) => Promise<void>;
        onEvent:    (callback: (event: RoomEvent) => void) => () => void;
      };
      settings: {
        get:  () => Promise<AppSettings>;
        save: (settings: AppSettings) => Promise<void>;
        uploadAvatar: () => Promise<string | null>;
      };
    };
  }
}
