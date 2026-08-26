class MigrationActivityGuard {
  private exportActive = false;

  isExporting(): boolean {
    return this.exportActive;
  }

  tryBeginExport(): boolean {
    if (this.exportActive) return false;
    this.exportActive = true;
    return true;
  }

  endExport(): void {
    this.exportActive = false;
  }
}

export const migrationActivityGuard = new MigrationActivityGuard();
