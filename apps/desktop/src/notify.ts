import { inTauri } from "./bridge";

let enabled = true;
let asked = false;
export const setNotifications = (on: boolean) => (enabled = on);

/** A desktop notification, only when deck is in the background and notifications are on. */
export async function notify(title: string, body: string) {
  if (!enabled || !inTauri || document.hasFocus()) return;
  try {
    const n = await import("@tauri-apps/plugin-notification");
    let ok = await n.isPermissionGranted();
    if (!ok && !asked) {
      asked = true;
      ok = (await n.requestPermission()) === "granted";
    }
    if (ok) n.sendNotification({ title: title.slice(0, 80), body: body.slice(0, 240) });
  } catch {
    /* notifications unavailable */
  }
}
