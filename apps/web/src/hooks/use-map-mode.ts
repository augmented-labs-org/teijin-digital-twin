import { useWorld } from "@/hooks/use-world"
import { useEffect, useState } from "react"

/**
 * Reactive read-model of the world's map mode for the React layer.
 * Mirrors the world→React bridge pattern in {@link useFocusedEntity}: the
 * world stays the source of truth and this hook just projects `mapMode`
 * into React on every change.
 */
export function useMapMode(): boolean {
    const world = useWorld((s) => s.world)
    const [mapMode, setMapMode] = useState(false)

    useEffect(() => {
        if (!world) {
            setMapMode(false)
            return
        }

        setMapMode(world.mapMode)
        const observer = world.onMapModeChanged.add((next) => setMapMode(next))

        return () => {
            observer.remove()
            setMapMode(false)
        }
    }, [world])

    return mapMode
}
