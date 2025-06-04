// Serial communication utilities with Electron integration
import { electronSerial } from "./electron-serial"

export interface SerialCommand {
  command: string
  parameters?: Record<string, any>
}

export interface HapticConfig {
  mode: string
  angle: number
  torque?: number
  stiffness?: number
  targetAngle?: number
  detentSpacing?: number
  detentWidth?: number
  endstopMin?: number
  endstopMax?: number
}

export interface SerialPortInfo {
  path: string
  manufacturer?: string
  serialNumber?: string
  pnpId?: string
  locationId?: string
  productId?: string
  vendorId?: string
}

export class HapticSerialInterface {
  private responseCallbacks: Map<string, (response: string) => void> = new Map()
  private onDataCallback: ((data: string) => void) | null = null
  private onErrorCallback: ((error: Error) => void) | null = null
  private onDisconnectCallback: (() => void) | null = null

  constructor() {
    // Set up event handlers for Electron
    if (typeof window !== "undefined" && window.electronAPI) {
      electronSerial.onData((data: string) => {
        console.log("Received:", data)

        if (this.onDataCallback) {
          this.onDataCallback(data)
        }

        // Handle response callbacks
        this.responseCallbacks.forEach((callback, id) => {
          callback(data)
          this.responseCallbacks.delete(id)
        })
      })

      electronSerial.onError((error: Error) => {
        if (this.onErrorCallback) {
          this.onErrorCallback(error)
        }
      })

      electronSerial.onDisconnect(() => {
        if (this.onDisconnectCallback) {
          this.onDisconnectCallback()
        }
      })
    }
  }

  // Get available serial ports
  static async getAvailablePorts(): Promise<SerialPortInfo[]> {
    try {
      if (typeof window !== "undefined" && window.electronAPI) {
        return await electronSerial.getAvailablePorts()
      } else {
        console.warn("Serial port listing is only available in Electron environment")
        return []
      }
    } catch (error) {
      console.error("Failed to list serial ports:", error)
      return []
    }
  }

  async connect(portPath: string, baudRate = 115200): Promise<boolean> {
    try {
      if (typeof window !== "undefined" && window.electronAPI) {
        await electronSerial.connect(portPath, baudRate)
        return true
      } else {
        console.error("Serial connection is only available in Electron environment")
        return false
      }
    } catch (error) {
      console.error("Failed to connect:", error)
      return false
    }
  }

  async disconnect(): Promise<void> {
    try {
      if (typeof window !== "undefined" && window.electronAPI) {
        await electronSerial.disconnect()
      }
      this.responseCallbacks.clear()
    } catch (error) {
      console.error("Failed to disconnect:", error)
    }
  }

  async isConnected(): Promise<boolean> {
    try {
      if (typeof window !== "undefined" && window.electronAPI) {
        return await electronSerial.isPortConnected()
      }
      return false
    } catch (error) {
      console.error("Failed to check connection status:", error)
      return false
    }
  }

  async sendCommand(command: SerialCommand): Promise<void> {
    const commandString = this.formatCommand(command)
    console.log("Sending command:", commandString)

    try {
      if (typeof window !== "undefined" && window.electronAPI) {
        await electronSerial.write(commandString)
      } else {
        throw new Error("Serial communication is only available in Electron environment")
      }
    } catch (error) {
      console.error("Failed to send command:", error)
      throw error
    }
  }

  private formatCommand(command: SerialCommand): string {
    // Customize this method to match your haptic device's protocol
    switch (command.command) {
      case "SET_MODE":
        return `set ${command.parameters?.mode}`

      case "SET_ANGLE":
        return `ANGLE:${command.parameters?.angle.toFixed(2)}`

      case "SET_TORQUE":
        return `set constant:${command.parameters?.torque.toFixed(3)}`

      case "SET_DETENTS":
        return `DETENTS:${command.parameters?.spacing},${command.parameters?.width}`

      case "SET_ENDSTOPS":
        return `set endstops:${command.parameters?.min},${command.parameters?.max}`

      case "SET_PROPORTIONAL":
        return `set proportional:${command.parameters?.kp.toFixed(3)},${command.parameters?.target.toFixed(2)}`

      case "GET_STATUS":
        return "STATUS?"

      case "get angle":
        return "ANGLE?"

      case "RESET":
        return "set zero"

      case "CALIBRATE":
        return "set zero"

      default:
        return command.command
    }
  }

