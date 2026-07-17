import { useSelection } from "@/core/selection/use-selection";
import { useWorld } from "@/hooks/use-world";
import { useEffect } from "react";

/**
 * The one bridge between the Babylon world (source of truth) and the Zustand
 * selection store (read-model for React). The world stays pure and knows nothing
 * about the store; this hook projects its focus events into the store.
 */
export function useWorldStoreSync() {
    const world = useWorld((s) => s.world)

    useEffect(() => {
        const { selectBuilding } = useSelection.getState()

        if (!world) {
            selectBuilding(undefined)
            return
        }

        // Seed the store with whatever is currently focused, then keep it in sync.
        selectBuilding(world.focusedBuilding)
        const observer = world.onFocusChanged.add((building) => selectBuilding(building))

        return () => {
            observer.remove()
            selectBuilding(undefined)
        }
    }, [world])
}
