// ============================================================
// Electron main process for Novel Recording Studio
// ============================================================

const { app, BrowserWindow, ipcMain, dialog, shell, session } = require("electron");
const path = require("path");
const fs = require("fs");
const http = require("http");
const os = require("os");

// -------- Configuration --------

const NEXT_PORT = parseInt(process.env.NEXT_PORT || "3000", 10);
const CONFIG_DIR = path.join(os.homedir(), ".novel-studio");
const CONFIG_FILE = path.join(CONFIG_DIR, ".env");

let mainWindow = null;
let nextApp = null;
let nextServer = null;

// -------- Environment variable loading --------

function parseDotEnv(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const content = fs.readFileSync(filePath, "utf-8");
  const vars = {};
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();
    vars[key] = value;
  }
  return vars;
}

function loadConfig() {
  const userEnv = parseDotEnv(CONFIG_FILE);

  let bundledEnv = {};
  if (process.resourcesPath) {
    bundledEnv = parseDotEnv(path.join(process.resourcesPath, ".env"));
  }

  const merged = { ...bundledEnv, ...userEnv, ...process.env };
  return merged;
}

// -------- Next.js server lifecycle (programmatic API) --------

function startNextServer(envVars) {
  return new Promise(async (resolve, reject) => {
    console.log(`[Electron] Starting Next.js on port ${NEXT_PORT}...`);

    if (!fs.existsSync(CONFIG_DIR)) {
      fs.mkdirSync(CONFIG_DIR, { recursive: true });
    }

    // Apply env vars to process.env so Next.js and API routes see them
    for (const [key, value] of Object.entries(envVars)) {
      if (key && !key.startsWith("npm_") && value) {
        process.env[key] = value;
      }
    }
    process.env.NODE_ENV = "production";
    process.env.PORT = String(NEXT_PORT);

    // The app directory (where .next/ and node_modules/ live)
    // __dirname is inside app.asar when packaged, so .. always goes to the right place
    const appDir = path.join(__dirname, "..");
    console.log(`[Electron] App dir: ${appDir} (packaged: ${app.isPackaged})`);

    try {
      // Use Next.js programmatic API — works inside ASAR because require() + fs reads are allowed
      const Next = require("next");
      nextApp = Next({
        dev: false,
        dir: appDir,
        hostname: "localhost",
        port: NEXT_PORT,
      });

      await nextApp.prepare();
      const requestHandler = nextApp.getRequestHandler();

      nextServer = http.createServer((req, res) => {
        requestHandler(req, res);
      });

      nextServer.listen(NEXT_PORT, () => {
        console.log(`[Electron] Next.js server is ready on port ${NEXT_PORT}`);
        resolve();
      });

      nextServer.on("error", (err) => {
        console.error(`[Electron] Next.js server error:`, err);
        reject(err);
      });
    } catch (err) {
      console.error(`[Electron] Failed to start Next.js:`, err);
      reject(err);
    }
  });
}

function stopNextServer() {
  if (nextServer) {
    console.log("[Electron] Stopping Next.js server...");
    nextServer.close();
    nextServer = null;
    nextApp = null;
  }
}

// -------- Permission handling (microphone etc.) --------

function setupPermissions() {
  session.defaultSession.setPermissionRequestHandler(
    (webContents, permission, callback, details) => {
      console.log(`[Electron] Permission requested: ${permission}`, details);

      const allowedPermissions = [
        "media",
        "mediaKeySystem",
      ];

      if (allowedPermissions.includes(permission)) {
        if (permission === "media") {
          if (details.mediaTypes?.includes("audio")) {
            console.log("[Electron] Granting microphone permission");
            callback(true);
            return;
          }
          if (details.mediaTypes?.includes("video")) {
            console.log("[Electron] Denying camera permission");
            callback(false);
            return;
          }
        }
        callback(true);
        return;
      }

      callback(false);
    }
  );

  session.defaultSession.setDevicePermissionHandler((details) => {
    if (details.deviceType === "media" && details.origin) {
      console.log("[Electron] Granting media device access");
      return true;
    }
    return false;
  });
}

// -------- Window management --------

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: "小说录音工作室",
    backgroundColor: "#09090b",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "preload.js"),
    },
  });

  mainWindow.loadURL(`http://localhost:${NEXT_PORT}`);

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

// -------- IPC handlers --------

ipcMain.handle("get-config-path", () => {
  return CONFIG_DIR;
});

ipcMain.handle("open-config-folder", () => {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
  shell.openPath(CONFIG_DIR);
});

ipcMain.handle("get-env-status", () => {
  const env = loadConfig();
  return {
    deepseekConfigured: !!env.DEEPSEEK_API_KEY,
    configPath: CONFIG_FILE,
    configDirExists: fs.existsSync(CONFIG_DIR),
    configFileExists: fs.existsSync(CONFIG_FILE),
  };
});

// -------- App lifecycle --------

app.whenReady().then(async () => {
  try {
    setupPermissions();
    const envVars = loadConfig();
    await startNextServer(envVars);
    createWindow();
  } catch (err) {
    console.error("[Electron] Startup failed:", err);
    dialog.showErrorBox(
      "启动失败",
      `无法启动应用服务器：\n${err.message}\n\n请检查端口 ${NEXT_PORT} 是否被占用。`
    );
    app.quit();
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    stopNextServer();
    app.quit();
  }
});

app.on("before-quit", () => {
  stopNextServer();
});
