"use client"
import { useState, useEffect, useRef } from "react"
import {
  ArrowRight,
  Lock,
  Wifi,
  WifiOff,
  Settings,
  RotateCw,
  RotateCcw,
  Target,
  Zap,
  RefreshCw,
  ArrowRightCircle,
  ArrowLeftCircle,
  Gauge,
  ChevronDown,
  ChevronUp,
  Link2Icon,
} from "lucide-react"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Switch } from "@radix-ui/react-switch";

// Constants for product ID persistence
const DEFAULT_PRODUCT_ID = "1002";
const LAST_PRODUCT_ID_KEY = "lastConnectedProductId";

// Helper functions for product ID persistence
const getLastProductId = (): string => {
  if (typeof window === 'undefined') return DEFAULT_PRODUCT_ID;
  return localStorage.getItem(LAST_PRODUCT_ID_KEY) || DEFAULT_PRODUCT_ID;
};

const setLastProductId = (productId: string) => {
  if (typeof window === 'undefined') return;
  localStorage.setItem(LAST_PRODUCT_ID_KEY, productId);
};

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
  | "inertial-control"
  | "latch"

type DeviceType = "knob" | "steering-wheel"

type EndstopMode = "none" | "proportional" | "soft" | "medium" | "rough" | "center"

interface TFDState {
  mode: HapticMode
  currentAngle: number
  currentVelocity: number
  currentTorque: number
  torque: number
  stiffness: number
  targetAngle: number
  selectedPort: string
  baudRate: number
  isPolling: boolean
  pollInterval: number
  endstopTurns: number
  endstopMinAngle: number
  endstopMaxAngle: number
  deviceType: DeviceType
  endstopMode: EndstopMode
  isSticky: boolean
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

const hapticModes: { id: HapticMode; label: string; icon: any; devices: DeviceType[] }[] = [
  { id: "none", label: "None", icon: Settings, devices: ["knob", "steering-wheel"] },
  { id: "center-detent", label: "Center Detent", icon: Target, devices: ["knob", "steering-wheel"] },
  { id: "rough-detents", label: "Rough Detents", icon: Target, devices: ["knob"] },
  { id: "medium-detents", label: "Medium Detents", icon: Target, devices: ["knob"] },
  { id: "soft-detents", label: "Soft Detents", icon: Target, devices: ["knob"] },
  { id: "clockwise", label: "Clockwise", icon: ArrowRightCircle, devices: ["knob"] },
  { id: "counterclockwise", label: "Counterclockwise", icon: ArrowLeftCircle, devices: ["knob"] },
  { id: "increased-torque", label: "Increased Torque", icon: Zap, devices: ["knob", "steering-wheel"] },
  { id: "lock", label: "Lock", icon: Lock, devices: ["knob"] },
  { id: "endstops", label: "Endstops", icon: ArrowRight, devices: ["knob", "steering-wheel"] },
  { id: "proportional-control", label: "Proportional Control", icon: Settings, devices: ["knob", "steering-wheel"] },
  { id: "inertial-control", label: "Inertial Control", icon: Gauge, devices: ["steering-wheel"] },
  { id: "latch", label: "Latch", icon: Link2Icon, devices: ["knob"] },
]

const baudRates = [9600, 19200, 38400, 57600, 115200, 230400, 460800, 921600]

// Add type declaration for window.electronAPI
declare global {
  interface Window {
    electronAPI?: {
      serialListPorts: () => Promise<SerialPortInfo[]>
      serialConnect: (portPath: string, baudRate: number) => Promise<{ success: boolean; error?: string }>
      serialDisconnect: () => Promise<{ success: boolean; error?: string }>
      serialWrite: (data: string) => Promise<{ success: boolean; error?: string }>
      onSerialData: (callback: (event: any, data: string) => void) => void
      onSerialError: (callback: (event: any, error: string) => void) => void
      onSerialDisconnected: (callback: () => void) => void
      onScanPorts: (callback: () => void) => void
      onConnectDevice: (callback: () => void) => void
      onDisconnectDevice: (callback: () => void) => void
      onResetDevice: (callback: () => void) => void
      onCalibrateDevice: (callback: () => void) => void
      removeAllListeners?: (event: string) => void
    }
  }
}

// Add CollapsibleSection component before MiniTFDControl
interface CollapsibleSectionProps {
  title: string
  children: React.ReactNode
  defaultExpanded?: boolean
}

function CollapsibleSection({ title, children, defaultExpanded = true }: CollapsibleSectionProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded)

  return (
    <div className="sidebar-group">
      <div 
        className={`sidebar-group-label ${!isExpanded ? 'collapsed' : ''}`}
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <span>{title}</span>
        <ChevronDown size={16} className="text-gray-400" />
      </div>
      <div className={`collapsible-content ${isExpanded ? 'expanded' : 'collapsed'}`}>
        <div className="p-1 space-y-2">
          {children}
        </div>
      </div>
    </div>
  )
}

