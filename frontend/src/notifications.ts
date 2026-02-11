function isTauriRuntime(): boolean {
  return Boolean(window.__TAURI__ || window.__TAURI_INTERNALS__);
}

export async function notifyDesktop(title: string, body: string) {
  if (!isTauriRuntime()) return;

  const invoke = (window as any).__TAURI_INTERNALS__?.invoke as
    | ((cmd: string, args?: Record<string, unknown>) => Promise<unknown>)
    | undefined;
  try {
    if (invoke) {
      await invoke("notify_native", { title, body });
      return;
    }
  } catch {
    // Fallback below
  }

  // Best-effort browser fallback (web mode).
  if (typeof Notification !== "undefined") {
    if (Notification.permission === "default") {
      try {
        await Notification.requestPermission();
      } catch {
        return;
      }
    }
    if (Notification.permission === "granted") {
      try {
        new Notification(title, { body });
      } catch {
        // no-op
      }
    }
  }
}
