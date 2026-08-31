import { openExternal } from "./browser";

/** Synchronous native check — needed inside click handlers before preventDefault. */
export const isNativeSync = (): boolean => {
  try {
    const cap = (globalThis as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
    return typeof cap?.isNativePlatform === "function" ? cap.isNativePlatform() : false;
  } catch {
    return false;
  }
};

/**
 * Social handles (Telegram, YouTube) must never open in the embedded WebView:
 * their login/app-handoff flows break there. On native we force the system
 * browser (Android Custom Tabs / iOS SafariVC), which honours verified app
 * links and hands off to the Telegram/YouTube app when installed.
 *
 * On web this is a no-op — the anchor's own target="_blank" handles it.
 */
export const openSocialLink = async (url: string): Promise<void> => {
  let isNative = false;
  try {
    const { Capacitor } = await import(/* @vite-ignore */ "@capacitor/core");
    isNative = Capacitor.isNativePlatform();
  } catch {
    isNative = false;
  }
  if (!isNative) return;
  await openExternal(url, { preferWebView: false });
};

/** True when running inside the native shell (used to suppress default anchor nav). */
export const isNativeShell = async (): Promise<boolean> => {
  try {
    const { Capacitor } = await import(/* @vite-ignore */ "@capacitor/core");
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
};
