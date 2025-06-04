# Haptic Knob Control Desktop App

A modern desktop application for controlling haptic knob devices with real-time serial communication.

## Quick Start

### Development
\`\`\`bash
# Install dependencies
npm install

# Run with Electron (recommended for Windows)
npm run electron:dev

# OR run with Tauri (smaller bundle)
npm run tauri:dev
\`\`\`

### Building for Production

#### Electron Build
\`\`\`bash
# Build installer for current platform
npm run electron:pack

# Build for distribution
npm run electron:dist

# Build and publish (if configured)
npm run electron:publish
\`\`\`

#### Tauri Build
\`\`\`bash
# Build for current platform
npm run tauri:build

# Build all bundle types
npm run tauri:bundle

# Debug build
npm run tauri:debug
\`\`\`

## Available Scripts

### Development
- `npm run dev` - Start Next.js development server
- `npm run electron:dev` - Start Electron app in development mode
- `npm run tauri:dev` - Start Tauri app in development mode
- `npm run desktop:dev` - Alias for electron:dev

### Building
- `npm run build` - Build Next.js app for production
- `npm run electron:pack` - Build Electron app installer
- `npm run tauri:build` - Build Tauri app
- `npm run desktop:build` - Alias for electron:pack
- `npm run desktop:tauri-build` - Alias for tauri:build

### Utilities
- `npm run lint` - Run ESLint
- `npm start` - Start production Next.js server

## Platform Support

### Electron
- ✅ Windows (NSIS installer + portable)
- ✅ macOS (DMG)
- ✅ Linux (AppImage + DEB)

### Tauri
- ✅ Windows (MSI installer)
- ✅ macOS (DMG + App Bundle)
- ✅ Linux (AppImage + DEB)

## Serial Communication

The app uses Node.js `serialport` for native serial communication:
- Automatic port discovery
- Configurable baud rates (9600-921600)
- Real-time command streaming
- Error handling and reconnection

## Features

- 🎛️ Interactive haptic knob visualization
- 🔌 Real-time serial communication
- 🎨 Modern dark UI with yellow accents
- ⚙️ 11 different haptic modes
- 📊 Live parameter adjustment
- 🔄 Device calibration and reset
- 💾 Configuration save/load
- ⌨️ Keyboard shortcuts

## Keyboard Shortcuts

### File Operations
- `Ctrl+N` - New Configuration
- `Ctrl+S` - Save Configuration
- `Ctrl+O` - Load Configuration
- `Ctrl+Q` - Exit

### Device Control
- `Ctrl+R` - Scan Serial Ports
- `Ctrl+Shift+C` - Connect to Device
- `Ctrl+D` - Disconnect from Device
- `Ctrl+Shift+R` - Reset Device
- `Ctrl+Shift+A` - Calibrate Device

### View
- `F5` - Reload Application
- `F12` - Toggle Developer Tools
- `F11` - Toggle Fullscreen

## Configuration

### Serial Protocol
Customize the serial protocol in `lib/serial-communication.ts`:

\`\`\`typescript
private formatCommand(command: SerialCommand): string {
  switch (command.command) {
    case "SET_MODE":
      return `MODE:${command.parameters?.mode}`
    // Add your device-specific commands here
  }
}
\`\`\`

### Build Configuration
- **Electron**: Edit `build` section in `package.json`
- **Tauri**: Edit `src-tauri/tauri.conf.json`

## Troubleshooting

### Serial Port Access
- **Windows**: No additional setup required
- **Linux**: Add user to `dialout` group: `sudo usermod -a -G dialout $USER`
- **macOS**: No additional setup required

### Build Issues
- Ensure Node.js 18+ is installed
- Clear node_modules and reinstall if needed
- Check platform-specific build requirements

## License

MIT License - see LICENSE file for details