  async sendCommandWithResponse(command: SerialCommand, timeoutMs = 1000): Promise<string> {
    const responseId = Math.random().toString(36).substr(2, 9)

    return new Promise(async (resolve, reject) => {
      // Set up timeout
      const timeout = setTimeout(() => {
        this.responseCallbacks.delete(responseId)
        reject(new Error("Command timeout"))
      }, timeoutMs)

      // Set up response callback
      this.responseCallbacks.set(responseId, (response: string) => {
        clearTimeout(timeout)
        resolve(response)
      })

      // Send the command
      try {
        await this.sendCommand(command)
      } catch (error) {
        clearTimeout(timeout)
        this.responseCallbacks.delete(responseId)
        reject(error)
      }
    })
  }

  // Event handlers
  onData(callback: (data: string) => void): void {
    this.onDataCallback = callback
  }

  onError(callback: (error: Error) => void): void {
    this.onErrorCallback = callback
  }

  onDisconnect(callback: () => void): void {
    this.onDisconnectCallback = callback
  }

  // Haptic-specific command methods
  async setHapticMode(config: HapticConfig): Promise<void> {
    await this.sendCommand({
      command: "SET_MODE",
      parameters: { mode: config.mode },
    })

    // Send mode-specific parameters
    switch (config.mode) {
      case "soft-detents":
      case "medium-detents":
      case "rough-detents":
        if (config.detentSpacing && config.detentWidth) {
          await this.sendCommand({
            command: "SET_DETENTS",
            parameters: {
              spacing: config.detentSpacing,
              width: config.detentWidth,
            },
          })
        }
        break

      case "increased-torque":
        if (config.torque !== undefined) {
          await this.sendCommand({
            command: "SET_TORQUE",
            parameters: { torque: config.torque },
          })
        }
        break

      case "endstops":
        if (config.endstopMin !== undefined && config.endstopMax !== undefined) {
          await this.sendCommand({
            command: "SET_ENDSTOPS",
            parameters: {
              min: config.endstopMin,
              max: config.endstopMax,
            },
          })
        }
        break

      case "proportional-control":
        if (config.stiffness !== undefined && config.targetAngle !== undefined) {
          await this.sendCommand({
            command: "SET_PROPORTIONAL",
            parameters: {
              kp: config.stiffness,
              target: config.targetAngle,
            },
          })
        }
        break
    }
  }

  async setAngle(angle: number): Promise<void> {
    await this.sendCommand({
      command: "SET_ANGLE",
      parameters: { angle },
    })
  }

  async getStatus(): Promise<any> {
    try {
      const response = await this.sendCommandWithResponse({ command: "GET_STATUS" }, 2000)

      try {
        return JSON.parse(response)
      } catch {
        // If not JSON, return as raw response
        return { raw: response, timestamp: Date.now() }
      }
    } catch (error) {
      console.error("Failed to get status:", error)
      return null
    }
  }

  async getCurrentAngle(): Promise<number | null> {
    try {
      const response = await this.sendCommandWithResponse({ command: "get angle" }, 1000)
      const angle = Number.parseFloat(response)
      return isNaN(angle) ? null : angle
    } catch (error) {
      console.error("Failed to get current angle:", error)
      return null
    }
  }

  async reset(): Promise<void> {
    await this.sendCommand({ command: "set zero" })
  }

  async calibrate(): Promise<void> {
    await this.sendCommand({ command: "set zero" })
  }
}

// Singleton instance
export const hapticSerial = new HapticSerialInterface()
