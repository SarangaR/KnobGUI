"use client"
import { useState, useEffect, useRef } from "react"
import {
  ArrowRight,
  ArrowLeft,
  Lock,
  Wifi,
  WifiOff,
  Settings,
  RotateCw,
  RotateCcw,
  Target,
  Zap,
  RefreshCw,
  TimerResetIcon as Reset,
  ArrowRightCircle,
  ArrowLeftCircle,
} from "lucide-react"
import { ScrollArea } from "@/components/ui/scroll-area"

type HapticMode =
  | "none"
  | "soft-detents"
  | "medium-detents"
  | "rough-detents"
  | "clockwise"
  | "counterclockwise"
  | "increased-torque"
  | "lock"
  | "endstops"
  | "center-detent"
  | "proportional-control"

interface TFDState {
  mode: HapticMode
  currentAngle: number // This is read from the device
  currentVelocity: number // Velocity from device
  torque: number
  stiffness: number
  targetAngle: number
  selectedPort: string
  baudRate: number
  isPolling: boolean
  pollInterval: number
  // Endstop configuration
  endstopTurns: number // Number of turns lock to lock (e.g., 2.5 = 900 degrees)
  endstopMinAngle: number // Calculated min angle
  endstopMaxAngle: number // Calculated max angle
}

interface SerialPortInfo {
  path: string
  manufacturer?: string
  serialNumber?: string
  pnpId?: string
  locationId?: string
  productId?: string
  vendorId?: string
  friendlyName?: string
}

const hapticModes = [
  { id: "none", label: "None", icon: Settings },
  { id: "center-detent", label: "Center Detent", icon: Target },
  { id: "rough-detents", label: "Rough Detents", icon: Target },
  { id: "medium-detents", label: "Medium Detents", icon: Target },
  { id: "soft-detents", label: "Soft Detents", icon: Target },
  { id: "clockwise", label: "Clockwise", icon: ArrowRightCircle },
  { id: "counterclockwise", label: "Counterclockwise", icon: ArrowLeftCircle },
  { id: "increased-torque", label: "Increased Torque", icon: Zap },
  { id: "lock", label: "Lock", icon: Lock },
  { id: "endstops", label: "Endstops", icon: ArrowRight },
  { id: "proportional-control", label: "Proportional Control", icon: Settings },
] as const

const baudRates = [9600, 19200, 38400, 57600, 115200, 230400, 460800, 921600]

// Add type declaration for window.electronAPI
declare global {
  interface Window {
    electronAPI?: {
      serialListPorts: () => Promise<SerialPortInfo[]>;
      serialConnect: (portPath: string, baudRate: number) => Promise<{ success: boolean; error?: string }>;
      serialDisconnect: () => Promise<{ success: boolean; error?: string }>;
      serialWrite: (data: string) => Promise<{ success: boolean; error?: string }>;
      onSerialData: (callback: (event: any, data: string) => void) => void;
      onSerialError: (callback: (event: any, error: string) => void) => void;
      onSerialDisconnected: (callback: () => void) => void;
      onScanPorts: (callback: () => void) => void;
      onConnectDevice: (callback: () => void) => void;
      onDisconnectDevice: (callback: () => void) => void;
      onResetDevice: (callback: () => void) => void;
      onCalibrateDevice: (callback: () => void) => void;
      removeAllListeners?: (event: string) => void;
    };
  }
}

