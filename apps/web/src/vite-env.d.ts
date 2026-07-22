/// <reference types="vite/client" />

interface ImportMetaEnv {
    /** WebSocket URL of the Coreflux MQTT broker (e.g. ws://192.168.1.232:1884/mqtt). */
    readonly VITE_COREFLUX_URL?: string
}

interface ImportMeta {
    readonly env: ImportMetaEnv
}
