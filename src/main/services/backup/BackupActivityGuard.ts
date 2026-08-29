class BackupActivityGuard {
  private active = false;

  isActive(): boolean {
    return this.active;
  }

  tryBegin(): boolean {
    if (this.active) return false;
    this.active = true;
    return true;
  }

  end(): void {
    this.active = false;
  }
}

export const backupActivityGuard = new BackupActivityGuard();
