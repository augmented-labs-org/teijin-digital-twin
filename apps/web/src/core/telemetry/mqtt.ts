import mqtt, { type MqttClient } from "mqtt"

type MqttListener = (data: unknown) => void

/*

*/

const DEFAULT_URL = "ws://192.168.1.232:5000/mqtt"

/*

*/

export class MqttTelemetry {
    
    private client?: MqttClient
    private readonly listenersByTopic = new Map<string, MqttListener[]>()

    constructor(private readonly url: string = import.meta.env.VITE_MQTT_URL ?? DEFAULT_URL) {}

    register(topic: string, listener: MqttListener) {
        const existing = this.listenersByTopic.get(topic)
        if (existing) {
            existing.push(listener)
        } else {
            this.listenersByTopic.set(topic, [listener])
        }
    }

    /** Connect and subscribe. No-op if nothing is registered or already connected. */
    connect() {
        if (this.client || this.listenersByTopic.size === 0) {
            return
        }

        const client = mqtt.connect(this.url, {
            reconnectPeriod: 3000,
            connectTimeout: 8000,
            clean: true,
        })
        this.client = client

        client.on("connect", () => {
            console.log("[mqtt] connected")

            const topics = [...this.listenersByTopic.keys()]
            client.subscribe(topics, (err) => {
                if (err) {
                    console.error("[mqtt] subscribe failed", err)
                }
            })
        })

        client.on("message", (topic, payload) => {
            const listeners = this.listenersByTopic.get(topic)
            if (!listeners) {
                return
            }

            const parsed = JSON.parse(payload.toString())
            for (const listener of listeners) {
                listener(parsed)
            }
        })

        client.on("error", (err) => {
            console.error("[mqtt] client error", err)
        })
    }

    dispose() {
        // force-close without waiting for the broker to ack DISCONNECT.
        this.client?.end(true)
        this.client = undefined
    }
}
