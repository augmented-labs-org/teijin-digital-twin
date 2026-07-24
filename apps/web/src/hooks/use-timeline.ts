import { useWorld } from "@/hooks/use-world"
import { useCallback, useEffect, useState } from "react"

type TimelineSnapshot = {
    /** Start of the recorded range (ms epoch), or undefined when empty. */
    start?: number
    /** End of the recorded range (ms epoch), or undefined when empty. */
    end?: number
    /** The instant currently displayed (ms epoch). Tracks `end` while live. */
    currentTime?: number
    /** Whether the scene is tracking the present. */
    live: boolean
    /** True once there is a scrubbable span (more than a single instant). */
    hasHistory: boolean
}

const EMPTY: TimelineSnapshot = { live: true, hasHistory: false }

/**
 * Reactive read-model of the world's {@link Timeline} for the React layer, plus
 * the two controls the seekbar needs. Mirrors the world→React bridge pattern in
 * {@link useWorldStoreSync}: the timeline stays the source of truth and this hook
 * just projects its state into React on every change.
 */
export function useTimeline() {
    const world = useWorld((s) => s.world)
    const [snapshot, setSnapshot] = useState<TimelineSnapshot>(EMPTY)

    useEffect(() => {
        if (!world) {
            setSnapshot(EMPTY)
            return
        }

        const timeline = world.timeline
        const read = (): TimelineSnapshot => {
            const range = timeline.source.range()
            return {
                start: range?.start,
                end: range?.end,
                currentTime: timeline.currentTime,
                live: timeline.live,
                hasHistory: !!range && range.end > range.start,
            }
        }

        setSnapshot(read())
        const observer = timeline.onChanged.add(() => setSnapshot(read()))

        return () => {
            observer.remove()
            setSnapshot(EMPTY)
        }
    }, [world])

    const seek = useCallback((t: number) => world?.timeline.seek(t), [world])
    const goLive = useCallback(() => world?.timeline.goLive(), [world])

    return { ...snapshot, seek, goLive }
}
