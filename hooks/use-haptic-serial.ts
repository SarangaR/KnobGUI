"use client"

import { useState, useCallback, useEffect, useRef } from "react"

// Check if we're in a browser environment
const isBrowser = typeof window !== "undefined"

export interface SerialPortInfo {
  path: string
  manufacturer?: string
  serialNumber?: string
  pnpId?: string
  locationId?: string
  productId?: string
  vendorId?: string
}

export interface HapticConfig {
  mode: string
  angle: number
  torque?: number
  stiffness?: number
  targetAngle?: number
}

export function useHapticSerial() {
  const [isConnected, setIsConnected] = useState(false)
  const [isConnecting, setIsConnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastResponse, setLastResponse] = useState<any>(null)
  const [availablePorts, setAvailablePorts] = useState<SerialPortInfo[]>([])
  const [isScanning, setIsScanning] = useState(false)
  const reconnectTimeoutRef = useRef<any>()

  // Check if we're in Electron environment
  const isElectron = isBrowser && window.electronAPI

  // Scan for available ports
  const scanPorts = useCallback(async () => {
    if (!isElectron) {
      setError("Serial port scanning is only available in desktop app")
      return
    }

    setIsScanning(true)
    setError(null)

    try {
      const ports = await window.electronAPI.serialListPorts()
      setAvailablePorts(
        ports.map((port: any) => ({
          path: port.path,
          manufacturer: port.manufacturer,
          serialNumber: port.serialNumber,
          pnpId: port.pnpId,
          locationId: port.locationId,
          productId: port.productId,
          vendorId: port.vendorId,
        })),
      )
      console.log("Found ports:", ports)
    } catch (err) {
      console.error("Failed to scan ports:", err)
      setError(err instanceof Error ? err.message : "Failed to scan ports")
    } finally {
      setIsScanning(false)
    }
  }, [isElectron])

  // Connect to serial port
  const connect = useCallback(
    async (portPath: string, baudRate = 115200) => {
      if (!isElectron) {
        setError("Serial connection is only available in desktop app")
        return false
      }

      setIsConnecting(true)
      setError(null)

      try {
        console.log(`Connecting to ${portPath} at ${baudRate} baud...`)
        const result = await window.electronAPI.serialConnect(portPath, baudRate)

        if (result.success) {
          setIsConnected(true)
          setLastResponse({
            status: "connected",
            port: portPath,
            baudRate,
            timestamp: new Date().toISOString(),
          })
          console.log("Connected successfully")
          return true
        } else {
          throw new Error(result.error || "Connection failed")
        }
      } catch (err) {
        console.error("Connection failed:", err)
        setError(err instanceof Error ? err.message : "Connection failed")
        setIsConnected(false)
        return false
      } finally {
        setIsConnecting(false)
      }
    },
    [isElectron],
  )

  // Disconnect from serial port
  const disconnect = useCallback(async () => {
    if (!isElectron) return

    try {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current)
      }

      console.log("Disconnecting...")
      const result = await window.electronAPI.serialDisconnect()

      if (result.success) {
        setIsConnected(false)
        setError(null)
        setLastResponse(null)
        console.log("Disconnected successfully")
      } else {
        throw new Error(result.error || "Disconnect failed")
      }
    } catch (err) {
      console.error("Disconnect failed:", err)
      setError(err instanceof Error ? err.message : "Disconnect failed")
    }
  }, [isElectron])

  // Send haptic configuration
  const sendHapticConfig = useCallback(
    async (config: HapticConfig) => {
      if (!isConnected || !isElectron) {
        setError("Not connected to device")
        return false
      }

      try {
        // Format the command based on your device's protocol
        const command = formatHapticCommand(config)
        console.log("Sending haptic config:", command)

        const result = await window.electronAPI.serialWrite(command)

        if (result.success) {
          setError(null)
          setLastResponse({
            timestamp: new Date().toISOString(),
            command: "haptic_config",
            sent: command,
            config: config,
          })
          return true
        } else {
          throw new Error(result.error || "Failed to send config")
        }
      } catch (err) {
        console.error("Failed to send haptic config:", err)
        setError(err instanceof Error ? err.message : "Failed to send config")
        return false
      }
    },
    [isConnected, isElectron],
  )

  // Set angle
  const setAngle = useCallback(
    async (angle: number) => {
      if (!isConnected || !isElectron) return false

      try {
        const command = `ANGLE:${angle.toFixed(2)}\n`
        console.log("Setting angle:", command.trim())

        const result = await window.electronAPI.serialWrite(command)

        if (result.success) {
          setError(null)
          return true
        } else {
          throw new Error(result.error || "Failed to set angle")
        }
      } catch (err) {
        console.error("Failed to set angle:", err)
        setError(err instanceof Error ? err.message : "Failed to set angle")
        return false
      }
    },
    [isConnected, isElectron],
  )

  // Get device status
  const getStatus = useCallback(async () => {
    if (!isConnected || !isElectron) return null

    try {
      console.log("Getting device status...")
      const result = await window.electronAPI.serialWrite("STATUS?\n")

      if (result.success) {
        setError(null)
        // The response will come through the data event handler
        return true
      } else {
        throw new Error(result.error || "Failed to get status")
      }
    } catch (err) {
      console.error("Failed to get status:", err)
      setError(err instanceof Error ? err.message : "Failed to get status")
      return null
    }
  }, [isConnected, isElectron])

  // Get current angle from device
  const getCurrentAngle = useCallback(async () => {
    if (!isConnected || !isElectron) return null

    try {
      console.log("Getting current angle...")
      const result = await window.electronAPI.serialWrite("ANGLE?\n")

      if (result.success) {
        setError(null)
        // The response will come through the data event handler
        return true
      } else {
        throw new Error(result.error || "Failed to get angle")
      }
    } catch (err) {
      console.error("Failed to get angle:", err)
      setError(err instanceof Error ? err.message : "Failed to get angle")
      return null
    }
  }, [isConnected, isElectron])

  // Reset device
  const reset = useCallback(async () => {
    if (!isConnected || !isElectron) return false

    try {
      console.log("Resetting device...")
      const result = await window.electronAPI.serialWrite("RESET\n")

      if (result.success) {
        setError(null)
        setLastResponse({
          status: "reset_sent",
          timestamp: new Date().toISOString(),
        })
        return true
      } else {
        throw new Error(result.error || "Failed to reset device")
      }
    } catch (err) {
      console.error("Failed to reset device:", err)
      setError(err instanceof Error ? err.message : "Failed to reset device")
      return false
    }
  }, [isConnected, isElectron])

  // Calibrate device
  const calibrate = useCallback(async () => {
    if (!isConnected || !isElectron) return false

    try {
      console.log("Calibrating device...")
      const result = await window.electronAPI.serialWrite("CALIBRATE\n")

      if (result.success) {
        setError(null)
        setLastResponse({
          status: "calibration_sent",
          timestamp: new Date().toISOString(),
        })
        return true
      } else {
        throw new Error(result.error || "Failed to calibrate device")
      }
    } catch (err) {
      console.error("Failed to calibrate device:", err)
      setError(err instanceof Error ? err.message : "Failed to calibrate device")
      return false
    }
  }, [isConnected, isElectron])

  // Set up event handlers for incoming serial data
  useEffect(() => {
    if (!isElectron) return

    const handleSerialData = (event: any, data: string) => {
      // console.log("Received serial data:", data)
      setLastResponse({
        timestamp: new Date().toISOString(),
        type: "received",
        data: data.trim(),
      })
    }

    const handleSerialError = (event: any, errorMessage: string) => {
      console.error("Serial error:", errorMessage)
      setError(errorMessage)
    }

    const handleSerialDisconnected = () => {
      console.log("Serial disconnected")
      setIsConnected(false)
      setError("Device disconnected")
    }

    // Set up event listeners
    window.electronAPI.onSerialData(handleSerialData)
    window.electronAPI.onSerialError(handleSerialError)
    window.electronAPI.onSerialDisconnected(handleSerialDisconnected)

    // Cleanup function
    return () => {
      if (window.electronAPI.removeAllListeners) {
        window.electronAPI.removeAllListeners("serial-data")
        window.electronAPI.removeAllListeners("serial-error")
        window.electronAPI.removeAllListeners("serial-disconnected")
      }
    }
  }, [isElectron])

  // Auto-scan ports on mount in desktop environment
  useEffect(() => {
    if (isElectron) {
      scanPorts()
    }
  }, [scanPorts, isElectron])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current)
      }
      if (isConnected && isElectron) {
        window.electronAPI.serialDisconnect()
      }
    }
  }, [isConnected, isElectron])

  return {
    // Connection state
    isConnected,
    isConnecting,
    error,
    lastResponse,

    // Port management
    availablePorts,
    isScanning,
    scanPorts,

    // Connection methods
    connect,
    disconnect,

    // Device communication
    sendHapticConfig,
    setAngle,
    getStatus,
    getCurrentAngle,
    reset,
    calibrate,
  }
}

// Helper function to format haptic commands based on your device's protocol
function formatHapticCommand(config: HapticConfig): string {
  // Customize this based on your haptic device's command protocol
  switch (config.mode) {
    case "none":
      return "MODE:NONE\n"
    case "soft-detents":
      return "MODE:DETENTS,SOFT\n"
    case "medium-detents":
      return "MODE:DETENTS,MEDIUM\n"
    case "rough-detents":
      return "MODE:DETENTS,ROUGH\n"
    case "clockwise":
      return "MODE:CLOCKWISE\n"
    case "counterclockwise":
      return "MODE:COUNTERCLOCKWISE\n"
    case "increased-torque":
      return `MODE:TORQUE,${config.torque || 0.5}\n`
    case "lock":
      return "MODE:LOCK\n"
    case "endstops":
      return "MODE:ENDSTOPS\n"
    case "center-detent":
      return "MODE:CENTER_DETENT\n"
    case "proportional-control":
      return `MODE:PROPORTIONAL,${config.stiffness || 0.8},${config.targetAngle || 0}\n`
    default:
      return `MODE:${config.mode.toUpperCase()}\n`
  }
}
