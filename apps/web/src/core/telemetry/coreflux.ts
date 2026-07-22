import mqtt, { type MqttClient } from "mqtt"
import type { EntityStat } from "../building/entity"

/**
 * Default Coreflux broker endpoint. The broker serves MQTT-over-WebSocket on
 * port 1883 (the browser can only speak MQTT over WebSockets, not raw TCP).
 * Override with the VITE_COREFLUX_URL env var if your broker differs.
 */
const DEFAULT_URL = "ws://192.168.1.232:5000/mqtt"

/**
 * Bridges the Coreflux MQTT broker to the world's {@link EntityStat}s.
 *
 * Any stat carrying a {@link EntityStat.topic} is registered here; on connect we
 * subscribe to every distinct topic, and each incoming message writes the parsed
 * value straight into the stat's {@link EntityStat.value} (through its
 * {@link EntityStat.format}). The tag render loop already reads `stat.value`
 * every frame, so the detail cards update on their own — no other wiring needed.
 */
export class CorefluxTelemetry {
    private client?: MqttClient
    private readonly statsByTopic = new Map<string, EntityStat[]>()

    constructor(private readonly url: string = import.meta.env.VITE_COREFLUX_URL ?? DEFAULT_URL) {}

    /** Register a single stat if it declares a topic. Safe to call for any stat. */
    register(stat: EntityStat) {
        if (!stat.topic) {
            return
        }
        const existing = this.statsByTopic.get(stat.topic)
        if (existing) {
            existing.push(stat)
        } else {
            this.statsByTopic.set(stat.topic, [stat])
        }
    }

    /** Register every topic-bound stat across the given stat lists. */
    registerAll(stats: Iterable<EntityStat>) {
        for (const stat of stats) {
            this.register(stat)
        }
    }

    /** Connect and subscribe. No-op if nothing is registered or already connected. */
    connect() {
        if (this.client || this.statsByTopic.size === 0) {
            return
        }

        const client = mqtt.connect(this.url, {
            reconnectPeriod: 3000,
            connectTimeout: 8000,
            clean: true,
        })
        this.client = client

        client.on("connect", () => {
            const topics = [...this.statsByTopic.keys()]
            client.subscribe(topics, (err) => {
                if (err) {
                    console.error("[coreflux] subscribe failed", err)
                }
            })
        })

        client.on("message", (topic, payload) => {
            const stats = this.statsByTopic.get(topic)
            if (!stats) {
                return
            }

            const value = this.parse(payload.toString())
            for (const stat of stats) {
                stat.value = stat.format ? stat.format(value) : String(value)
            }
        })

        client.on("error", (err) => {
            console.error("[coreflux] client error", err)
        })
    }

    dispose() {
        // force-close without waiting for the broker to ack DISCONNECT.
        this.client?.end(true)
        this.client = undefined
    }

    /**
     * The simulator publishes `{"value": ..., "unit": ..., "ts": ...}`; fall back
     * to the raw string for plain payloads.
     */
    private parse(raw: string): unknown {
        try {
            const parsed = JSON.parse(raw)
            return parsed && typeof parsed === "object" && "value" in parsed ? parsed.value : parsed
        } catch {
            return raw
        }
    }
}
