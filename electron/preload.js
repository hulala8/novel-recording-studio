// ============================================================
// Electron preload script — safe bridge to Node.js APIs
// ============================================================

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  // Get the path to the config directory (~/.novel-studio/)
  getConfigPath: () => ipcRenderer.invoke("get-config-path"),

  // Open the config folder in Finder
  openConfigFolder: () => ipcRenderer.invoke("open-config-folder"),

  // Get the current env status (which API keys are configured)
  getEnvStatus: () => ipcRenderer.invoke("get-env-status"),

  // Check if running inside Electron (for conditional features)
  isElectron: true,
});
