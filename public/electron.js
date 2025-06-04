const { app, BrowserWindow, Menu, dialog, ipcMain } = require("electron")
const path = require("path")
const isDev = require("electron-is-dev")

// Disable GPU acceleration to fix rendering issues
app.disableHardwareAcceleration()

// Suppress Chromium GPU process errors
app.commandLine.appendSwitch("disable-gpu")
app.commandLine.appendSwitch("disable-software-rasterizer")

let mainWindow

function createWindow() {
  // Create the browser window
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: true, // Enable context isolation for security
      preload: path.join(__dirname, "preload.js"),
    },
    icon: path.join(__dirname, "icon.png"),
    title: "Mini TFD Control",
    show: false,
    backgroundColor: "#111827",
  })

  // Load the app
  const startUrl = isDev ? "http://localhost:3000" : `file://${path.join(app.getAppPath(), "out", "index.html")}`

  mainWindow.loadURL(startUrl)

  // Show window when ready
  mainWindow.once("ready-to-show", () => {
    mainWindow.show()
  })

  // Open DevTools in development
  if (isDev) {
    mainWindow.webContents.openDevTools()
  }

  // Handle window closed
  mainWindow.on("closed", () => {
    mainWindow = null
  })

  // Create application menu
  const template = [
    {
      label: "File",
      submenu: [
        {
          label: "New Configuration",
          accelerator: "CmdOrCtrl+N",
          click: () => {
            mainWindow.webContents.send("reset-config")
          },
        },
        {
          label: "Save Configuration",
          accelerator: "CmdOrCtrl+S",
          click: async () => {
            const result = await dialog.showSaveDialog(mainWindow, {
              title: "Save Haptic Configuration",
              defaultPath: "haptic-config.json",
              filters: [{ name: "JSON Files", extensions: ["json"] }],
            })
            if (!result.canceled) {
              mainWindow.webContents.send("save-config", result.filePath)
            }
          },
        },
        {
          label: "Load Configuration",
          accelerator: "CmdOrCtrl+O",
          click: async () => {
            const result = await dialog.showOpenDialog(mainWindow, {
              title: "Load Haptic Configuration",
              filters: [{ name: "JSON Files", extensions: ["json"] }],
              properties: ["openFile"],
            })
            if (!result.canceled && result.filePaths.length > 0) {
              mainWindow.webContents.send("load-config", result.filePaths[0])
            }
          },
        },
        { type: "separator" },
        {
          label: "Exit",
          accelerator: process.platform === "darwin" ? "Cmd+Q" : "Ctrl+Q",
          click: () => {
            app.quit()
          },
        },
      ],
    },
    {
      label: "Device",
      submenu: [
        {
          label: "Scan Ports",
          accelerator: "CmdOrCtrl+R",
          click: () => {
            mainWindow.webContents.send("scan-ports")
          },
        },
        {
          label: "Connect",
          accelerator: "CmdOrCtrl+Shift+C",
          click: () => {
            mainWindow.webContents.send("connect-device")
          },
        },
        {
          label: "Disconnect",
          accelerator: "CmdOrCtrl+D",
          click: () => {
            mainWindow.webContents.send("disconnect-device")
          },
        },
        { type: "separator" },
        {
          label: "Reset Device",
          accelerator: "CmdOrCtrl+Shift+R",
          click: () => {
            mainWindow.webContents.send("reset-device")
          },
        },
        {
          label: "Calibrate Device",
          accelerator: "CmdOrCtrl+Shift+A",
          click: () => {
            mainWindow.webContents.send("calibrate-device")
          },
        },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    {
      label: "Window",
      submenu: [{ role: "minimize" }, { role: "close" }],
    },
    {
      label: "Help",
      submenu: [
        {
          label: "About Haptic Knob Control",
          click: () => {
            dialog.showMessageBox(mainWindow, {
              type: "info",
              title: "About",
              message: "Haptic Knob Control",
              detail: "Version 0.1.0\nA desktop application for controlling haptic knob devices.",
              buttons: ["OK"],
            })
          },
        },
      ],
    },
  ]

  // macOS specific menu adjustments
  if (process.platform === "darwin") {
    template.unshift({
      label: app.getName(),
      submenu: [
        { role: "about" },
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    })

    // Window menu
    template[4].submenu = [
      { role: "close" },
      { role: "minimize" },
      { role: "zoom" },
      { type: "separator" },
      { role: "front" },
    ]
  }

  const menu = Menu.buildFromTemplate(template)
  Menu.setApplicationMenu(menu)
}

// App event handlers
app.whenReady().then(() => {
  createWindow()

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit()
  }
})

// IPC handlers for serial communication
ipcMain.handle("serial-list-ports", async () => {
  try {
    // For testing, return mock ports if serialport module is not available
    try {
      const { SerialPort } = require("serialport")
      const ports = await SerialPort.list()
      console.log("Available ports:", ports)
      return ports.map(port => ({
        path: port.path,
        manufacturer: port.manufacturer,
        friendlyName: port.friendlyName,
        serialNumber: port.serialNumber,
        pnpId: port.pnpId,
        locationId: port.locationId,
        productId: port.productId,
        vendorId: port.vendorId,
      }))
    } catch (err) {
      console.warn("SerialPort module not available, using mock ports:", err)
      return [
        { path: "COM1", manufacturer: "Mock Device", friendlyName: "Mock Device (COM1)" },
        { path: "COM2", manufacturer: "Haptic Controller", friendlyName: "Haptic Controller (COM2)" },
        { path: "COM3", friendlyName: "COM3" },
      ]
    }
  } catch (error) {
    console.error("Failed to list serial ports:", error)
    return []
  }
})

ipcMain.handle("serial-connect", async (event, portPath, baudRate) => {
  try {
    console.log(`Connecting to ${portPath} at ${baudRate} baud...`)

    try {
      const { SerialPort } = require("serialport")
      const { ReadlineParser } = require("@serialport/parser-readline")

      // Close existing connection if any
      if (global.serialPort && global.serialPort.isOpen) {
        await new Promise((resolve) => {
          global.serialPort.close(() => resolve())
        })
      }

      // Create new serial port connection
      global.serialPort = new SerialPort({
        path: portPath,
        baudRate: Number.parseInt(baudRate),
        dataBits: 8,
        parity: "none",
        stopBits: 1,
        flowControl: false,
        autoOpen: false,
      })

      // Create parser for line-based communication
      global.serialParser = global.serialPort.pipe(new ReadlineParser({ delimiter: "\n" }))

      // Set up event handlers
      global.serialPort.on("error", (error) => {
        console.error("Serial port error:", error)
        mainWindow.webContents.send("serial-error", error.message)
      })

      global.serialPort.on("close", () => {
        console.log("Serial port closed")
        mainWindow.webContents.send("serial-disconnected")
      })

      global.serialParser.on("data", (data) => {
        const trimmedData = data.trim()
        console.log("Received:", trimmedData)
        mainWindow.webContents.send("serial-data", trimmedData)
      })

      // Open the port
      await new Promise((resolve, reject) => {
        global.serialPort.open((error) => {
          if (error) {
            reject(error)
          } else {
            resolve()
          }
        })
      })

      console.log("Serial port connected successfully")
      return { success: true }
    } catch (err) {
      console.warn("SerialPort module not available, using mock connection:", err)
      // Mock successful connection for testing
      return { success: true }
    }
  } catch (error) {
    console.error("Failed to connect to serial port:", error)
    return { success: false, error: error.message }
  }
})

ipcMain.handle("serial-disconnect", async () => {
  try {
    console.log("Disconnecting from serial port...")

    if (global.serialPort && global.serialPort.isOpen) {
      await new Promise((resolve) => {
        global.serialPort.close((error) => {
          if (error) {
            console.error("Error closing port:", error)
          }
          global.serialPort = null
          global.serialParser = null
          resolve()
        })
      })
    }

    console.log("Serial port disconnected")
    return { success: true }
  } catch (error) {
    console.error("Failed to disconnect:", error)
    return { success: false, error: error.message }
  }
})

ipcMain.handle("serial-write", async (event, data) => {
  try {
    console.log("Writing to serial port:", data.trim())

    if (global.serialPort && global.serialPort.isOpen) {
      await new Promise((resolve, reject) => {
        global.serialPort.write(data, (error) => {
          if (error) {
            reject(error)
          } else {
            global.serialPort.drain(resolve)
          }
        })
      })
    } else {
      // Mock successful write for testing
      console.log("Mock write (no actual serial port)")
    }

    return { success: true }
  } catch (error) {
    console.error("Failed to write to serial port:", error)
    return { success: false, error: error.message }
  }
})

ipcMain.handle("serial-is-connected", () => {
  return global.serialPort && global.serialPort.isOpen
})
