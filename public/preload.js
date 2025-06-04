// Preload script for Electron
const { contextBridge, ipcRenderer } = require("electron")

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld("electronAPI", {
  // Serial port methods
  serialListPorts: () => ipcRenderer.invoke("serial-list-ports"),
  serialConnect: (portPath, baudRate) => ipcRenderer.invoke("serial-connect", portPath, baudRate),
  serialDisconnect: () => ipcRenderer.invoke("serial-disconnect"),
  serialWrite: (data) => ipcRenderer.invoke("serial-write", data),
  serialIsConnected: () => ipcRenderer.invoke("serial-is-connected"),

  // Serial port event listeners
  onSerialData: (callback) => ipcRenderer.on("serial-data", callback),
  onSerialError: (callback) => ipcRenderer.on("serial-error", callback),
  onSerialDisconnected: (callback) => ipcRenderer.on("serial-disconnected", callback),

  // Remove listeners
  removeAllListeners: (channel) => ipcRenderer.removeAllListeners(channel),

  // App methods
  getAppPath: () => ipcRenderer.sendSync("get-app-path"),

  // Menu event listeners
  onResetConfig: (callback) => ipcRenderer.on("reset-config", callback),
  onSaveConfig: (callback) => ipcRenderer.on("save-config", callback),
  onLoadConfig: (callback) => ipcRenderer.on("load-config", callback),
  onScanPorts: (callback) => ipcRenderer.on("scan-ports", callback),
  onConnectDevice: (callback) => ipcRenderer.on("connect-device", callback),
  onDisconnectDevice: (callback) => ipcRenderer.on("disconnect-device", callback),
  onResetDevice: (callback) => ipcRenderer.on("reset-device", callback),
  onCalibrateDevice: (callback) => ipcRenderer.on("calibrate-device", callback),
})

// Expose electron flag immediately
contextBridge.exposeInMainWorld("electron", {
  isElectron: true,
  platform: process.platform,
  serialport: {
    isAvailable: true,
  },
})

console.log("Electron preload script loaded with real serial communication")
