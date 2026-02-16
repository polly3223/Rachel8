/** Shared process state flags */
let _shuttingDown = false;

export function isShuttingDown(): boolean {
  return _shuttingDown;
}

export function setShuttingDown(): void {
  _shuttingDown = true;
}
