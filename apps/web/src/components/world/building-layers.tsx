import { useSelection } from "@/core/selection/use-selection";
import { useWorld } from "@/hooks/use-world";
import { Slider } from "@workspace/ui/components/slider"
import { useCallback, useEffect, useState } from "react";

export function BuildingLayers() {
    const world = useWorld((s) => s.world)
    const building = useSelection(store => store.building)
    const [floor, setFloor] = useState(() => building?.visibleFloor ?? 0)

    useEffect(() => {
        setFloor(building?.visibleFloor ?? 0)
    }, [building])

    const updateFloor = useCallback((floor: number) => {
        if (!world || !building) {
            return
        }

        setFloor(floor)
        world.setVisibleFloor(building, floor)
    }, [world, building])

    if (!building) {
        return null
    }

    return <div>
        {building.name}

        <Slider
            value={floor}
            onValueChange={(values) => updateFloor(values as number)}
            min={0}
            max={building.floors.length - 1}
            step={1}
        />
    </div>
}
