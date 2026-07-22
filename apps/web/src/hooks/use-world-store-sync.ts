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
        const { selectBuilding, setEntityGroups, selectEntityGroup } = useSelection.getState()

        if (!world) {
            selectBuilding(undefined)
            setEntityGroups(new Set())

            return
        }

        // Seed the store with whatever is currently focused, then keep it in sync.
        selectBuilding(world.focusedBuilding)
        setEntityGroups(new Set(world.entityGroups.filter(x => x.active)))

        const observers = [
            world.onFocusBuildingChanged.add((building) => selectBuilding(building)),
            world.onEntityGroupActiveChanged.add((group) => selectEntityGroup(group, group.active))
        ]

        return () => {
            observers.forEach(o => o.remove())

            selectBuilding(undefined)
            setEntityGroups(new Set())
        }
    }, [world])
}