export function MiniTFDControl() {
  // State
  const [state, setState] = useState<TFDState>({
    mode: "none",
    currentAngle: 0,
    currentVelocity: 0,
    currentTorque: 0,
    torque: 0.2,
    stiffness: 0.8,
    targetAngle: 0,
    selectedPort: "",
    baudRate: 115200,
    isPolling: true,
    pollInterval: 20,
    endstopTurns: 1.0,
    endstopMinAngle: -180,
    endstopMaxAngle: 180,
    deviceType: "knob",
    endstopMode: "none",
    isSticky: false,
  })
  const [isConnected, setIsConnected] = useState(false)
  const [isConnecting, setIsConnecting] = useState(false)
  const [isAutoConnecting, setIsAutoConnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastResponse, setLastResponse] = useState<any>(null)
  const [availablePorts, setAvailablePorts] = useState<SerialPortInfo[]>([])
  const [isScanning, setIsScanning] = useState(false)
  const [isElectron, setIsElectron] = useState(false)
  const [lastAngleUpdate, setLastAngleUpdate] = useState<Date | null>(null)
  const [pendingAngleRequest, setPendingAngleRequest] = useState(false)
  const [pendingVelocityRequest, setPendingVelocityRequest] = useState(false)
  const [isDeviceResponding, setIsDeviceResponding] = useState(false)
  // Update angle filter state with more sophisticated filtering
  const [filteredAngle, setFilteredAngle] = useState<number>(0)
  const angleHistoryRef = useRef<number[]>([])
  const FILTER_WINDOW_SIZE = 3 // Small window for responsiveness
  const ANGLE_THRESHOLD = 0.2 // Keep the small threshold for responsiveness
  const EWMA_ALPHA = 0.2 // Increased from 0.2 for more responsiveness
  const lastStableAngleRef = useRef<number>(0)
  // Add new state variables for reconnection logic
  const [reconnectAttempts, setReconnectAttempts] = useState(0)
  const [isReconnecting, setIsReconnecting] = useState(false)
  const [isInGracePeriod, setIsInGracePeriod] = useState(false)
  const [lastPortPath, setLastPortPath] = useState<string>("")
  const [lastBaudRate, setLastBaudRate] = useState<number>(115200)
  const [hasAttemptedReconnect, setHasAttemptedReconnect] = useState(false)

  // Refs
  const deviceResponseTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null)
  const isPollingActiveRef = useRef(false)
  const lastCommandRef = useRef<"angle" | "velocity" | null>(null)

  // Filter haptic modes based on device type
  const getAvailableModes = (deviceType: DeviceType) => {
    return hapticModes.filter((mode) => mode.devices.includes(deviceType))
  }

  // Handle device type change
  const handleDeviceTypeChange = (newDeviceType: DeviceType) => {
    const availableModes = getAvailableModes(newDeviceType)
    const currentModeAvailable = availableModes.some((mode) => mode.id === state.mode)

    updateState({
      deviceType: newDeviceType,
      mode: currentModeAvailable ? state.mode : "none",
    })
  }

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
    // if (state.mode === "endstops") {
    //   return Math.max(state.endstopMinAngle, Math.min(state.endstopMaxAngle, angle))
    // }
    // For other modes, allow full range
    return angle
  }

  // Serial port scanning - Modified to just list ports
  const listAvailablePorts = async () => {
    console.log("Scanning for serial ports...", { isElectron, hasElectronAPI: !!window.electronAPI })
    setIsScanning(true)
    setError(null)

    try {
      if (isElectron && window.electronAPI) {
        console.log("Using Electron API for port scanning")
        const ports = await window.electronAPI.serialListPorts()
        console.log("Found ports:", ports)
        setAvailablePorts(ports)
        return ports; // Return ports for auto-connect
      } else {
        setAvailablePorts([])
        setError("Serial communication not available in browser")
        return [];
      }
    } catch (err) {
      console.error("Failed to scan ports:", err)
      setError("Failed to scan for serial ports")
      return [];
    } finally {
      setIsScanning(false)
    }
  }

  // Auto-connect logic
  const handleAutoConnect = async () => {
    if (!isElectron || !window.electronAPI) {
      setError("Serial communication not available in browser for auto-connect");
      return;
    }
    if (isAutoConnecting) return;
    if (isConnected) {
      await disconnect();
    }

    setIsAutoConnecting(true);
    setError(null);
    setAvailablePorts([]);
    updateState({ selectedPort: "" });

    console.log("Starting auto-connect...");

    try {
      const ports = await listAvailablePorts();

      if (ports.length === 0) {
        setError("No serial ports found.");
        setIsAutoConnecting(false);
        return;
      }

      // Filter ports to only include those with a defined productId
      const filteredPorts = ports.filter(port => port.productId !== undefined);

      if (filteredPorts.length === 0) {
        setError("No compatible devices with Product ID found.");
        setIsAutoConnecting(false);
        return;
      }

      // Get the last connected productID
      const lastProductId = getLastProductId();
      console.log(`Looking for port with Product ID: ${lastProductId}`);

      // Try to find a port matching the last productID first
      const preferredPort = filteredPorts.find(port => port.productId === lastProductId);

      if (preferredPort) {
        console.log(`Found preferred port: ${preferredPort.path} (Product ID: ${preferredPort.productId})`);
        updateState({ selectedPort: preferredPort.path });
        
        // Connect to the preferred port
        await connect(preferredPort.path, state.baudRate);
        setIsAutoConnecting(false);

      } else {
        console.log(`Preferred port with Product ID ${lastProductId} not found.`);
        // Do not connect, allow manual connection
        setIsAutoConnecting(false);
      }

    } catch (err) {
      console.error("Auto-connect process failed:", err);
      setError("Auto-connect failed.");
      setIsAutoConnecting(false);
    }
  };

  // Add new function to check device responsiveness
  const checkDeviceResponsiveness = async (): Promise<boolean> => {
    if (!isElectron || !window.electronAPI) return false;
    
    try {
      const result = await window.electronAPI.serialWrite("get all\n");
      return result.success;
    } catch (err) {
      console.error("Error checking device responsiveness:", err);
      return false;
    }
  };

  // Add new function to handle reconnection
  const handleReconnection = async () => {
    if (isReconnecting || reconnectAttempts >= 3 || !lastPortPath) return;
    
    console.log(`Attempting reconnection (attempt ${reconnectAttempts + 1}/3)...`);
    setIsReconnecting(true);
    
    try {
      // First disconnect
      if (isElectron && window.electronAPI) {
        await window.electronAPI.serialDisconnect();
      }
      
      // Wait a bit before reconnecting
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Attempt to reconnect
      if (isElectron && window.electronAPI) {
        const result = await window.electronAPI.serialConnect(lastPortPath, lastBaudRate);
        if (result.success) {
          setIsConnected(true);
          setIsInGracePeriod(true);
          
          // Start grace period timer
          setTimeout(async () => {
            setIsInGracePeriod(false);
            const isResponding = await checkDeviceResponsiveness();
            if (!isResponding) {
              setReconnectAttempts(prev => prev + 1);
              if (reconnectAttempts + 1 < 3) {
                handleReconnection();
              } else {
                setError("Device not responding after reconnection attempts");
                setIsDeviceResponding(false);
              }
            } else {
              setIsDeviceResponding(true);
              setReconnectAttempts(0);
              setHasAttemptedReconnect(false);
            }
          }, 2000); // 2 second grace period
        } else {
          throw new Error(result.error || "Reconnection failed");
        }
      }
    } catch (err) {
      console.error("Reconnection failed:", err);
      setReconnectAttempts(prev => prev + 1);
      if (reconnectAttempts + 1 < 3) {
        handleReconnection();
      } else {
        setError("Failed to reconnect after multiple attempts");
      }
    } finally {
      setIsReconnecting(false);
    }
  };

  // Modify connect function to store last connection details
  const connect = async (portPath?: string, baudRate?: number) => {
    const targetPort = portPath || state.selectedPort;
    const targetBaudRate = baudRate || state.baudRate;

    if (!targetPort) {
      setError("Please select a port first")
      return
    }

    // Store connection details for potential reconnection
    setLastPortPath(targetPort);
    setLastBaudRate(targetBaudRate);
    setReconnectAttempts(0);
    setHasAttemptedReconnect(false);

    // Find and store the productID of the port we're connecting to
    const port = availablePorts.find(p => p.path === targetPort);
    if (port?.productId) {
      setLastProductId(port.productId);
      console.log(`Storing product ID: ${port.productId}`);
    }

    setIsConnecting(true);
    setError(null);
    setIsDeviceResponding(false);
    // Clear any existing device response timeout when starting a new connection attempt
    if (deviceResponseTimeoutRef.current) {
      clearTimeout(deviceResponseTimeoutRef.current);
      deviceResponseTimeoutRef.current = null;
    }
    console.log(`Connecting to ${targetPort} at ${targetBaudRate} baud...`);

    try {
      if (isElectron && window.electronAPI) {
        console.log("Using Electron API for connection")
        const result = await window.electronAPI.serialConnect(targetPort, targetBaudRate)
        if (result.success) {
          setIsConnected(true)
          setIsInGracePeriod(true)
          setLastResponse({
            status: "connecting",
            port: targetPort,
            baudRate: targetBaudRate,
            timestamp: new Date().toISOString(),
          })
          
          // Start grace period timer
          setTimeout(async () => {
            setIsInGracePeriod(false);
            const isResponding = await checkDeviceResponsiveness();
            if (!isResponding) {
              setError("Device not responding after connection");
              setIsDeviceResponding(false);
            } else {
              setIsDeviceResponding(true);
            }
          }, 2000); // 2 second grace period
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
        const result = await window.electronAPI.serialWrite("get all\n")
        if (!result.success) {
          setPendingAngleRequest(false)
          setIsDeviceResponding(false)
          setError("Device not responding to data request")
          throw new Error("Failed to request data")
        }
        return null
      }
      setIsDeviceResponding(false)
      return null
    } catch (err) {
      console.error("Failed to get current data:", err)
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
        return null // Data will be received via onSerialData
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

  // Add new function to get current torque from device
  const getCurrentTorque = async (): Promise<number | null> => {
    try {
      if (isElectron && window.electronAPI) {
        const result = await window.electronAPI.serialWrite("get torque\n");
        if (!result.success) {
          setIsDeviceResponding(false);
          setError("Device not responding to torque request");
          throw new Error("Failed to request torque");
        }
        return null; // Data will be received via onSerialData
      }
      setIsDeviceResponding(false);
      return null;
    } catch (err) {
      console.error("Failed to get current torque:", err);
      setIsDeviceResponding(false);
      return null;
    }
  };

  // Start/stop angle polling
  const startPolling = () => {
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
        // Request all data with a single command
        getCurrentAngle()
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

      const result = await window.electronAPI.serialWrite(command)
      if (!result.success) {
        throw new Error(result.error || "Failed to send config")
      }

      // Send sticky command separately if in endstop mode
      if (state.mode === "endstops") {
        const stickyResult = await window.electronAPI.serialWrite(`set sticky:${state.isSticky ? "on" : "off"}\n`)
        if (!stickyResult.success) {
          throw new Error(stickyResult.error || "Failed to set sticky mode")
        }
      }

      setError(null)
      setLastResponse({
        timestamp: new Date().toISOString(),
        command: "tfd_config",
        sent: command,
        config: state,
      })
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

  // Handle polling changes
  useEffect(() => {
    console.log("Polling effect triggered:", {
      isPolling: state.isPolling,
      isConnected,
      pollInterval: state.pollInterval,
      isPollingActive: isPollingActiveRef.current,
    })

    if (isConnected && state.isPolling) {
      const timer = setTimeout(() => {
        startPolling()
      }, 300)

      return () => {
        clearTimeout(timer)
        stopPolling()
      }
    } else {
      stopPolling()
    }

    return () => stopPolling()
  }, [state.isPolling, state.pollInterval, isConnected])

  // Auto-scan ports on mount
  useEffect(() => {
    const timer = setTimeout(() => {
      listAvailablePorts()
    }, 200)

    if (isElectron && window.electronAPI) {
      const handleScanPorts = () => listAvailablePorts()
      const handleConnectDevice = () => !isConnected && handleAutoConnect()
      const handleDisconnectDevice = () => isConnected && disconnect()
      const handleResetDevice = () => isConnected && reset()
      const handleCalibrateDevice = () => isConnected && calibrate()

      const api = window.electronAPI as NonNullable<typeof window.electronAPI>
      api.onScanPorts(handleScanPorts)
      api.onConnectDevice(handleConnectDevice)
      api.onDisconnectDevice(handleDisconnectDevice)
      api.onResetDevice(handleResetDevice)
      api.onCalibrateDevice(handleCalibrateDevice)

      return () => {
        clearTimeout(timer)
        if (api.removeAllListeners) {
          const events = ["scan-ports", "connect-device", "disconnect-device", "reset-device", "calibrate-device"]
          events.forEach((event) => api.removeAllListeners(event))
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
      console.log("Electron API not available");
      setIsDeviceResponding(false)
      return
    }

    console.log("Setting up serial data handlers...");

    const handleSerialData = (event: any, data: string) => {
      console.log("Raw data received:", data); // Log raw data
      const cleanData = data.trim()
      console.log("Cleaned data:", cleanData); // Log cleaned data

      // Check if the response looks like valid sensor data (combined format)
      const isSensorData = cleanData.startsWith("ANGLE:") && cleanData.includes("VEL:") && cleanData.includes("TORQUE:");
      const isCommandResponse = cleanData === "OK";
      
      console.log("Data type check:", { isSensorData, isCommandResponse }); // Log data type check

      if (isSensorData || isCommandResponse) {
          setIsDeviceResponding(true);
          setError(null);

          // Reset the timeout whenever a valid response is received
          if (deviceResponseTimeoutRef.current) {
            clearTimeout(deviceResponseTimeoutRef.current);
          }
          deviceResponseTimeoutRef.current = setTimeout(() => {
            console.log("Device response timeout.");
            setIsDeviceResponding(false);
            setError("Device stopped responding.");
            
            // Trigger reconnection if we haven't already attempted it
            if (!hasAttemptedReconnect && isConnected) {
              setHasAttemptedReconnect(true);
              handleReconnection();
            }
          }, 2000);
      }

      if (isSensorData) {
        try {
          console.log("Starting to parse sensor data..."); // Log start of parsing
          
          // Parse the combined response format
          const parts = cleanData.split(',');
          console.log("Split parts:", parts); // Log split parts
          
          // Extract values using regex with proper error handling
          const angleMatch = parts[0].match(/ANGLE:([-\d.]+)/);
          const velMatch = parts[1].match(/VEL:([-\d.]+)/);
          const torqueMatch = parts[2].match(/TORQUE:([-\d.]+)/);
          
          console.log("Regex matches:", { // Log regex matches
            angleMatch,
            velMatch,
            torqueMatch
          });

          // Update angle if valid
          if (angleMatch && angleMatch[1]) {
            const numericAngle = parseFloat(angleMatch[1]);
            console.log("Parsed angle:", numericAngle); // Log parsed angle
            if (!isNaN(numericAngle)) {
              const clampedAngle = clampAngle(numericAngle);
              updateState({ currentAngle: clampedAngle });
              setLastAngleUpdate(new Date());
              setPendingAngleRequest(false);
            } else {
              console.warn("Invalid angle value:", angleMatch[1]);
            }
          }

          // Update velocity if valid
          if (velMatch && velMatch[1]) {
            const numericVelocity = parseFloat(velMatch[1]);
            console.log("Parsed velocity:", numericVelocity); // Log parsed velocity
            if (!isNaN(numericVelocity)) {
              updateState({ currentVelocity: numericVelocity });
              setPendingVelocityRequest(false);
            } else {
              console.warn("Invalid velocity value:", velMatch[1]);
            }
          }

          // Update torque if valid
          if (torqueMatch && torqueMatch[1]) {
            const numericTorque = parseFloat(torqueMatch[1]);
            console.log("Parsed torque:", numericTorque); // Log parsed torque
            if (!isNaN(numericTorque)) {
              updateState({ currentTorque: numericTorque });
            } else {
              console.warn("Invalid torque value:", torqueMatch[1]);
            }
          }

          // Log the parsed values for debugging
          console.log("Final parsed values:", {
            angle: angleMatch ? parseFloat(angleMatch[1]) : null,
            velocity: velMatch ? parseFloat(velMatch[1]) : null,
            torque: torqueMatch ? parseFloat(torqueMatch[1]) : null
          });

        } catch (err) {
          console.error("Error parsing sensor data:", err, "Raw data:", cleanData);
        }
      }

      setLastResponse({
        timestamp: new Date().toISOString(),
        type: "received",
        data: cleanData,
      })
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

    console.log("Registering serial event handlers...");
    const api = window.electronAPI as NonNullable<typeof window.electronAPI>
    api.onSerialData(handleSerialData)
    api.onSerialError(handleSerialError)
    api.onSerialDisconnected(handleSerialDisconnected)

    return () => {
      console.log("Cleaning up serial event handlers...");
      if (api.removeAllListeners) {
        api.removeAllListeners("serial-data")
        api.removeAllListeners("serial-error")
        api.removeAllListeners("serial-disconnected")
      }
      if (deviceResponseTimeoutRef.current) {
        clearTimeout(deviceResponseTimeoutRef.current)
      }
    }
  }, [isElectron, isConnected, hasAttemptedReconnect])

  // Update filtered angle using simple moving average
  useEffect(() => {
    if (state.currentAngle === null) return

    // For endstop mode, use the raw angle value directly
    // if (state.mode === "endstops") {
    //   setFilteredAngle(state.currentAngle)
    //   return
    // }

    // // Add new angle to history
    // angleHistoryRef.current.push(state.currentAngle)
    // // Keep only the last FILTER_WINDOW_SIZE samples
    // if (angleHistoryRef.current.length > FILTER_WINDOW_SIZE) {
    //   angleHistoryRef.current.shift()
    // }

    // // Calculate simple moving average
    // const sum = angleHistoryRef.current.reduce((a, b) => a + b, 0)
    // const avg = sum / angleHistoryRef.current.length

    // // Only update if change is significant
    // if (Math.abs(avg - filteredAngle) > ANGLE_THRESHOLD) {
    //   setFilteredAngle(Math.floor(avg)) // Truncate decimals
    // }
    setFilteredAngle(state.currentAngle);
  }, [state.currentAngle, state.mode])

  // Handle mode change
  const handleModeChange = (newMode: HapticMode) => {
    // Update stiffness based on mode
    const newStiffness = newMode === "inertial-control" ? 0.25 : 
                        newMode === "proportional-control" ? 0.4 : 
                        state.stiffness;
    
    updateState({
      mode: newMode,
      stiffness: newStiffness
    });
  }

  // Update the mode selection handler to use the new function
  const handleModeSelect = (mode: HapticMode) => {
    handleModeChange(mode);
  }

  const availableModes = getAvailableModes(state.deviceType)

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-gray-900 text-white">
      {/* Sidebar */}
      <ScrollArea className="sidebar flex flex-col h-full min-w-[240px] max-w-[300px] w-[260px] overflow-hidden">
        <div className="flex flex-col h-full">
          <div className="sidebar-header">
            <h2 className="text-lg font-semibold">Mini TFD Control</h2>
            <div className="flex items-center space-x-2 mt-2">
              <div
                className={`status-indicator ${
                  !isConnected ? "status-disconnected" : !isDeviceResponding ? "status-warning" : "status-connected"
                }`}
              />
              <span className="text-xs text-gray-400">
                {!isConnected ? "Disconnected" : !isDeviceResponding ? "Device not responding" : "Connected"}
                {isElectron ? "" : " (Browser)"}
              </span>
            </div>
            
            <div className="fixed-size-vertical-div"></div>

            {/* Custom Device Type Tabs */}
            <div className="mt-4 flex bg-gray-800 rounded-lg p-1 gap-1">
              <button
                className={`tab ${
                  state.deviceType === "knob"
                    ? "active"
                    : ""
                }`}
                onClick={() => handleDeviceTypeChange("knob")}
              >
                <Settings className="w-4 h-4 mr-2" />
                Knob
              </button>
              <button
                className={`tab ${
                  state.deviceType === "steering-wheel"
                    ? "active"
                    : ""
                }`}
                onClick={() => handleDeviceTypeChange("steering-wheel")}
              >
                <Gauge className="w-4 h-4 mr-2" />
                Steering
              </button>
            </div>
          </div>

          {/* Modes */}
          <CollapsibleSection title="Modes">
            {availableModes.map((mode) => {
              const Icon = mode.icon
              return (
                <div
                  key={mode.id}
                  className={`sidebar-menu-item ${state.mode === mode.id ? "active" : ""}`}
                  onClick={() => handleModeSelect(mode.id as HapticMode)}
                  style={{ fontSize: "0.92rem", padding: "0.35rem 0.5rem" }}
                >
                  <Icon size={15} />
                  <span>{mode.label}</span>
                </div>
              )
            })}
          </CollapsibleSection>

          {/* Connection section */}
          <CollapsibleSection title="Connection">
            {/* Manual port selection */}
            <div className="flex space-x-1">
              <select
                className="form-select flex-1 min-w-0 text-xs px-1 py-1"
                value={state.selectedPort}
                onChange={(e) => updateState({ selectedPort: e.target.value })}
                style={{ fontSize: "0.85rem" }}
                disabled={isAutoConnecting}
              >
                <option value="">Select port...</option>
                {availablePorts.map((port) => (
                  <option key={port.path} value={port.path}>
                    {port.friendlyName || port.manufacturer || port.path}
                  </option>
                ))}
              </select>
              <button
                className="btn btn-outline btn-sm"
                onClick={listAvailablePorts}
                disabled={isScanning || isAutoConnecting}
                style={{ minWidth: 28, padding: 0 }}
              >
                <RefreshCw size={12} className={isScanning ? "animate-spin" : ""} />
              </button>
            </div>

            <select
              className="form-select text-xs px-1 py-1"
              value={state.baudRate.toString()}
              onChange={(e) => updateState({ baudRate: Number.parseInt(e.target.value) })}
              style={{ fontSize: "0.85rem" }}
              disabled={isAutoConnecting}
            >
              {baudRates.map((rate) => (
                <option key={rate} value={rate.toString()}>
                  {rate} baud
                </option>
              ))}
            </select>

            {/* Manual Connect/Disconnect button */}
            <button
              className={`btn ${isConnected ? "btn-outline" : "btn-primary"} w-full btn-sm`}
              onClick={handleConnect}
              disabled={!state.selectedPort || isConnecting || isAutoConnecting}
              style={{ fontSize: "0.9rem", padding: "0.4rem 0" }}
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
            
            {/* Auto-connect button */}
            <button
              className="btn btn-outline w-full btn-sm"
              onClick={handleAutoConnect}
              disabled={isScanning || isConnecting || isAutoConnecting}
              style={{ fontSize: "0.9rem", padding: "0.4rem 0" }}
            >
              {isAutoConnecting ? (
                "Auto-connecting..."
              ) : (
                <>
                  <Wifi size={13} className="mr-2" />
                  Auto-connect
                </>
              )}
            </button>

            {/* Reset Device button */}
            <button
              className="btn btn-outline w-full mt-2"
              onClick={reset}
              disabled={!isConnected}
            >
              <RotateCw size={14} className="mr-2" />
              Reset Device
            </button>

            {error && (
              <div className="bg-red-900/30 border border-red-800 p-1 rounded text-xs text-red-400">{error}</div>
            )}
          </CollapsibleSection>

          {/* Monitoring section */}
          <CollapsibleSection title="Monitoring">
            <div className="form-control mb-2">
              <label className="form-label">Current Angle (°)</label>
              <div
                className="form-input bg-gray-800 text-yellow-400 font-mono text-center text-base px-1 py-1"
                style={{ fontSize: "1rem", width: "100%", minWidth: 0, padding: "0.3rem 0.2rem" }}
              >
                {Math.round(filteredAngle)}°
              </div>
            </div>

            <div className="form-control mb-2">
              <label className="form-label">Velocity (RPM)</label>
              <div
                className="form-input bg-gray-800 text-blue-400 font-mono text-center text-base px-1 py-1"
                style={{ fontSize: "1rem", width: "100%", minWidth: 0, padding: "0.3rem 0.2rem" }}
              >
                {Math.abs(state.currentVelocity) <= 4 ? '0.0' : state.currentVelocity.toFixed(1)} RPM
              </div>
            </div>

            <div className="form-control mb-2">
              <label className="form-label">Torque (Nm)</label>
              <div
                className="form-input bg-gray-800 text-purple-400 font-mono text-center text-base px-1 py-1"
                style={{ fontSize: "1rem", width: "100%", minWidth: 0, padding: "0.3rem 0.2rem" }}
              >
                {(state.currentTorque).toFixed(2)} Nm
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
                style={{ fontSize: "0.9rem", width: "100%", minWidth: 0, padding: "0.2rem 0.2rem" }}
              />
            </div>

            <div className="flex space-x-1">
              <button
                className="btn btn-outline btn-sm flex-1"
                onClick={requestCurrentAngle}
                disabled={!isConnected}
                style={{ fontSize: "0.85rem", padding: "0.2rem 0" }}
              >
                <Target size={11} className="mr-1" />
                Angle
              </button>
              <button
                className="btn btn-outline btn-sm flex-1"
                onClick={requestCurrentVelocity}
                disabled={!isConnected}
                style={{ fontSize: "0.85rem", padding: "0.2rem 0" }}
              >
                <Zap size={11} className="mr-1" />
                Velocity
              </button>
            </div>
          </CollapsibleSection>
        </div>
      </ScrollArea>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0 min-h-0 overflow-auto">
        {/* Header */}
        <header
          className="flex h-14 items-center gap-4 border-b border-gray-700 px-6 min-w-0 bg-gray-900 w-full"
          style={{ paddingTop: "0.5rem", paddingBottom: "0.5rem" }}
        >
          <div className="badge badge-gray text-base" style={{ padding: "0.5rem 1rem", fontWeight: 600 }}>
            {hapticModes.find((m) => m.id === state.mode)?.label} -{" "}
            {state.deviceType === "knob" ? "Knob" : "Steering Wheel"}
          </div>
          {state.isPolling && isConnected && (
            <div className="badge badge-yellow text-xs" style={{ marginLeft: 8 }}>
              Polling {state.pollInterval}ms
            </div>
          )}
          {isConnected && (
            <div className="badge badge-gray text-xs" style={{ marginLeft: 8 }}>
              {state.selectedPort} @ {state.baudRate} baud
            </div>
          )}
        </header>

        {/* Content container with vertical centering */}
        <div className="flex-1 flex flex-col items-center justify-center p-4">
          {/* Dial Container - side by side layout with centered main dial */}
          <div className="flex justify-center items-center" style={{ width: "100%", maxWidth: 1200 }}>
            {/* Torque Dial */}
            <div className="flex-1 flex justify-end" style={{ width: 250, height: 100, marginRight: "20px" }}>
              <TorqueDial
                velocity={state.currentTorque}
                isConnected={isConnected}
                isDeviceResponding={isDeviceResponding}
              />
            </div>

            {/* Main Dial */}
            <div className="shrink-0" style={{ width: 400 }}>
              {state.deviceType === "knob" ? (
                <DialVisualization
                  mode={state.mode}
                  angle={filteredAngle}
                  velocity={state.currentVelocity}
                  torque={state.currentTorque}
                  targetAngle={state.targetAngle}
                  endstopMinAngle={state.endstopMinAngle}
                  endstopMaxAngle={state.endstopMaxAngle}
                  isConnected={isConnected}
                  lastUpdate={lastAngleUpdate}
                  isDeviceResponding={isDeviceResponding}
                  deviceType="knob"
                />
              ) : (
                <SteeringWheelVisualization
                  mode={state.mode}
                  angle={filteredAngle}
                  velocity={state.currentVelocity}
                  torque={state.currentTorque}
                  targetAngle={state.targetAngle}
                  endstopMinAngle={state.endstopMinAngle}
                  endstopMaxAngle={state.endstopMaxAngle}
                  isConnected={isConnected}
                  lastUpdate={lastAngleUpdate}
                  isDeviceResponding={isDeviceResponding}
                  deviceType={state.deviceType}
                />
              )}
            </div>

            {/* Velocity Dial */}
            <div className="flex-1 flex justify-start" style={{ width: 250, height: 100, marginLeft: "20px" }}>
              <VelocityDial
                velocity={state.currentVelocity}
                isConnected={isConnected}
                isDeviceResponding={isDeviceResponding}
              />
            </div>
          </div>

          {/* Controls below dial */}
          <div className="w-full max-w-2xl flex flex-col items-center mt-4">
            {state.mode === "increased-torque" && (
              <div className="form-control" style={{ maxWidth: 220, margin: "0 auto" }}>
                <label className="form-label">Torque (0.0 - 2.0)</label>
                <input
                  type="number"
                  className="form-input text-sm px-2 py-1"
                  min="0"
                  max="1"
                  step="0.1"
                  value={state.torque}
                  onChange={(e) => updateState({ torque: Number.parseFloat(e.target.value) || 0 })}
                  style={{ fontSize: "1rem", width: "100%" }}
                />
                <div className="text-xs text-gray-400 mt-1">Current: {state.torque.toFixed(1)}</div>
              </div>
            )}

            {state.mode === "proportional-control" && (
              <div className="form-control" style={{ maxWidth: 220, margin: "0 auto" }}>
                <label className="form-label">Stiffness</label>
                <input
                  type="number"
                  className="form-input text-sm px-2 py-1"
                  min="0"
                  max="2"
                  step="0.1"
                  value={state.stiffness}
                  onChange={(e) => updateState({ stiffness: Number.parseFloat(e.target.value) || 0 })}
                  style={{ fontSize: "1rem", width: "100%" }}
                />
                <div className="text-xs text-gray-400 mt-1">Current: {state.stiffness.toFixed(1)}</div>
              </div>
            )}

            {state.mode === "endstops" && (
              <div className="flex flex-col space-y-4" style={{ maxWidth: 220, margin: "0 auto" }}>
                <div className="form-control">
                  <label className="form-label">Endstop Mode</label>
                  <select
                    className="form-select text-sm px-2 py-1"
                    value={state.endstopMode}
                    onChange={(e) => {
                      const newMode = e.target.value as EndstopMode
                      updateState({ endstopMode: newMode })
                      if (isConnected && window.electronAPI) {
                        sendTFDConfig()
                      }
                    }}
                    style={{ fontSize: "1rem", width: "100%" }}
                  >
                    <option value="none">None</option>
                    <option value="proportional">Proportional</option>
                    <option value="soft">Soft Detents</option>
                    <option value="medium">Medium Detents</option>
                    <option value="rough">Rough Detents</option>
                    <option value="center">Center Detent</option>
                  </select>
                </div>

                <div className="form-control">
                  <label className="form-label">Turns Lock-to-Lock</label>
                  <input
                    type="number"
                    className="form-input text-sm px-2 py-1"
                    min="0.0"
                    max="10"
                    step="0.5"
                    value={state.endstopTurns}
                    onChange={(e) => {
                      const newTurns = Number.parseFloat(e.target.value) || 0.5
                      updateState({ endstopTurns: newTurns })
                      if (isConnected && window.electronAPI) {
                        sendTFDConfig()
                      }
                    }}
                    style={{ fontSize: "1rem", width: "100%" }}
                  />
                  <div className="text-xs text-gray-400 mt-1">
                    Range: {state.endstopMinAngle.toFixed(0)}° to {state.endstopMaxAngle.toFixed(0)}°
                  </div>
                </div>

                <div className="flex items-center justify-between">
                  <button
                    className={`tab relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${
                      state.isSticky ? "active" : ""
                    }`}
                    onClick={() => {
                      const newSticky = !state.isSticky
                      updateState({ isSticky: newSticky })
                      if (isConnected && window.electronAPI) {
                        window.electronAPI.serialWrite(`set sticky:${newSticky ? "on" : "off"}\n`)
                      }
                    }}
                  >
                  </button>

                <button
                  className="btn btn-outline btn-sm flex-1"
                  onClick={() => {
                    const newSticky = !state.isSticky
                    updateState({ isSticky: newSticky })
                    if (isConnected && window.electronAPI) {
                      window.electronAPI.serialWrite(`set sticky:${newSticky ? "on" : "off"}\n`)
                    }
                  }}
                  disabled={!state.isSticky}
                  style={{ fontSize: "0.85rem", padding: "0.2rem 0" }}
                >
                  Sticky
                </button>
                </div>
              </div>
            )}

            {state.mode === "inertial-control" && (
              <div className="form-control" style={{ maxWidth: 220, margin: "0 auto" }}>
                <label className="form-label">Inertia Factor</label>
                <input
                  type="number"
                  className="form-input text-sm px-2 py-1"
                  min="0"
                  max="5"
                  step="0.1"
                  value={state.stiffness}
                  onChange={(e) => updateState({ stiffness: Number.parseFloat(e.target.value) || 0 })}
                  style={{ fontSize: "1rem", width: "100%" }}
                />
                <div className="text-xs text-gray-400 mt-1">Current: {state.stiffness.toFixed(1)}</div>
              </div>
            )}
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
  deviceType: DeviceType
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
  deviceType,
}: DialVisualizationProps) {
  // Helper to wrap angle to -180 to 180
  const wrap180 = (angle: number) => {
    while (angle <= -180.0) angle += 360.0;
    while (angle > 180.0) angle -= 360.0;
    const a = angle;
    return a;
  }

  const getStrokeWidth = () => {
    if (mode === "increased-torque") {
      return 3 + torque * 10
    }
    if (mode === "proportional-control") {
      const distance = Math.abs(angle - targetAngle)
      return 3 + (distance / 180) * 10
    }
    return 3
  }

  const getDialOpacity = () => {
    if (!isConnected) return 0.3
    if (mode === "lock") return 0.5 // Reduced opacity for lock mode
    return 1
  }

  const getDialColor = () => {
    if (!isConnected) return "#6b7280"
    if (!isDeviceResponding) return "#ef4444"
    if (lastUpdate && Date.now() - lastUpdate.getTime() > 1000) return "#ef4444"
    return "#eab308"
  }

  const getDisplayAngle = () => {
    if (mode === "endstops") {
      const clampedAngle = Math.max(endstopMinAngle, Math.min(endstopMaxAngle, angle))
      const wrapAngle = (a: number) => (((a % 360) + 540) % 360) - 180
      const minWrapped = wrapAngle(endstopMinAngle)
      const maxWrapped = wrapAngle(endstopMaxAngle)
      const minDisplay = (minWrapped + 360) % 360
      const maxDisplay = (maxWrapped + 360) % 360
      const t = (clampedAngle - endstopMinAngle) / (endstopMaxAngle - endstopMinAngle)
      let angleSpan = maxDisplay - minDisplay
      if (angleSpan === 0) {
        return (minDisplay + t * 360) % 360
      }
      if (angleSpan < 0) angleSpan += 360
      return (minDisplay + t * angleSpan) % 360
    }
    return ((angle % 360) + 360) % 360
  }

  const displayAngle = getDisplayAngle()

  const renderDetents = (count: number, style: "soft" | "medium" | "rough" | "center" | "latch") => {
    const detentElements = []
    const angleStep = 360 / count
    const strokeWidth = style === "latch" ? 3 : style === "rough" ? 2 : style === "medium" ? 1.5 : 1
    const radius = style === "latch" ? 85 : style === "rough" ? 87 : style === "medium" ? 88 : 89

    for (let i = 0; i < count; i++) {
      const detentAngle = i * angleStep
      const x1 = radius * Math.cos((detentAngle - 2) * (Math.PI / 180))
      const y1 = radius * Math.sin((detentAngle - 2) * (Math.PI / 180))
      const x2 = radius * Math.cos((detentAngle + 2) * (Math.PI / 180))
      const y2 = radius * Math.sin((detentAngle + 2) * (Math.PI / 180))

      detentElements.push(
        <line
          key={`detent-${i}`}
          x1={x1}
          y1={y1}
          x2={x2}
          y2={y2}
          stroke="white"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
        />
      )
    }
    return detentElements
  }

  const renderEndstops = () => {
    const wrapAngle = (angle: number) => {
      return (((angle % 360) + 540) % 360) - 180
    }

    const minWrappedAngle = wrapAngle(endstopMinAngle)
    const maxWrappedAngle = wrapAngle(endstopMaxAngle)

    const minDisplayAngle = (minWrappedAngle + 360) % 360
    const maxDisplayAngle = (maxWrappedAngle + 360) % 360

    const minX = 200 + Math.cos(((minDisplayAngle - 90) * Math.PI) / 180) * 180
    const minY = 200 + Math.sin(((minDisplayAngle - 90) * Math.PI) / 180) * 180
    const maxX = 200 + Math.cos(((maxDisplayAngle - 90) * Math.PI) / 180) * 180
    const maxY = 200 + Math.sin(((maxDisplayAngle - 90) * Math.PI) / 180) * 180

    const minIndicatorX = 200 + Math.cos(((minDisplayAngle - 90) * Math.PI) / 180) * 200
    const minIndicatorY = 200 + Math.sin(((minDisplayAngle - 90) * Math.PI) / 180) * 200
    const maxIndicatorX = 200 + Math.cos(((maxDisplayAngle - 90) * Math.PI) / 180) * 200
    const maxIndicatorY = 200 + Math.sin(((maxDisplayAngle - 90) * Math.PI) / 180) * 200

    const minTextX = 200 + Math.cos(((minDisplayAngle - 90) * Math.PI) / 180) * 240
    const minTextY = 200 + Math.sin(((minDisplayAngle - 90) * Math.PI) / 180) * 240
    const maxTextX = 200 + Math.cos(((maxDisplayAngle - 90) * Math.PI) / 180) * 240
    const maxTextY = 200 + Math.sin(((maxDisplayAngle - 90) * Math.PI) / 180) * 240

    return (
      <>
        <line x1={minX} y1={minY} x2={minIndicatorX} y2={minIndicatorY} stroke="red" strokeWidth="6" />
        <text x={minTextX} y={minTextY} textAnchor="middle" fill="red" fontSize="18" fontWeight="bold">
          MIN
        </text>
        <text x={minTextX} y={minTextY + 22} textAnchor="middle" fill="red" fontSize="16" fontWeight="bold">
          {endstopMinAngle.toFixed(0)}°
        </text>

        <line x1={maxX} y1={maxY} x2={maxIndicatorX} y2={maxIndicatorY} stroke="red" strokeWidth="6" />
        <text x={maxTextX} y={maxTextY} textAnchor="middle" fill="red" fontSize="18" fontWeight="bold">
          MAX
        </text>
        <text x={maxTextX} y={maxTextY + 22} textAnchor="middle" fill="red" fontSize="16" fontWeight="bold">
          {endstopMaxAngle.toFixed(0)}°
        </text>
      </>
    )
  }

  const renderDirectionalArrow = (clockwise: boolean) => {
    const iconSize = 60
    const iconColor = "#eab308"

    return (
      <g>
        {clockwise ? (
          <RotateCw size={iconSize} color={iconColor} x={200 - iconSize / 2} y={200 - iconSize / 2} />
        ) : (
          <RotateCcw size={iconSize} color={iconColor} x={200 - iconSize / 2} y={200 - iconSize / 2} />
        )}
      </g>
    )
  }

  const renderTargetIndicator = () => {
    if (mode !== "proportional-control") return null

    const adjustedTargetAngle = targetAngle + 180
    const targetX = 200 + Math.cos(((adjustedTargetAngle - 90) * Math.PI) / 180) * 160
    const targetY = 200 + Math.sin(((adjustedTargetAngle - 90) * Math.PI) / 180) * 160

    // return (
      // <g>
      //   <circle cx={targetX} cy={targetY} r="12" fill="none" stroke="yellow" strokeWidth="3" opacity={0.8} />
      //   <text x={targetX} y={targetY + 25} textAnchor="middle" fill="yellow" fontSize="10">
      //     Target
      //   </text>
      // </g>
    // )
    return null
  }

  const renderReferenceMark = () => {
    const radius = 190 // Slightly larger than the dial radius
    const markLength = 10
    const markAngleInRadians = -Math.PI / 2 // Angle for the top (0 degrees visual)
    const startX = radius * Math.cos(markAngleInRadians)
    const startY = radius * Math.sin(markAngleInRadians)
    const endX = (radius + markLength) * Math.cos(markAngleInRadians)
    const endY = (radius + markLength) * Math.sin(markAngleInRadians)

    return (
      <line
        x1={startX + 200}
        y1={startY + 200}
        x2={endX + 200}
        y2={endY + 200}
        stroke="currentColor"
        strokeWidth={2}
        opacity={0.8}
      />
    )
  }

  return (
    <div className="relative w-[400px] h-[400px]">
      <svg
        viewBox="0 0 400 400"
        className="w-full h-full"
        style={{ opacity: getDialOpacity() }}
      >
        <defs>
          <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
            <polygon points="0 0, 10 3.5, 0 7" fill="currentColor" />
          </marker>
        </defs>

        <circle cx="200" cy="200" r="180" fill="none" stroke={getDialColor()} strokeWidth={getStrokeWidth()} />

        {mode === "soft-detents" && renderDetents(12, "soft")}
        {mode === "medium-detents" && renderDetents(12, "medium")}
        {mode === "rough-detents" && renderDetents(12, "rough")}
        {mode === "center-detent" && renderDetents(1, "center")}
        {mode === "latch" && renderDetents(12, "latch")}
        {mode === "endstops" && renderEndstops()}
        {mode === "clockwise" && renderDirectionalArrow(true)}
        {mode === "counterclockwise" && renderDirectionalArrow(false)}
        {renderTargetIndicator()}

        {mode === "lock" && (
          <g transform="translate(185, 185)">
            <rect x="5" y="15" width="20" height="15" rx="2" fill="none" stroke="currentColor" strokeWidth="3" />
            <path d="M10 15V10a5 5 0 0 1 10 0v5" fill="none" stroke="currentColor" strokeWidth="3" />
          </g>
        )}

        <line
          x1="200"
          y1="200"
          x2={200 + Math.cos(((displayAngle - 90) * Math.PI) / 180) * 150}
          y2={200 + Math.sin(((displayAngle - 90) * Math.PI) / 180) * 150}
          stroke={getDialColor()}
          strokeWidth="4"
          strokeLinecap="round"
        />

        <circle cx="200" cy="200" r="8" fill={getDialColor()} />

        <text x="200" y="250" textAnchor="middle" fill={getDialColor()} fontSize="16" fontWeight="bold">
          {mode === "endstops" ? Math.round(angle) + "°" : Math.round(wrap180(angle)) + "°"}
        </text>

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

        {mode === "endstops" && (
          <text x="200" y="290" textAnchor="middle" fill={getDialColor()} fontSize="12">
            {(angle / 360).toFixed(2)} turns
          </text>
        )}
        {renderReferenceMark()}
      </svg>
    </div>
  )
}

// New Steering Wheel Visualization Component
interface SteeringWheelVisualizationProps {
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
  deviceType: DeviceType
}

function SteeringWheelVisualization({
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
  deviceType,
}: SteeringWheelVisualizationProps) {
  const wrap180 = (angle: number) => {
    // const a = ((((angle + 180) % 360) + 360) % 360) - 180
    while (angle <= -180.0) angle += 360.0;
    while (angle > 180.0) angle -= 360.0;
    const a = angle;
    return a
  }

  const getStrokeWidth = () => {
    if (mode === "increased-torque") {
      return 8 + torque * 15 // Thicker for steering wheel
    }
    if (mode === "proportional-control") {
      const distance = Math.abs(angle - targetAngle)
      return 8 + (distance / 180) * 15
    }
    if (mode === "inertial-control") {
      return 12 // Thick for inertial control
    }
    return 8
  }

  const getDialOpacity = () => {
    if (!isConnected) return 0.3
    if (mode === "lock") return 0.5 // Reduced opacity for lock mode
    return 1
  }

  const getDialColor = () => {
    if (!isConnected) return "#6b7280"
    if (!isDeviceResponding) return "#ef4444"
    if (lastUpdate && Date.now() - lastUpdate.getTime() > 1000) return "#ef4444"
    return "#facc15" // Green for steering wheel
  }

  const getDisplayAngle = () => {
    if (mode === "endstops") {
      const clampedAngle = Math.max(endstopMinAngle, Math.min(endstopMaxAngle, angle))
      const wrapAngle = (a: number) => (((a % 360) + 540) % 360) - 180
      const minWrapped = wrapAngle(endstopMinAngle)
      const maxWrapped = wrapAngle(endstopMaxAngle)
      const minDisplay = (minWrapped + 360) % 360
      const maxDisplay = (maxWrapped + 360) % 360
      const t = (clampedAngle - endstopMinAngle) / (endstopMaxAngle - endstopMinAngle)
      let angleSpan = maxDisplay - minDisplay
      if (angleSpan === 0) {
        return (minDisplay + t * 360) % 360
      }
      if (angleSpan < 0) angleSpan += 360
      return (minDisplay + t * angleSpan) % 360
    }
    return ((angle % 360) + 360) % 360
  }

  const displayAngle = getDisplayAngle()

  const renderDetents = (count: number, style: "soft" | "medium" | "rough" | "center") => {
    if (style === "center") {
      const detentAngle = 0
      const x1 = 200 + Math.cos(((detentAngle - 90) * Math.PI) / 180) * 180
      const y1 = 200 + Math.sin(((detentAngle - 90) * Math.PI) / 180) * 180
      const x2 = 200 + Math.cos(((detentAngle - 90) * Math.PI) / 180) * (180 - 20)
      const y2 = 200 + Math.sin(((detentAngle - 90) * Math.PI) / 180) * (180 - 20)
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
        />,
      ]
    }
    const detents = []
    let spacing = 15,
      width = 2
    if (style === "rough") {
      spacing = 36
      width = 1
    } else if (style === "medium") {
      spacing = 18
      width = 1
    } else if (style === "soft") {
      spacing = 2
      width = 1
    }
    const detentCount = Math.round(360 / spacing)
    for (let i = 0; i < detentCount; i++) {
      const detentAngle = i * spacing
      const x1 = 200 + Math.cos(((detentAngle - 90) * Math.PI) / 180) * 180
      const y1 = 200 + Math.sin(((detentAngle - 90) * Math.PI) / 180) * 180
      const x2 = 200 + Math.cos(((detentAngle - 90) * Math.PI) / 180) * (180 - 20)
      const y2 = 200 + Math.sin(((detentAngle - 90) * Math.PI) / 180) * (180 - 20)
      detents.push(
        <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="currentColor" strokeWidth={width} opacity={0.6} />,
      )
    }
    return detents
  }

  const renderSteeringWheelSpokes = () => {
    const spokeAngles = [-90, 180, 90] // Three spokes at 90° intervals in the bottom half (relative to 180 deg)
    const hubRadius = 60;
    const rimRadius = 180;

    return spokeAngles.map((spokeAngle, index) => {
      const adjustedAngle = spokeAngle + displayAngle;
      const startX = 200 + Math.cos(((adjustedAngle - 90) * Math.PI) / 180) * hubRadius;
      const startY = 200 + Math.sin(((adjustedAngle - 90) * Math.PI) / 180) * hubRadius;
      const endX = 200 + Math.cos(((adjustedAngle - 90) * Math.PI) / 180) * rimRadius;
      const endY = 200 + Math.sin(((adjustedAngle - 90) * Math.PI) / 180) * rimRadius;

      const strokeWidth = 7; // Standard stroke width for all spokes

      return (
        <line
          key={index}
          x1={startX}
          y1={startY}
          x2={endX}
          y2={endY}
          stroke={getDialColor()}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
        />
      );
    });
  };

  const renderSteeringWheelGrips = () => {
    return null; // Removed grips as per the new design
  };

  const renderEndstops = () => {
    const wrapAngle = (angle: number) => {
      return (((angle % 360) + 540) % 360) - 180
    }

    const minWrappedAngle = wrapAngle(endstopMinAngle)
    const maxWrappedAngle = wrapAngle(endstopMaxAngle)

    const minDisplayAngle = (minWrappedAngle + 360) % 360
    const maxDisplayAngle = (maxWrappedAngle + 360) % 360

    const minX = 200 + Math.cos(((minDisplayAngle - 90) * Math.PI) / 180) * 180
    const minY = 200 + Math.sin(((minDisplayAngle - 90) * Math.PI) / 180) * 180
    const maxX = 200 + Math.cos(((maxDisplayAngle - 90) * Math.PI) / 180) * 180
    const maxY = 200 + Math.sin(((maxDisplayAngle - 90) * Math.PI) / 180) * 180

    const minIndicatorX = 200 + Math.cos(((minDisplayAngle - 90) * Math.PI) / 180) * 200
    const minIndicatorY = 200 + Math.sin(((minDisplayAngle - 90) * Math.PI) / 180) * 200
    const maxIndicatorX = 200 + Math.cos(((maxDisplayAngle - 90) * Math.PI) / 180) * 200
    const maxIndicatorY = 200 + Math.sin(((maxDisplayAngle - 90) * Math.PI) / 180) * 200

    const minTextX = 200 + Math.cos(((minDisplayAngle - 90) * Math.PI) / 180) * 240
    const minTextY = 200 + Math.sin(((minDisplayAngle - 90) * Math.PI) / 180) * 240
    const maxTextX = 200 + Math.cos(((maxDisplayAngle - 90) * Math.PI) / 180) * 240
    const maxTextY = 200 + Math.sin(((maxDisplayAngle - 90) * Math.PI) / 180) * 240

    return (
      <>
        <line x1={minX} y1={minY} x2={minIndicatorX} y2={minIndicatorY} stroke="red" strokeWidth="8" />
        <text x={minTextX} y={minTextY} textAnchor="middle" fill="red" fontSize="18" fontWeight="bold">
          L
        </text>

        <line x1={maxX} y1={maxY} x2={maxIndicatorX} y2={maxIndicatorY} stroke="red" strokeWidth="8" />
        <text x={maxTextX} y={maxTextY} textAnchor="middle" fill="red" fontSize="18" fontWeight="bold">
          R
        </text>
      </>
    )
  }

  const renderInertialIndicator = () => {
    if (mode !== "inertial-control") return null

    // Show velocity-based inertial effect as trailing indicators
    const trailCount = 5
    const trailElements = []

    for (let i = 0; i < trailCount; i++) {
      const trailAngle = displayAngle - velocity * 0.1 * (i + 1)
      const opacity = 1 - i * 0.2
      const x = 200 + Math.cos(((trailAngle - 90) * Math.PI) / 180) * 140
      const y = 200 + Math.sin(((trailAngle - 90) * Math.PI) / 180) * 140

      trailElements.push(<circle key={i} cx={x} cy={y} r="4" fill={getDialColor()} opacity={opacity} />)
    }

    return <g>{trailElements}</g>
  }

  const renderReferenceMark = () => {
    const radius = 190 // Slightly larger than the wheel radius
    const markLength = 10
    const markAngleInRadians = -Math.PI / 2 // Angle for the top (0 degrees visual)
    const startX = radius * Math.cos(markAngleInRadians)
    const startY = radius * Math.sin(markAngleInRadians)
    const endX = (radius + markLength) * Math.cos(markAngleInRadians)
    const endY = (radius + markLength) * Math.sin(markAngleInRadians)

    return (
      <line
        x1={startX + 200}
        y1={startY + 200}
        x2={endX + 200}
        y2={endY + 200}
        stroke="currentColor"
        strokeWidth={2}
        opacity={0.8}
      />
    )
  }

  return (
    <div className="relative w-[400px] h-[400px]">
      <svg
        viewBox="0 0 400 400"
        className="w-full h-full"
        style={{ opacity: getDialOpacity() }}
      >
        {/* Outer steering wheel rim */}
        <circle cx="200" cy="200" r="180" fill="none" stroke={getDialColor()} strokeWidth={getStrokeWidth()} />

        {/* Inner hub - now a larger, slightly offset rectangle for the airbag/horn */}
        {/* <rect x="150" y="170" width="100" height="60" rx="10" ry="10" fill="#333" stroke={getDialColor()} strokeWidth="3" /> */}
        <circle cx="200" cy="200" r="60" fill={getDialColor()} /> {/* Inner circle for horn button */}
        <circle cx="200" cy="200" r="50" fill="#111827" />

        {/* Steering wheel spokes */}
        {renderSteeringWheelSpokes()}

        {/* Mode-specific elements */}
        {mode === "endstops" && renderEndstops()}
        {mode === "inertial-control" && renderInertialIndicator()}

        {/* Top indicator (12 o'clock position) - now a simple line mark on the rim */}
        {/* <line x1="200" y1="20" x2="200" y2="40" stroke={getDialColor()} strokeWidth="4" strokeLinecap="round" /> */}

        {/* Angle display */}
        <text x="200" y="210" textAnchor="middle" fill={getDialColor()} fontSize="16" fontWeight="bold">
          {mode === "endstops" ? Math.round(angle) + "°" : Math.round(wrap180(angle)) + "°"}
        </text>

        {/* Connection status indicator */}
        {!isConnected && (
          <text x="200" y="340" textAnchor="middle" fill="#6b7280" fontSize="14">
            Not Connected
          </text>
        )}
        {isConnected && !isDeviceResponding && (
          <text x="200" y="340" textAnchor="middle" fill="#f59e0b" fontSize="14">
            Device Not Responding
          </text>
        )}

        {mode == "center-detent" && (
          renderDetents(1, "center")
        )}

        {/* Multi-turn indicator for endstops */}
        {mode === "endstops" && (
          <text x="200" y="320" textAnchor="middle" fill={getDialColor()} fontSize="12">
            {(angle / 360).toFixed(2)} turns
          </text>
        )}
        {renderReferenceMark()}
      </svg>
    </div>
  )
}

// Helper function to format haptic commands using your protocol
function formatTFDCommand(config: TFDState): string {
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
      switch (config.endstopMode) {
        case "proportional":
          return `set endstops-proportional:${config.endstopTurns.toFixed(1)}\n`
        case "soft":
          return `set endstops-ultra:${config.endstopTurns.toFixed(1)}\n`
        case "medium":
          return `set endstops-fine:${config.endstopTurns.toFixed(1)}\n`
        case "rough":
          return `set endstops-coarse:${config.endstopTurns.toFixed(1)}\n`
        case "center":
          return `set endstops-center:${config.endstopTurns.toFixed(1)}\n`
        default:
          return `set endstops:${config.endstopTurns.toFixed(1)}\n`
      }
    case "center-detent":
      return "set detent:center\n"
    case "proportional-control":
      return `set proportional:${config.targetAngle.toFixed(1)},${config.stiffness.toFixed(1)}\n`
    case "inertial-control":
      return `set inertial:${config.stiffness.toFixed(1)}\n`
    case "latch":
      return "set latch\n"
    default:
      return "set normal\n"
  }
}

// Velocity Dial component (Speedometer) - Now displays Torque (0-1 Nm)
interface TorqueDialProps {
  velocity: number; // This prop will now be used for torque
  isConnected: boolean
  isDeviceResponding: boolean
}

function TorqueDial({ velocity: torqueValue, isConnected, isDeviceResponding }: TorqueDialProps) {
  const getDialOpacity = () => {
    return isConnected ? (isDeviceResponding ? 1 : 0.5) : 0.3
  }
  // Scale torque input (0-1) to dial sweep angle
  const maxInputTorque = 2.0;
  const minInputTorque = 0.0;

  // Clamp the input torqueValue to the expected range (0 to 1) for display
  const clampedTorque = Math.max(minInputTorque, Math.min(maxInputTorque, torqueValue));

  const startSweepAngle = -135;
  const endSweepAngle = 135;
  const totalSweepAngle = endSweepAngle - startSweepAngle;

  // Normalize the clamped torque from the 0-1 range to the 0-1 scale for interpolation
  const normalizedTorque = (clampedTorque - minInputTorque) / (maxInputTorque - minInputTorque);

  // Map the normalized torque to the dial's sweep angle
  const pointerAngle = startSweepAngle + normalizedTorque * totalSweepAngle;

  const dialColor = !isConnected ? "#6b7280" : !isDeviceResponding ? "#ef4444" : "#facc15";

  const svgSize = 200
  const centerX = svgSize / 2;
  const centerY = svgSize / 2;
  const radius = svgSize / 2 - 10; // Adjusted for smaller size

  // Define the start and end points for the needle, offset from the center
  const needleInnerRadius = radius * 0.4; 
  const needleOuterRadius = radius - 5;

  const needleStartX = centerX + Math.cos(((pointerAngle - 90) * Math.PI) / 180) * needleInnerRadius;
  const needleStartY = centerY + Math.sin(((pointerAngle - 90) * Math.PI) / 180) * needleInnerRadius;
  const needleEndX = centerX + Math.cos(((pointerAngle - 90) * Math.PI) / 180) * needleOuterRadius;
  const needleEndY = centerY + Math.sin(((pointerAngle - 90) * Math.PI) / 180) * needleOuterRadius;

  return (
    <svg
      width={svgSize}
      height={svgSize}
      viewBox={`0 0 ${svgSize} ${svgSize}`}
      className="pointer-events-none"
      style={{ opacity: getDialOpacity() }}
    >
      {/* Outer circle */}
      <circle cx={centerX} cy={centerY} r={radius} fill="none" stroke={dialColor} strokeWidth="4" />

      {/* Center circle */}
      <circle cx={centerX} cy={centerY} r="4" fill={dialColor} />

      {/* Needle */}
      <line
        x1={needleStartX}
        y1={needleStartY}
        x2={needleEndX}
        y2={needleEndY}
        stroke={dialColor}
        strokeWidth="3" // Thinner needle for smaller dial
        strokeLinecap="round"
      />

      {/* Display torque value */}
      <text x={centerX} y={centerY + 15} textAnchor="middle" fill={dialColor} fontSize="14" fontWeight="bold">
        {clampedTorque.toFixed(2)} Nm
      </text>

      {/* Update dial labels to 0, 0.5, and 1.0 for Torque */}
      <text
        x={centerX + Math.cos(((startSweepAngle - 90) * Math.PI) / 180) * (radius + 30)}
        y={centerY + Math.sin(((startSweepAngle - 90) * Math.PI) / 180) * (radius + 5)}
        textAnchor="end"
        fill={dialColor}
        fontSize="12"
      >
        0
      </text>
      <text
        x={centerX + Math.cos(((0 - 90) * Math.PI) / 180) * (radius + 5)}
        y={centerY + Math.sin(((0 - 90) * Math.PI) / 180) * (radius - 30)}
        textAnchor="middle"
        fill={dialColor}
        fontSize="12"
      >
        0.5
      </text>
      <text
        x={centerX + Math.cos(((endSweepAngle - 90) * Math.PI) / 180) * (radius + 30)}
        y={centerY + Math.sin(((endSweepAngle - 90) * Math.PI) / 180) * (radius + 5)}
        textAnchor="start"
        fill={dialColor}
        fontSize="12"
      >
        1.0
      </text>
    </svg>
  );
}

// New Velocity Dial Component
interface VelocityDialProps {
  velocity: number;
  isConnected: boolean;
  isDeviceResponding: boolean;
}

function VelocityDial({ velocity, isConnected, isDeviceResponding }: VelocityDialProps) {
  const getDialOpacity = () => {
    return isConnected ? (isDeviceResponding ? 1 : 0.5) : 0.3
  }
  const maxVelocity = 200; // Max RPM
  const minVelocity = -200;

  // Clamp the input velocity to the expected range
  const clamp = Math.max(minVelocity, Math.min(maxVelocity, velocity));
  const clampedVelocity = Math.abs(clamp) <= 4 ? 0.0 : clamp;

  const startSweepAngle = -135; // Same as TorqueDial
  const endSweepAngle = 135;    // Same as TorqueDial
  const totalSweepAngle = endSweepAngle - startSweepAngle;

  // Normalize the clamped velocity from the 0-1000 range to the 0-1 scale for interpolation
  const normalizedVelocity = (clampedVelocity - minVelocity) / (maxVelocity - minVelocity);

  // Map the normalized velocity to the dial's sweep angle
  const pointerAngle = startSweepAngle + normalizedVelocity * totalSweepAngle;

  const dialColor = !isConnected ? "#6b7280" : !isDeviceResponding ? "#ef4444" : "#3b82f6"; // Blue for velocity

  const svgSize = 200
  const centerX = svgSize / 2;
  const centerY = svgSize / 2;
  const radius = svgSize / 2 - 10;

  const needleInnerRadius = radius * 0.4;
  const needleOuterRadius = radius - 5;

  const needleStartX = centerX + Math.cos(((pointerAngle - 90) * Math.PI) / 180) * needleInnerRadius;
  const needleStartY = centerY + Math.sin(((pointerAngle - 90) * Math.PI) / 180) * needleInnerRadius;
  const needleEndX = centerX + Math.cos(((pointerAngle - 90) * Math.PI) / 180) * needleOuterRadius;
  const needleEndY = centerY + Math.sin(((pointerAngle - 90) * Math.PI) / 180) * needleOuterRadius;

  return (
    <svg
      width={svgSize}
      height={svgSize}
      viewBox={`0 0 ${svgSize} ${svgSize}`}
      className="pointer-events-none"
      style={{ opacity: getDialOpacity() }}
    >
      {/* Outer circle */}
      <circle cx={centerX} cy={centerY} r={radius} fill="none" stroke={dialColor} strokeWidth="4" />

      {/* Center circle */}
      <circle cx={centerX} cy={centerY} r="4" fill={dialColor} />

      {/* Needle */}
      <line
        x1={needleStartX}
        y1={needleStartY}
        x2={needleEndX}
        y2={needleEndY}
        stroke={dialColor}
        strokeWidth="3" // Thinner needle for smaller dial
        strokeLinecap="round"
      />

      {/* Display velocity value */}
      <text x={centerX} y={centerY + 15} textAnchor="middle" fill={dialColor} fontSize="14" fontWeight="bold">
        {clampedVelocity.toFixed(1)} RPM
      </text>

      {/* Dial labels: 0, 500, 1000 RPM */}
      <text
        x={centerX + Math.cos(((startSweepAngle - 90) * Math.PI) / 180) * (radius + 30)}
        y={centerY + Math.sin(((startSweepAngle - 90) * Math.PI) / 180) * (radius + 5)}
        textAnchor="end"
        fill={dialColor}
        fontSize="12"
      >
        -200
      </text>
      <text
        x={centerX + Math.cos(((0 - 90) * Math.PI) / 180) * (radius + 5)}
        y={centerY + Math.sin(((0 - 90) * Math.PI) / 180) * (radius - 30)}
        textAnchor="middle"
        fill={dialColor}
        fontSize="12"
      >
        0
      </text>
      <text
        x={centerX + Math.cos(((endSweepAngle - 90) * Math.PI) / 180) * (radius + 30)}
        y={centerY + Math.sin(((endSweepAngle - 90) * Math.PI) / 180) * (radius + 5)}
        textAnchor="start"
        fill={dialColor}
        fontSize="12"
      >
        200
      </text>
    </svg>
  );
}
