type GameWindowIdentity = {
  gameId: string;
  version: string;
};

class GameWindowIdentityRegistry {
  private readonly identities = new Map<number, GameWindowIdentity>();

  register(webContentsId: number, identity: GameWindowIdentity): void {
    this.identities.set(webContentsId, identity);
  }

  unregister(webContentsId: number): void {
    this.identities.delete(webContentsId);
  }

  matches(webContentsId: number, gameId: string, version: string): boolean {
    const identity = this.identities.get(webContentsId);
    return identity?.gameId === gameId && identity.version === version;
  }
}

export const gameWindowIdentityRegistry = new GameWindowIdentityRegistry();
