import type { Entity } from "@/core/building/entity"
import { useWorld } from "@/hooks/use-world"
import { useEffect, useState } from "react"

/**
 * Reactive read-model of the world's focused entity for the React layer.
 * Mirrors the world→React bridge pattern in {@link useWorldStoreSync}/
 * {@link useTimeline}: the world stays the source of truth and this hook just
 * projects `focusedEntity` into React on every change.
 */
export function useFocusedEntity(): Entity | undefined {
    const world = useWorld((s) => s.world)
    const [entity, setEntity] = useState<Entity | undefined>(undefined)

    useEffect(() => {
        if (!world) {
            setEntity(undefined)
            return
        }

        setEntity(world.focusedEntity)
        const observer = world.onFocusEntityChanged.add((next) => setEntity(next))

        return () => {
            observer.remove()
            setEntity(undefined)
        }
    }, [world])

    return entity
}
