import { registerSW } from "virtual:pwa-register";

/** Update the active service worker before a remote-update reload. */
export const updateServiceWorker = registerSW({ immediate: true });
