// This wrapper allows us to conditionally import serialport only in Node.js environments

// Define types for our exports
interface SerialPortType {
    list?: () => Promise<any[]>;
    isOpen?: boolean;
    pipe?: (parser: any) => any;
    on?: (event: string, callback: any) => void;
    open?: (callback: (error?: Error | null) => void) => void;
    write?: (data: any, callback: (error?: Error | null) => void) => void;
    close?: (callback: (error?: Error | null) => void) => void;
  }
  
  interface ReadlineParserType {
    new(options: { delimiter: string }): any;
  }
  
  // Create dummy implementations for browser environment
  class DummySerialPort implements SerialPortType {
    isOpen = false;
  
    static list() {
      console.warn("SerialPort.list called in browser environment");
      return Promise.resolve([]);
    }
  
    constructor() {
      console.warn("SerialPort is not available in browser environment");
    }
  
    pipe() {
      return { on: () => {} };
    }
  
    on() {}
  
    open(callback: (error?: Error | null) => void) {
      callback(new Error("SerialPort is not available in browser environment"));
    }
  
    write(_data: any, callback: (error?: Error | null) => void) {
      callback(new Error("SerialPort is not available in browser environment"));
    }
  
    close(callback: (error?: Error | null) => void) {
      callback(null);
    }
  }
  
  class DummyReadlineParser {
    constructor() {
      console.warn("ReadlineParser is not available in browser environment");
    }
  }
  
  // Default to dummy implementations
  let SerialPort: any = DummySerialPort;
  let ReadlineParser: any = DummyReadlineParser;
  
  // Check if we're in a Node.js environment
  if (typeof window === 'undefined') {
    try {
      // In Node.js, we can safely use dynamic import
      const serialportModule = Function('return import("serialport")')();
      const parserModule = Function('return import("@serialport/parser-readline")')();
      
      // This will be executed asynchronously, but it's okay for our initialization
      Promise.all([serialportModule, parserModule]).then(([serialport, parser]) => {
        SerialPort = serialport.SerialPort;
        ReadlineParser = parser.ReadlineParser;
        console.log("SerialPort modules loaded successfully in Node.js environment");
      }).catch(error => {
        console.warn("Failed to load SerialPort modules:", error);
      });
    } catch (error) {
      console.warn("SerialPort module not available:", error);
    }
  }
  
  export { SerialPort, ReadlineParser };
  