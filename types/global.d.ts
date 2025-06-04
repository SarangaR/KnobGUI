interface Window {
    electron?: any
    electronAPI?: {
      // Serial port methods
      serialListPorts: () => Promise<any[]>
      serialConnect: (portPath: string, baudRate: number) => Promise<{ success: boolean; error?: string }>
      serialDisconnect: () => Promise<{ success: boolean; error?: string }>
      serialWrite: (data: string) => Promise<{ success: boolean; error?: string }>
      serialIsConnected: () => Promise<boolean>
  
      // Serial port event listeners
      onSerialData: (callback: (event: any, data: string) => void) => void
      onSerialError: (callback: (event: any, error: string) => void) => void
      onSerialDisconnected: (callback: () => void) => void
  
      // Remove listeners
      removeAllListeners: (channel: string) => void
  
      // App methods
      getAppPath: () => string
  
      // Menu event listeners
      onResetConfig: (callback: () => void) => void
      onSaveConfig: (callback: (event: any, filePath: string) => void) => void
      onLoadConfig: (callback: (event: any, filePath: string) => void) => void
      onScanPorts: (callback: () => void) => void
      onConnectDevice: (callback: () => void) => void
      onDisconnectDevice: (callback: () => void) => void
      onResetDevice: (callback: () => void) => void
      onCalibrateDevice: (callback: () => void) => void
    }
  }
  