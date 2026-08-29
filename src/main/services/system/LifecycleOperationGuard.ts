export type LifecycleOperation = "uninstall" | "update";

export class LifecycleOperationGuard {
  private current: LifecycleOperation | null = null;

  tryBegin(operation: LifecycleOperation): boolean {
    if (this.current) return false;
    this.current = operation;
    return true;
  }

  isActive(operation?: LifecycleOperation): boolean {
    return operation ? this.current === operation : this.current !== null;
  }

  blocksNewActivity(): boolean {
    return this.current !== null;
  }

  end(operation: LifecycleOperation): void {
    if (this.current === operation) this.current = null;
  }
}

export const lifecycleOperationGuard = new LifecycleOperationGuard();
