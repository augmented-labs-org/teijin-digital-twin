import type { Entity } from "@/core/building/entity"
import { useWorld } from "@/hooks/use-world"
import { useCallback, useEffect, useState } from "react"

type EntityDetailSnapshot = {
    entity: Entity | undefined
    open: boolean
}

const EMPTY: EntityDetailSnapshot = { entity: undefined, open: false }

/**
 * Reactive read-model of the world's detail-panel state for the React layer.
 * Mirrors the world→React bridge pattern in {@link useWorldStoreSync}/
 * {@link useTimeline}: the world stays the source of truth and this hook just
 * projects `focusedEntity`/`detailPanelOpen` into React on every change.
 */
export function useEntityDetail() {
    const world = useWorld((s) => s.world)
    const [snapshot, setSnapshot] = useState<EntityDetailSnapshot>(EMPTY)

    useEffect(() => {
        if (!world) {
            setSnapshot(EMPTY)
            return
        }

        const read = (): EntityDetailSnapshot => ({
            entity: world.focusedEntity,
            open: world.detailPanelOpen,
        })

        setSnapshot(read())
        const observers = [
            world.onDetailPanelChanged.add(() => setSnapshot(read())),
            world.onFocusEntityChanged.add(() => setSnapshot(read())),
        ]

        return () => {
            observers.forEach((o) => o.remove())
            setSnapshot(EMPTY)
        }
    }, [world])

    const close = useCallback(() => {
        if (world) {
            world.detailPanelOpen = false
        }
    }, [world])

    // `entity` is intentionally not gated by `open`: closing via the panel's own
    // close button (or Escape, which clears `focusedEntity` and so `open` too)
    // only flips `open`, and the panel needs its content to stay put while it
    // plays the closing transition.
    return { entity: snapshot.entity, open: snapshot.open, close }
}
