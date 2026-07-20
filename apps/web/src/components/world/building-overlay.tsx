import { useSelection } from "@/core/selection/use-selection";
import { useWorld } from "@/hooks/use-world";
import { LayerSlider } from "@workspace/ui/components/layer-slider";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useState } from "react";

const variants = {
    visible: { opacity: 1, y: 0, x: 0 },
    hiddenTop: { opacity: 0, y: -10 },
    hiddenRight: { opacity: 0, x: 10 },
}

export function BuildingOverlay() {
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

    return <>
        <div className="absolute top-0 left-1/2 transform -translate-x-1/2 p-4">
            <AnimatePresence>
                {building && (
                    <motion.div
                        key={building.name}
                        className="p-2 px-4 bg-primary/50 rounded-full text-primary-foreground font-semibold"
                        variants={variants}
                        initial="hiddenTop"
                        animate="visible"
                        exit="hiddenTop">
                        <p>{building.name}</p>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>

        <div className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 right-0">
            <AnimatePresence>
                {building && (
                    <motion.div
                        className="transform p-3 py-4 bg-primary/50 rounded-full h-80"
                        variants={variants}
                        initial="hiddenRight"
                        animate="visible"
                        exit="hiddenRight">
                        <LayerSlider
                            value={floor}
                            onValueChange={(values) => updateFloor(values as number)}
                            orientation="vertical"
                            thumbAlignment="center"
                            min={0}
                            max={building.floors.length - 1}
                            step={1}
                        />
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    </>
}
