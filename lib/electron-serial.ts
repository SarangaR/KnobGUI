// Electron-specific serial communication wrapper
export class ElectronSerialInterface {
    private isConnected = false
    private onDataCallback: ((data: string) => void) | null = null
    private onErrorCallback: ((error: Error) => void) | null = null
    private onDisconnectCallback: (() => void) | null = null
  
    constructor() {
      // Set up event listeners if in Electron environment
      if (typeof window !== "undefined" && window.electronAPI) {
        window.electronAPI.onSerialData((event: any, data: string) => {
          if (this.onDataCallback) {
            this.onDataCallback(data)
          }
        })
  
        window.electronAPI.onSerialError((event: any, error: string) => {
          if (this.onErrorCallback) {
            this.onErrorCallback(new Error(error))
          }
        })
  
        window.electronAPI.onSerialDisconnected(() => {
          this.isConnected = false
          if (this.onDisconnectCallback) {
            this.onDisconnectCallback()
          }
        })
      }
    }
  
    async getAvailablePorts() {
      if (!window.electronAPI) {
        return []
      }
  
      try {
        const ports = await window.electronAPI.serialListPorts()
        return ports.map((port: any) => ({
          path: port.path,
          manufacturer: port.manufacturer,
          serialNumber: port.serialNumber,
          pnpId: port.pnpId,
          locationId: port.locationId,
          productId: port.productId,
          vendorId: port.vendorId,
        }))
      } catch (error) {
        console.error("Failed to list ports:", error)
        return []
      }
    }
  
    async connect(portPath: string, baudRate = 115200) {
      if (!window.electronAPI) {
        throw new Error("Electron API not available")
      }
  
      try {
        const result = await window.electronAPI.serialConnect(portPath, baudRate)
        if (result.success) {
          this.isConnected = true
          return true
        } else {
          throw new Error(result.error)
        }
      } catch (error) {
        console.error("Failed to connect:", error)
        throw error
      }
    }
  
    async disconnect() {
      if (!window.electronAPI) {
        return
      }
  
      try {
        const result = await window.electronAPI.serialDisconnect()
        if (result.success) {
          this.isConnected = false
        } else {
          throw new Error(result.error)
        }
      } catch (error) {
        console.error("Failed to disconnect:", error)
        throw error
      }
    }
  
    async write(data: string) {
      if (!window.electronAPI) {
        throw new Error("Electron API not available")
      }
  
      if (!this.isConnected) {
        throw new Error("Not connected to serial port")
      }
  
      try {
        const result = await window.electronAPI.serialWrite(data)
        if (!result.success) {
          throw new Error(result.error)
        }
      } catch (error) {
        console.error("Failed to write:", error)
        throw error
      }
    }
  
    async isPortConnected() {
      if (!window.electronAPI) {
        return false
      }
  
      try {
        return await window.electronAPI.serialIsConnected()
      } catch (error) {
        console.error("Failed to check connection status:", error)
        return false
      }
    }
  
    onData(callback: (data: string) => void) {
      this.onDataCallback = callback
    }
  
    onError(callback: (error: Error) => void) {
      this.onErrorCallback = callback
    }
  
    onDisconnect(callback: () => void) {
      this.onDisconnectCallback = callback
    }
  }
  
  // Export singleton instance
  export const electronSerial = new ElectronSerialInterface()
  