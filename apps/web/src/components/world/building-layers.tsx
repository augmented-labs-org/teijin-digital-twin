import { useSelection } from "@/core/selection/use-selection";
import { useWorld } from "@/hooks/use-world";
import { Slider } from "@workspace/ui/components/slider"
import { useCallback, useEffect, useState } from "react";
import { useStore } from "zustand";

export function BuildingLayers() {
    const { world } = useWorld()

    if (!world) {
        throw new Error()
    }

    const building = useSelection(store => store.building)
    const [floor, setFloor] = useState(() => building ? building.floors.length - 1 : 0)
    useEffect(() => {
        if (!building) {
            setFloor(0)
        } else {
            setFloor(building.floors.length - 1)
        }
    }, [building])

    const updateFloor = useCallback((floor: number) => {
        if (!building) {
            return
        }
        
        setFloor(floor)

        for (let i = 0; i < floors; i++) {
            building.floors[i]!.node.setEnabled(i <= floor)
        }
    }, [building, setFloor])


    if (!building) {
        return
    }

    const floors = building.floors.length

    return <div>
        {building.name}

        <Slider value={floor} onValueChange={(values) => updateFloor(values as number)} min={0} max={floors - 1} step={1} />
    </div>
}