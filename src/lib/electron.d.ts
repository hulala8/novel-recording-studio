// Type declarations for Electron preload API
// This API is available on window.electronAPI when running inside Electron

interface ElectronAPI {
  getConfigPath: () => Promise<string>;
  openConfigFolder: () => Promise<void>;
  getEnvStatus: () => Promise<EnvStatus>;
  isElectron: boolean;
}

interface EnvStatus {
  deepseekConfigured: boolean;
  configPath: string;
  configDirExists: boolean;
  configFileExists: boolean;
}

interface Window {
  electronAPI?: ElectronAPI;
}