export function MiniTFDControl() {
  // State
  const [state, setState] = useState<TFDState>({
    mode: "none",
    currentAngle: 0,
    currentVelocity: 0,
    torque: 0.2,
    stiffness: 0.8,
    targetAngle: 0,
    selectedPort: "",
    baudRate: 115200,
    isPolling: true,
    pollInterval: 30,
    endstopTurns: 2.5,
    endstopMinAngle: -450,
    endstopMaxAngle: 450,
  })
  const [isConnected, setIsConnected] = useState(false)
  const [isConnecting, setIsConnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastResponse, setLastResponse] = useState<any>(null)
  const [availablePorts, setAvailablePorts] = useState<SerialPortInfo[]>([])
  const [isScanning, setIsScanning] = useState(false)
  const [isElectron, setIsElectron] = useState(false)
  const [lastAngleUpdate, setLastAngleUpdate] = useState<Date | null>(null)
  const [pendingAngleRequest, setPendingAngleRequest] = useState(false)
  const [pendingVelocityRequest, setPendingVelocityRequest] = useState(false)
  const [isDeviceResponding, setIsDeviceResponding] = useState(false)

  // Refs
  const deviceResponseTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null)
  const isPollingActiveRef = useRef(false)
  const lastCommandRef = useRef<'angle' | 'velocity' | null>(null)

  // Check if we're in Electron environment
  useEffect(() => {
    const checkElectron = () => {
      const electronAvailable = typeof window !== "undefined" && (window.electron || window.electronAPI)
      setIsElectron(electronAvailable)
      if (!electronAvailable) {
        setIsDeviceResponding(false)
        setError("Serial communication not available in browser")
      }
    }
    checkElectron()
    const timeout = setTimeout(checkElectron, 100)
    return () => clearTimeout(timeout)
  }, [])

  // Update state helper
  const updateState = (updates: Partial<TFDState>) => {
    setState((prev) => {
      const newState = { ...prev, ...updates }

      // Recalculate endstop angles when turns change
      if (updates.endstopTurns !== undefined) {
        const totalDegrees = updates.endstopTurns * 360
        newState.endstopMinAngle = -totalDegrees / 2
        newState.endstopMaxAngle = totalDegrees / 2
      }

      return newState
    })
  }

  // Don't normalize angle for multi-turn applications - keep the full range
  const clampAngle = (angle: number) => {
    // For endstop mode, clamp to the configured range
    if (state.mode === "endstops") {
      return Math.max(state.endstopMinAngle, Math.min(state.endstopMaxAngle, angle))
    }
    // For other modes, allow full range
    return angle
  }

  // Serial port scanning
  const scanPorts = async () => {
    console.log("Scanning for serial ports...", { isElectron, hasElectronAPI: !!window.electronAPI })
    setIsScanning(true)
    setError(null)

    try {
      if (isElectron && window.electronAPI) {
        console.log("Using Electron API for port scanning")
        const ports = await window.electronAPI.serialListPorts()
        console.log("Found ports:", ports)
        setAvailablePorts(ports)
      } else {
        setAvailablePorts([])
        setError("Serial communication not available in browser")
      }
    } catch (err) {
      console.error("Failed to scan ports:", err)
      setError("Failed to scan for serial ports")
    } finally {
      setIsScanning(false)
    }
  }

  // Connect to serial port
  const connect = async () => {
    if (!state.selectedPort) {
      setError("Please select a port first")
      return
    }

    setIsConnecting(true)
    setError(null)
    setIsDeviceResponding(false) // Start with device not responding
    console.log(`Connecting to ${state.selectedPort} at ${state.baudRate} baud...`)

    try {
      if (isElectron && window.electronAPI) {
        console.log("Using Electron API for connection")
        const result = await window.electronAPI.serialConnect(state.selectedPort, state.baudRate)
        if (result.success) {
          setIsConnected(true)
          setLastResponse({
            status: "connecting",
            port: state.selectedPort,
            baudRate: state.baudRate,
            timestamp: new Date().toISOString(),
          })
          
          // Try to get initial device response
          try {
            const angleResult = await window.electronAPI.serialWrite("get angle\n")
            if (!angleResult.success) {
              throw new Error("Device not responding to commands")
            }
            // Device will be marked as responding when we get data back
          } catch (err) {
            console.error("Device not responding to commands:", err)
            setIsDeviceResponding(false)
            setError("Device not responding to commands - incorrect port?")
            await disconnect()
            return
          }
        } else {
          throw new Error(result.error || "Connection failed")
        }
      } else {
        throw new Error("Serial communication not available in browser")
      }
    } catch (err) {
      console.error("Connection failed:", err)
      setError(err instanceof Error ? err.message : "Connection failed")
      setIsConnected(false)
      setIsDeviceResponding(false)
    } finally {
      setIsConnecting(false)
    }
  }

  // Disconnect from serial port
  const disconnect = async () => {
    console.log("Disconnecting...")
    stopPolling()

    try {
      if (isElectron && window.electronAPI) {
        console.log("Using Electron API for disconnection")
        const result = await window.electronAPI.serialDisconnect()
        if (result.success) {
          setIsConnected(false)
          setIsDeviceResponding(false)
          setError(null)
          setLastResponse(null)
          setLastAngleUpdate(null)
          console.log("Disconnected successfully")
        } else {
          throw new Error(result.error || "Disconnect failed")
        }
      } else {
        setIsConnected(false)
        setIsDeviceResponding(false)
        setLastResponse(null)
        setLastAngleUpdate(null)
      }
    } catch (err) {
      console.error("Disconnect failed:", err)
      setError(err instanceof Error ? err.message : "Disconnect failed")
    }
  }

  // Get current angle from device
  const getCurrentAngle = async (): Promise<number | null> => {
    try {
      if (isElectron && window.electronAPI) {
        setPendingAngleRequest(true)
        const result = await window.electronAPI.serialWrite("get angle\n")
        if (!result.success) {
          setPendingAngleRequest(false)
          setIsDeviceResponding(false)
          setError("Device not responding to angle request")
          throw new Error("Failed to request angle")
        }
        return null // Actual value will be set via serial data handler
      }
      setIsDeviceResponding(false)
      return null
    } catch (err) {
      console.error("Failed to get current angle:", err)
      setPendingAngleRequest(false)
      setIsDeviceResponding(false)
      return null
    }
  }

  // Get current velocity from device
  const getCurrentVelocity = async (): Promise<number | null> => {
    try {
      if (isElectron && window.electronAPI) {
        setPendingVelocityRequest(true)
        const result = await window.electronAPI.serialWrite("get vel\n")
        if (!result.success) {
          setPendingVelocityRequest(false)
          setIsDeviceResponding(false)
          setError("Device not responding to velocity request")
          throw new Error("Failed to request velocity")
        }
        return null // Actual value will be set via serial data handler
      }
      setIsDeviceResponding(false)
      return null
    } catch (err) {
      console.error("Failed to get current velocity:", err)
      setPendingVelocityRequest(false)
      setIsDeviceResponding(false)
      return null
    }
  }

  // Start/stop angle polling
  const startPolling = () => {
    // Clear any existing interval first
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current)
      pollIntervalRef.current = null
    }

    if (!state.isPolling || !isConnected) {
      console.log("Not starting polling - conditions not met:", { isPolling: state.isPolling, isConnected })
      isPollingActiveRef.current = false
      return
    }

    console.log(`Starting polling every ${state.pollInterval}ms`)
    isPollingActiveRef.current = true

    pollIntervalRef.current = setInterval(async () => {
      if (!isPollingActiveRef.current || !isConnected) {
        console.log("Stopping polling - conditions changed")
        if (pollIntervalRef.current) {
          clearInterval(pollIntervalRef.current)
          pollIntervalRef.current = null
        }
        isPollingActiveRef.current = false
        return
      }

      try {
        // Poll angle and velocity in sequence

        // Request Angle first
        lastCommandRef.current = 'angle'; // Indicate we are requesting/expecting angle
        getCurrentAngle();

        // Small delay between requests
        setTimeout(() => {
          if (isPollingActiveRef.current && isConnected) {
             // Request Velocity next
             lastCommandRef.current = 'velocity'; // Indicate we are requesting/expecting velocity
             getCurrentVelocity();
          }
        }, 50);

      } catch (err) {
        console.error("Error during polling:", err)
      }
    }, state.pollInterval)
  }

  const stopPolling = () => {
    console.log("Stopping polling")
    isPollingActiveRef.current = false

    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current)
      pollIntervalRef.current = null
    }
  }

  // Handle connect/disconnect button
  const handleConnect = async () => {
    if (isConnected) {
      await disconnect()
    } else {
      await connect()
    }
  }

  // Send TFD configuration
  const sendTFDConfig = async () => {
    if (!isConnected) {
      setError("Not connected to device")
      return
    }

    try {
      const command = formatTFDCommand(state)
      console.log("Sending TFD config:", command)

      if (isElectron && window.electronAPI) {
        const result = await window.electronAPI.serialWrite(command)
        if (!result.success) {
          throw new Error(result.error || "Failed to send config")
        }
        setError(null)
        setLastResponse({
          timestamp: new Date().toISOString(),
          command: "tfd_config",
          sent: command,
          config: state,
        })
      } else {
        setError("Serial communication not available in browser")
      }
    } catch (err) {
      console.error("Failed to send TFD config:", err)
      setError(err instanceof Error ? err.message : "Failed to send config")
    }
  }

  // Manual angle request
  const requestCurrentAngle = async () => {
    if (!isConnected) {
      setError("Not connected to device")
      return
    }

    const angle = await getCurrentAngle()
    if (angle !== null) {
      const clampedAngle = clampAngle(angle)
      updateState({ currentAngle: clampedAngle })
      setLastAngleUpdate(new Date())
    }
  }

  // Manual velocity request
  const requestCurrentVelocity = async () => {
    if (!isConnected) {
      setError("Not connected to device")
      return
    }

    const velocity = await getCurrentVelocity()
    if (velocity !== null) {
      updateState({ currentVelocity: velocity })
    }
  }

  // Reset device
  const reset = async () => {
    if (!isConnected) {
      setError("Not connected to device")
      return
    }

    try {
      console.log("Resetting device...")

      if (isElectron && window.electronAPI) {
        const result = await window.electronAPI.serialWrite("set zero\n")
        if (!result.success) {
          throw new Error(result.error || "Failed to reset device")
        }
        setLastResponse({ status: "reset_sent", timestamp: new Date().toISOString() })
      } else {
        setError("Serial communication not available in browser")
      }
    } catch (err) {
      console.error("Failed to reset device:", err)
      setError(err instanceof Error ? err.message : "Failed to reset device")
    }
  }

  // Calibrate device
  const calibrate = async () => {
    if (!isConnected) {
      setError("Not connected to device")
      return
    }

    try {
      console.log("Calibrating device...")

      if (isElectron && window.electronAPI) {
        const result = await window.electronAPI.serialWrite("set zero\n")
        if (!result.success) {
          throw new Error(result.error || "Failed to calibrate device")
        }
        setLastResponse({ status: "calibration_sent", timestamp: new Date().toISOString() })
      } else {
        setError("Serial communication not available in browser")
      }
    } catch (err) {
      console.error("Failed to calibrate device:", err)
      setError(err instanceof Error ? err.message : "Failed to calibrate device")
    }
  }

  // Send TFD configuration when mode or parameters change
  useEffect(() => {
    if (isConnected) {
      sendTFDConfig()
    }
  }, [state.mode, state.torque, state.stiffness, state.targetAngle, state.endstopTurns, isConnected])

  // Handle polling changes - this is the ONLY place that manages polling
  useEffect(() => {
    console.log("Polling effect triggered:", {
      isPolling: state.isPolling,
      isConnected,
      pollInterval: state.pollInterval,
      isPollingActive: isPollingActiveRef.current,
    })

    if (isConnected && state.isPolling) {
      // Start polling with a small delay to ensure connection is stable
      const timer = setTimeout(() => {
        startPolling()
      }, 300)

      return () => {
        clearTimeout(timer)
        stopPolling()
      }
    } else {
      // Stop polling if conditions aren't met
      stopPolling()
    }

    // Cleanup function
    return () => stopPolling()
  }, [state.isPolling, state.pollInterval, isConnected]) // Only these dependencies

  // Auto-scan ports on mount
  useEffect(() => {
    // Scan for ports when the component mounts
    const timer = setTimeout(() => {
      scanPorts()
    }, 200) // Small delay to ensure Electron APIs are ready

    // Set up menu event handlers if in Electron
    if (isElectron && window.electronAPI) {
      const handleScanPorts = () => scanPorts()
      const handleConnectDevice = () => !isConnected && connect()
      const handleDisconnectDevice = () => isConnected && disconnect()
      const handleResetDevice = () => isConnected && reset()
      const handleCalibrateDevice = () => isConnected && calibrate()

      // We know electronAPI exists in Electron environment
      const api = window.electronAPI as NonNullable<typeof window.electronAPI>
      api.onScanPorts(handleScanPorts)
      api.onConnectDevice(handleConnectDevice)
      api.onDisconnectDevice(handleDisconnectDevice)
      api.onResetDevice(handleResetDevice)
      api.onCalibrateDevice(handleCalibrateDevice)

      return () => {
        clearTimeout(timer)
        if (api.removeAllListeners) {
          // Only call removeAllListeners if it exists
          const events = [
            "scan-ports",
            "connect-device",
            "disconnect-device",
            "reset-device",
            "calibrate-device"
          ]
          events.forEach(event => api.removeAllListeners(event))
        }
      }
    }

    return () => {
      clearTimeout(timer)
    }
  }, [isElectron, isConnected])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopPolling()
      if (isConnected && isElectron && window.electronAPI) {
        window.electronAPI.serialDisconnect()
      }
    }
  }, [isConnected, isElectron])

  // Set up event handlers for incoming serial data
  useEffect(() => {
    if (!isElectron || !window.electronAPI) {
      setIsDeviceResponding(false)
      return
    }

    const handleSerialData = (event: any, data: string) => {
      console.log("Received serial data:", data)
      
      const cleanData = data.trim();
      
      // Check for ANGLE: or VEL: prefix
      if (cleanData.startsWith("ANGLE:")) {
        const angleString = cleanData.substring("ANGLE:".length);
        const numericAngle = Number.parseFloat(angleString);
        if (!isNaN(numericAngle)) {
          setIsDeviceResponding(true);
          setError(null);
          // Reset the response timeout
          if (deviceResponseTimeoutRef.current) {
            clearTimeout(deviceResponseTimeoutRef.current);
          }
          deviceResponseTimeoutRef.current = setTimeout(() => {
            setIsDeviceResponding(false);
            setError("Device stopped responding");
          }, 2000); // Consider device not responding after 2 seconds of no data

          const clampedAngle = clampAngle(numericAngle);
          updateState({ currentAngle: clampedAngle });
          setLastAngleUpdate(new Date());
          setPendingAngleRequest(false); // Assuming a response clears pending request
        } else {
           console.warn("Received non-numeric angle data:", angleString);
           // Decide based on protocol if non-numeric means device stopped responding
           // setIsDeviceResponding(false);
           // setError("Unexpected angle data format.");
        }
      } else if (cleanData.startsWith("VEL:")) {
         const velocityString = cleanData.substring("VEL:".length);
         const numericVelocity = Number.parseFloat(velocityString);
         if (!isNaN(numericVelocity)) {
          setIsDeviceResponding(true);
          setError(null);
          // Reset the response timeout
          if (deviceResponseTimeoutRef.current) {
            clearTimeout(deviceResponseTimeoutRef.current);
          }
          deviceResponseTimeoutRef.current = setTimeout(() => {
            setIsDeviceResponding(false);
            setError("Device stopped responding");
          }, 2000); // Consider device not responding after 2 seconds of no data

           updateState({ currentVelocity: numericVelocity });
           setPendingVelocityRequest(false); // Assuming a response clears pending request
         } else {
            console.warn("Received non-numeric velocity data:", velocityString);
            // Decide based on protocol if non-numeric means device stopped responding
            // setIsDeviceResponding(false);
            // setError("Unexpected velocity data format.");
         }
      } else {
        // If we get data without a known prefix
        console.warn("Received unhandled serial data:", cleanData);
        // Depending on the device protocol, unhandled data might mean it stopped responding
        // setIsDeviceResponding(false);
        // setError("Unexpected device response.");
      }

      setLastResponse({
        timestamp: new Date().toISOString(),
        type: "received",
        data: cleanData,
      });
    }

    const handleSerialError = (event: any, errorMessage: string) => {
      console.error("Serial error:", errorMessage)
      setError(errorMessage)
      setIsDeviceResponding(false)
    }

    const handleSerialDisconnected = () => {
      console.log("Serial disconnected")
      setIsConnected(false)
      setIsDeviceResponding(false)
      setError("Device disconnected")
      if (deviceResponseTimeoutRef.current) {
        clearTimeout(deviceResponseTimeoutRef.current)
      }
    }

    // Set up event listeners
    const api = window.electronAPI as NonNullable<typeof window.electronAPI>
    api.onSerialData(handleSerialData)
    api.onSerialError(handleSerialError)
    api.onSerialDisconnected(handleSerialDisconnected)

    // Cleanup function
    return () => {
      if (api.removeAllListeners) {
        api.removeAllListeners("serial-data")
        api.removeAllListeners("serial-error")
        api.removeAllListeners("serial-disconnected")
      }
      if (deviceResponseTimeoutRef.current) {
        clearTimeout(deviceResponseTimeoutRef.current)
      }
    }
  }, [isElectron])

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-gray-900 text-white">
      {/* Sidebar - Connection and Modes only */}
      <ScrollArea className="sidebar flex flex-col h-full min-w-[240px] max-w-[300px] w-[260px] overflow-hidden">
        <div className="flex flex-col h-full">
          <div className="sidebar-header">
            <h2 className="text-lg font-semibold">Mini TFD Control</h2>
            <div className="flex items-center space-x-2 mt-2">
              <div className={`status-indicator ${
                !isConnected ? "status-disconnected" :
                !isDeviceResponding ? "status-warning" :
                "status-connected"
              }`} />
              <span className="text-xs text-gray-400">
                {!isConnected ? "Disconnected" :
                 !isDeviceResponding ? "Device not responding" :
                 "Connected"}
                {isElectron ? " (Electron)" : " (Browser)"}
              </span>
            </div>
          </div>

          {/* Modes */}
          <div className="sidebar-group">
            <div className="sidebar-group-label">Modes</div>
            <div>
              {hapticModes.map((mode) => {
                const Icon = mode.icon
                return (
                  <div
                    key={mode.id}
                    className={`sidebar-menu-item ${state.mode === mode.id ? "active" : ""}`}
                    onClick={() => updateState({ mode: mode.id as HapticMode })}
                    style={{ fontSize: '0.92rem', padding: '0.35rem 0.5rem' }}
                  >
                    <Icon size={15} />
                    <span>{mode.label}</span>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Connection */}
          <div className="sidebar-group">
            <div className="sidebar-group-label">Connection</div>
            <div className="p-1 space-y-2">
              <div className="flex space-x-1">
                <select
                  className="form-select flex-1 min-w-0 text-xs px-1 py-1"
                  value={state.selectedPort}
                  onChange={(e) => updateState({ selectedPort: e.target.value })}
                  style={{ fontSize: '0.85rem' }}
                >
                  <option value="">Select port...</option>
                  {availablePorts.map((port) => (
                    <option key={port.path} value={port.path}>
                      {port.friendlyName || port.manufacturer || port.path}
                    </option>
                  ))}
                </select>
                <button className="btn btn-outline btn-sm" onClick={scanPorts} disabled={isScanning} style={{ minWidth: 28, padding: 0 }}>
                  <RefreshCw size={12} className={isScanning ? "animate-spin" : ""} />
                </button>
              </div>

              <select
                className="form-select text-xs px-1 py-1"
                value={state.baudRate.toString()}
                onChange={(e) => updateState({ baudRate: Number.parseInt(e.target.value) })}
                style={{ fontSize: '0.85rem' }}
              >
                {baudRates.map((rate) => (
                  <option key={rate} value={rate.toString()}>
                    {rate} baud
                  </option>
                ))}
              </select>

              <button
                className={`btn ${isConnected ? "btn-outline" : "btn-primary"} w-full btn-sm`}
                onClick={handleConnect}
                disabled={!state.selectedPort || isConnecting}
                style={{ fontSize: '0.9rem', padding: '0.4rem 0' }}
              >
                {isConnecting ? (
                  "Connecting..."
                ) : isConnected ? (
                  <>
                    <WifiOff size={13} className="mr-2" />
                    Disconnect
                  </>
                ) : (
                  <>
                    <Wifi size={13} className="mr-2" />
                    Connect
                  </>
                )}
              </button>

              {error && (
                <div className="bg-red-900/30 border border-red-800 p-1 rounded text-xs text-red-400">{error}</div>
              )}
            </div>
          </div>

          {/* Angle Monitoring */}
          <div className="sidebar-group">
            <div className="sidebar-group-label">Monitoring</div>
            <div className="p-1 space-y-2">
              <div className="form-control mb-2">
                <label className="form-label">Current Angle (°)</label>
                <div className="form-input bg-gray-800 text-yellow-400 font-mono text-center text-base px-1 py-1" style={{ fontSize: '1rem', width: '100%', minWidth: 0, padding: '0.3rem 0.2rem' }}>
                  {state.currentAngle.toFixed(1)}°
                </div>
              </div>

              <div className="form-control mb-2">
                <label className="form-label">Velocity (°/s)</label>
                <div className="form-input bg-gray-800 text-blue-400 font-mono text-center text-base px-1 py-1" style={{ fontSize: '1rem', width: '100%', minWidth: 0, padding: '0.3rem 0.2rem' }}>
                  {state.currentVelocity.toFixed(1)}°/s
                </div>
              </div>

              <div className="flex items-center space-x-2 mb-2">
                <input
                  type="checkbox"
                  id="polling"
                  checked={state.isPolling}
                  onChange={(e) => updateState({ isPolling: e.target.checked })}
                  className="w-4 h-4"
                />
                <label htmlFor="polling" className="form-label mb-0">
                  Auto-poll angle
                </label>
              </div>

              <div className="form-control mb-2">
                <label className="form-label">Poll Interval (ms)</label>
                <input
                  type="number"
                  className="form-input text-xs px-1 py-1"
                  min="50"
                  max="5000"
                  step="50"
                  value={state.pollInterval}
                  onChange={(e) => updateState({ pollInterval: Number.parseInt(e.target.value) || 100 })}
                  disabled={!state.isPolling}
                  style={{ fontSize: '0.9rem', width: '100%', minWidth: 0, padding: '0.2rem 0.2rem' }}
                />
              </div>

              <div className="flex space-x-1">
                <button className="btn btn-outline btn-sm flex-1" onClick={requestCurrentAngle} disabled={!isConnected} style={{ fontSize: '0.85rem', padding: '0.2rem 0' }}>
                  <Target size={11} className="mr-1" />
                  Angle
                </button>
                <button
                  className="btn btn-outline btn-sm flex-1"
                  onClick={requestCurrentVelocity}
                  disabled={!isConnected}
                  style={{ fontSize: '0.85rem', padding: '0.2rem 0' }}
                >
                  <Zap size={11} className="mr-1" />
                  Velocity
                </button>
              </div>
            </div>
          </div>
        </div>
      </ScrollArea>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden">
        <header className="flex h-14 items-center gap-4 border-b border-gray-700 px-6 min-w-0 bg-gray-900" style={{paddingTop: '0.5rem', paddingBottom: '0.5rem'}}>
          <div className="badge badge-gray text-base" style={{padding: '0.5rem 1rem', fontWeight: 600}}>
            {hapticModes.find((m) => m.id === state.mode)?.label}
          </div>
          {state.isPolling && isConnected && (
            <div className="badge badge-yellow text-xs" style={{marginLeft: 8}}>
              Polling {state.pollInterval}ms
            </div>
          )}
          {isConnected && (
            <div className="badge badge-gray text-xs" style={{marginLeft: 8}}>
              {state.selectedPort} @ {state.baudRate}
            </div>
          )}
        </header>

        {/* Dial and Controls */}
        <div className="flex-1 flex flex-col items-center justify-center p-4 min-w-0 min-h-0 overflow-hidden">
          {/* Velocity Dial positioned above the main dial */}
          <div className="flex justify-center mb-4">
            <VelocityDial velocity={state.currentVelocity} isConnected={isConnected} isDeviceResponding={isDeviceResponding} />
          </div>

          {/* Dial Container */}
          <div className="mb-4" style={{ maxWidth: 420, width: '100%' }}>
            {/* Main Dial Visualization */}
            <DialVisualization
              mode={state.mode}
              angle={state.currentAngle}
              velocity={state.currentVelocity}
              torque={state.torque}
              targetAngle={state.targetAngle}
              endstopMinAngle={state.endstopMinAngle}
              endstopMaxAngle={state.endstopMaxAngle}
              isConnected={isConnected}
              lastUpdate={lastAngleUpdate}
              isDeviceResponding={isDeviceResponding}
            />
          </div>

          {/* Controls below dial */}
          <div className="w-full max-w-2xl flex flex-col items-center">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 w-full">
              {/* Torque Control */}
              {state.mode === "increased-torque" && (
                <div className="form-control" style={{ maxWidth: 220, margin: '0 auto' }}>
                  <label className="form-label">Torque (0.0 - 1.0)</label>
                  <input
                    type="number"
                    className="form-input text-sm px-2 py-1"
                    min="0"
                    max="1"
                    step="0.1"
                    value={state.torque}
                    onChange={(e) => updateState({ torque: Number.parseFloat(e.target.value) || 0 })}
                    style={{ fontSize: '1rem', width: '100%' }}
                  />
                  <div className="text-xs text-gray-400 mt-1">Current: {state.torque.toFixed(1)}</div>
                </div>
              )}

              {/* Proportional Control Settings */}
              {state.mode === "proportional-control" && (
                <div className="form-control" style={{ maxWidth: 220, margin: '0 auto' }}>
                  <label className="form-label">Stiffness</label>
                  <input
                    type="number"
                    className="form-input text-sm px-2 py-1"
                    min="0"
                    max="2"
                    step="0.1"
                    value={state.stiffness}
                    onChange={(e) => updateState({ stiffness: Number.parseFloat(e.target.value) || 0 })}
                    style={{ fontSize: '1rem', width: '100%' }}
                  />
                  <div className="text-xs text-gray-400 mt-1">Current: {state.stiffness.toFixed(1)}</div>
                </div>
              )}

              {/* Endstop Configuration */}
              {state.mode === "endstops" && (
                <div className="form-control" style={{ maxWidth: 220, margin: '0 auto' }}>
                  <label className="form-label">Turns Lock-to-Lock</label>
                  <input
                    type="number"
                    className="form-input text-sm px-2 py-1"
                    min="0.0"
                    max="10"
                    step="0.5"
                    value={state.endstopTurns}
                    onChange={(e) => updateState({ endstopTurns: Number.parseFloat(e.target.value) || 0.5 })}
                    style={{ fontSize: '1rem', width: '100%' }}
                  />
                  <div className="text-xs text-gray-400 mt-1">
                    Range: {state.endstopMinAngle.toFixed(0)}° to {state.endstopMaxAngle.toFixed(0)}°
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

interface DialVisualizationProps {
  mode: HapticMode
  angle: number
  velocity: number
  torque: number
  targetAngle: number
  endstopMinAngle: number
  endstopMaxAngle: number
  isConnected: boolean
  lastUpdate: Date | null
  isDeviceResponding: boolean
}

function DialVisualization({
  mode,
  angle,
  velocity,
  torque,
  targetAngle,
  endstopMinAngle,
  endstopMaxAngle,
  isConnected,
  lastUpdate,
  isDeviceResponding,
}: DialVisualizationProps) {
  // Helper to wrap angle to -180 to 180
  const wrap180 = (angle: number) => {
    let a = ((angle + 180) % 360 + 360) % 360 - 180;
    return a;
  }

  const getStrokeWidth = () => {
    if (mode === "increased-torque") {
      return 3 + torque * 10 // 3-13px based on torque
    }
    if (mode === "proportional-control") {
      const distance = Math.abs(angle - targetAngle)
      return 3 + (distance / 180) * 10 // Thicker when further from target
    }
    return 3
  }

  const getDialOpacity = () => {
    if (!isConnected) return 0.3
    if (mode === "lock") return 0.5
    return 1
  }

  const getDialColor = () => {
    if (!isConnected) return "#6b7280" // Gray when disconnected
    if (!isDeviceResponding) return "#ef4444" // Red when device not responding
    if (lastUpdate && Date.now() - lastUpdate.getTime() > 1000) return "#ef4444" // Red when stale
    return "#eab308" // Yellow when fresh
  }

  const getDisplayAngle = () => {
    if (mode === "endstops") {
      // Clamp angle to endstop range
      const clampedAngle = Math.max(endstopMinAngle, Math.min(endstopMaxAngle, angle))
      // Wrap min/max to -180..180
      const wrapAngle = (a: number) => ((a % 360) + 540) % 360 - 180
      const minWrapped = wrapAngle(endstopMinAngle)
      const maxWrapped = wrapAngle(endstopMaxAngle)
      const minDisplay = (minWrapped + 360) % 360
      const maxDisplay = (maxWrapped + 360) % 360
      const t = (clampedAngle - endstopMinAngle) / (endstopMaxAngle - endstopMinAngle)
      let angleSpan = maxDisplay - minDisplay
      // If min and max display angles are the same, sweep a full circle
      if (angleSpan === 0) {
        return (minDisplay + t * 360) % 360
      }
      if (angleSpan < 0) angleSpan += 360
      return (minDisplay + t * angleSpan) % 360
    }
    // For other modes, normalize to 0-360 with 0 pointing up
    return ((angle % 360) + 360) % 360
  }

  const displayAngle = getDisplayAngle()

  const renderDetents = (count: number, style: "soft" | "medium" | "rough" | "center") => {
    if (style === "center") {
      // Only one detent at 0° (top)
      const detentAngle = 0;
      const x1 = 200 + Math.cos(((detentAngle - 90) * Math.PI) / 180) * 180;
      const y1 = 200 + Math.sin(((detentAngle - 90) * Math.PI) / 180) * 180;
      const x2 = 200 + Math.cos(((detentAngle - 90) * Math.PI) / 180) * (180 - 20);
      const y2 = 200 + Math.sin(((detentAngle - 90) * Math.PI) / 180) * (180 - 20);
      return [
        <line
          key={"center-detent"}
          x1={x1}
          y1={y1}
          x2={x2}
          y2={y2}
          stroke="currentColor"
          strokeWidth={2}
          opacity={0.8}
        />
      ];
    }
    const detents = []
    let spacing = 15, width = 2;
    if (style === "rough") { spacing = 36; width = 1; }
    else if (style === "medium") { spacing = 18; width = 1; }
    else if (style === "soft") { spacing = 2; width = 1; }
    const detentCount = Math.round(360 / spacing);
    for (let i = 0; i < detentCount; i++) {
      const detentAngle = i * spacing;
      const x1 = 200 + Math.cos(((detentAngle - 90) * Math.PI) / 180) * 180;
      const y1 = 200 + Math.sin(((detentAngle - 90) * Math.PI) / 180) * 180;
      const x2 = 200 + Math.cos(((detentAngle - 90) * Math.PI) / 180) * (180 - 20);
      const y2 = 200 + Math.sin(((detentAngle - 90) * Math.PI) / 180) * (180 - 20);
      detents.push(
        <line
          key={i}
          x1={x1}
          y1={y1}
          x2={x2}
          y2={y2}
          stroke="currentColor"
          strokeWidth={width}
          opacity={0.6}
        />
      );
    }
    return detents;
  }

  const renderEndstops = () => {
    // Calculate wrapped angles for endstops (-180 to 180)
    const wrapAngle = (angle: number) => {
      return ((angle % 360) + 540) % 360 - 180
    }
    
    const minWrappedAngle = wrapAngle(endstopMinAngle)
    const maxWrappedAngle = wrapAngle(endstopMaxAngle)
    
    // Convert to display angles (0-360 with 0 pointing up)
    const minDisplayAngle = (minWrappedAngle + 360) % 360
    const maxDisplayAngle = (maxWrappedAngle + 360) % 360
    
    // Calculate the positions on the circle
    const minX = 200 + Math.cos(((minDisplayAngle - 90) * Math.PI) / 180) * 180
    const minY = 200 + Math.sin(((minDisplayAngle - 90) * Math.PI) / 180) * 180
    const maxX = 200 + Math.cos(((maxDisplayAngle - 90) * Math.PI) / 180) * 180
    const maxY = 200 + Math.sin(((maxDisplayAngle - 90) * Math.PI) / 180) * 180

    // Calculate positions for the endstop indicators (slightly outside the circle)
    const minIndicatorX = 200 + Math.cos(((minDisplayAngle - 90) * Math.PI) / 180) * 200
    const minIndicatorY = 200 + Math.sin(((minDisplayAngle - 90) * Math.PI) / 180) * 200
    const maxIndicatorX = 200 + Math.cos(((maxDisplayAngle - 90) * Math.PI) / 180) * 200
    const maxIndicatorY = 200 + Math.sin(((maxDisplayAngle - 90) * Math.PI) / 180) * 200

    // Calculate text label positions (further out)
    const minTextX = 200 + Math.cos(((minDisplayAngle - 90) * Math.PI) / 180) * 240
    const minTextY = 200 + Math.sin(((minDisplayAngle - 90) * Math.PI) / 180) * 240
    const maxTextX = 200 + Math.cos(((maxDisplayAngle - 90) * Math.PI) / 180) * 240
    const maxTextY = 200 + Math.sin(((maxDisplayAngle - 90) * Math.PI) / 180) * 240

    return (
      <>
        {/* Min endstop indicator */}
        <line 
          x1={minX} 
          y1={minY} 
          x2={minIndicatorX} 
          y2={minIndicatorY} 
          stroke="red" 
          strokeWidth="6" 
        />
        <text 
          x={minTextX} 
          y={minTextY} 
          textAnchor="middle" 
          fill="red" 
          fontSize="18" 
          fontWeight="bold"
        >
          MIN
        </text>
        <text 
          x={minTextX} 
          y={minTextY + 22} 
          textAnchor="middle" 
          fill="red" 
          fontSize="16" 
          fontWeight="bold"
        >
          {endstopMinAngle.toFixed(0)}°
        </text>

        {/* Max endstop indicator */}
        <line 
          x1={maxX} 
          y1={maxY} 
          x2={maxIndicatorX} 
          y2={maxIndicatorY} 
          stroke="red" 
          strokeWidth="6" 
        />
        <text 
          x={maxTextX} 
          y={maxTextY} 
          textAnchor="middle" 
          fill="red" 
          fontSize="18" 
          fontWeight="bold"
        >
          MAX
        </text>
        <text 
          x={maxTextX} 
          y={maxTextY + 22} 
          textAnchor="middle" 
          fill="red" 
          fontSize="16" 
          fontWeight="bold"
        >
          {endstopMaxAngle.toFixed(0)}°
        </text>
      </>
    )
  }

  const renderDirectionalArrow = (clockwise: boolean) => {
    // Use RotateCw/RotateCcw icons in the middle of the dial
    const iconSize = 60; // Adjust size as needed
    const iconColor = "#eab308"; // Match dial color

    return (
      <g>
        {clockwise ? (
          <RotateCw
            size={iconSize}
            color={iconColor}
            x={200 - iconSize / 2}
            y={200 - iconSize / 2}
          />
        ) : (
          <RotateCcw
            size={iconSize}
            color={iconColor}
            x={200 - iconSize / 2}
            y={200 - iconSize / 2}
          />
        )}
      </g>
    );
  }

  const renderTargetIndicator = () => {
    if (mode !== "proportional-control") return null

    // Adjust target angle to match new orientation (0 is up)
    const adjustedTargetAngle = targetAngle + 180
    const targetX = 200 + Math.cos(((adjustedTargetAngle - 90) * Math.PI) / 180) * 160
    const targetY = 200 + Math.sin(((adjustedTargetAngle - 90) * Math.PI) / 180) * 160

    return (
      <g>
        <circle cx={targetX} cy={targetY} r="12" fill="none" stroke="yellow" strokeWidth="3" opacity={0.8} />
        <text x={targetX} y={targetY + 25} textAnchor="middle" fill="yellow" fontSize="10">
          Target
        </text>
      </g>
    )
  }

  return (
    <div className="dial-container">
      <svg
        width="400"
        height="400"
        viewBox="0 0 400 400"
        className="pointer-events-none" // Remove interaction since we're reading, not setting
        style={{ opacity: getDialOpacity() }}
      >
        <defs>
          <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
            <polygon points="0 0, 10 3.5, 0 7" fill="currentColor" />
          </marker>
        </defs>

        {/* Main dial circle */}
        <circle cx="200" cy="200" r="180" fill="none" stroke={getDialColor()} strokeWidth={getStrokeWidth()} />

        {/* Mode-specific elements */}
        {mode === "soft-detents" && renderDetents(0, "soft")}
        {mode === "medium-detents" && renderDetents(0, "medium")}
        {mode === "rough-detents" && renderDetents(0, "rough")}
        {mode === "center-detent" && renderDetents(1, "center")}
        {mode === "endstops" && renderEndstops()}
        {mode === "clockwise" && renderDirectionalArrow(true)}
        {mode === "counterclockwise" && renderDirectionalArrow(false)}
        {renderTargetIndicator()}

        {/* Lock icon for lock mode */}
        {mode === "lock" && (
          <g transform="translate(185, 185)">
            <rect x="5" y="15" width="20" height="15" rx="2" fill="none" stroke="currentColor" strokeWidth="3" />
            <path d="M10 15V10a5 5 0 0 1 10 0v5" fill="none" stroke="currentColor" strokeWidth="3" />
          </g>
        )}

        {/* Angle pointer - using displayAngle for proper visualization */}
        <line
          x1="200"
          y1="200"
          x2={200 + Math.cos(((displayAngle - 90) * Math.PI) / 180) * 150}
          y2={200 + Math.sin(((displayAngle - 90) * Math.PI) / 180) * 150}
          stroke={getDialColor()}
          strokeWidth="4"
          strokeLinecap="round"
        />

        {/* Center dot */}
        <circle cx="200" cy="200" r="8" fill={getDialColor()} />

        {/* Angle display */}
        <text x="200" y="250" textAnchor="middle" fill={getDialColor()} fontSize="16" fontWeight="bold">
          {mode === "endstops"
            ? angle.toFixed(1) + "°"
            : wrap180(angle).toFixed(1) + "°"}
        </text>

        {/* Connection status indicator */}
        {!isConnected && (
          <text x="200" y="320" textAnchor="middle" fill="#6b7280" fontSize="14">
            Not Connected
          </text>
        )}
        {isConnected && !isDeviceResponding && (
          <text x="200" y="320" textAnchor="middle" fill="#f59e0b" fontSize="14">
            Device Not Responding
          </text>
        )}

        {/* Multi-turn indicator for endstops */}
        {mode === "endstops" && (
          <text x="200" y="290" textAnchor="middle" fill={getDialColor()} fontSize="12">
            {(angle / 360).toFixed(2)} turns
          </text>
        )}
      </svg>
    </div>
  )
}

// Helper function to format haptic commands using your protocol
function formatTFDCommand(config: TFDState): string {
  // Using your exact command protocol
  switch (config.mode) {
    case "none":
      return "set normal\n"
    case "soft-detents":
      return "set detent:ultra\n"
    case "medium-detents":
      return "set detent:fine\n"
    case "rough-detents":
      return "set detent:coarse\n"
    case "clockwise":
      return "set cw\n"
    case "counterclockwise":
      return "set ccw\n"
    case "increased-torque":
      return `set constant:${config.torque.toFixed(1)}\n`
    case "lock":
      return "set constant:1.0\n"
    case "endstops":
      return `set endstops:${config.endstopTurns.toFixed(1)}\n`
    case "center-detent":
      return "set detent:center\n"
    case "proportional-control":
      return `set proportional:${config.targetAngle.toFixed(1)},${config.stiffness.toFixed(1)}\n`
    default:
      return "set normal\n"
  }
}

// New Velocity Dial component (Speedometer)
interface VelocityDialProps {
  velocity: number;
  isConnected: boolean;
  isDeviceResponding: boolean;
}

function VelocityDial({ velocity, isConnected, isDeviceResponding }: VelocityDialProps) {
  // Map velocity to a visual angle (-1000 to 1000 maps to a sweep, e.g., 270 degrees)
  const maxDisplayVelocity = 2000;
  const clampedVelocity = Math.max(-maxDisplayVelocity, Math.min(maxDisplayVelocity, velocity));

  // Speedometer sweep: Start at -135 deg, end at +135 deg (relative to top-up 0 deg)
  const startSweepAngle = -135; // degrees
  const endSweepAngle = 135;   // degrees
  const totalSweepAngle = endSweepAngle - startSweepAngle;

  // Map clampedVelocity from [-maxDisplayVelocity, maxDisplayVelocity] to [startSweepAngle, endSweepAngle]
  const normalizedVelocity = (clampedVelocity + maxDisplayVelocity) / (2 * maxDisplayVelocity);
  const pointerAngle = startSweepAngle + normalizedVelocity * totalSweepAngle;

  const dialColor = !isConnected ? "#6b7280" : // Gray when disconnected
                   !isDeviceResponding ? "#ef4444" : // Red when device not responding
                   "#facc15"; // Yellow when connected and responding

  // SVG dimensions for a full circle
  const svgSize = 180; // Adjust size as needed
  const centerX = svgSize / 2;
  const centerY = svgSize / 2;
  const radius = svgSize / 2 - 10; // Radius with some padding

  return (
    <svg
      width={svgSize}
      height={svgSize}
      viewBox={`0 0 ${svgSize} ${svgSize}`}
      className="pointer-events-none"
      style={{ opacity: isConnected ? 1 : 0.5 }}
    >
      {/* Full circle dial */}
      <circle
        cx={centerX}
        cy={centerY}
        r={radius}
        fill="none"
        stroke={dialColor}
        strokeWidth="6"
      />

      {/* Center dot */}
      <circle cx={centerX} cy={centerY} r="6" fill={dialColor} />

      {/* Pointer */}
      {/* Pointer angle needs to be adjusted for SVG's coordinate system (0 is right, clockwise) */}
      {/* Our angle is relative to top-up (0), so adjust by -90 degrees */}
      <line
        x1={centerX}
        y1={centerY}
        x2={centerX + Math.cos((pointerAngle - 90) * Math.PI / 180) * (radius - 5)}
        y2={centerY + Math.sin((pointerAngle - 90) * Math.PI / 180) * (radius - 5)}
        stroke={dialColor}
        strokeWidth="4"
        strokeLinecap="round"
      />

      {/* Velocity text (value) - Centered in the circle */}
      <text x={centerX} y={centerY + 20} textAnchor="middle" fill={dialColor} fontSize="18" fontWeight="bold">
        {velocity.toFixed(1)}°/s
      </text>

      {/* Numerical labels */}
      {/* -1000 label */}
      <text x={centerX + Math.cos((startSweepAngle - 90) * Math.PI / 180) * (radius + 15)} y={centerY + Math.sin((startSweepAngle - 90) * Math.PI / 180) * (radius + 15)} textAnchor="end" fill={dialColor} fontSize="12">
        -2K
      </text>
      {/* 0 label */}
       <text x={centerX + Math.cos((0 - 90) * Math.PI / 180) * (radius + 15)} y={centerY + Math.sin((0 - 90) * Math.PI / 180) * (radius + 15)} textAnchor="middle" fill={dialColor} fontSize="12">
        0
      </text>
      {/* 1000 label */}
      <text x={centerX + Math.cos((endSweepAngle - 90) * Math.PI / 180) * (radius + 15)} y={centerY + Math.sin((endSweepAngle - 90) * Math.PI / 180) * (radius + 15)} textAnchor="start" fill={dialColor} fontSize="12">
        2K
      </text>
    </svg>
  );
}
