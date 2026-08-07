import { useSelection } from "@/core/selection/use-selection";
import { useWorld } from "@/hooks/use-world";
import { EntityDetailSheet } from "@/components/world/entity-detail-sheet";
import { TimelineOverlay } from "@/components/world/timeline-overlay";
import { LayerSlider } from "@workspace/ui/components/layer-slider";
import { Toggle, } from "@workspace/ui/components/toggle";
import { Grid2x2 } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useState } from "react";

const variants = {
    visible: { opacity: 1, y: 0, x: 0 },
    hiddenTop: { opacity: 0, y: -10 },
    hiddenRight: { opacity: 0, x: 10 },
}

/*

*/

function EntityGroupsOverlay() {
    const world = useWorld((s) => s.world)

    const entityGroups = useSelection(store => store.entityGroups)

    if (!world) {
        return null
    }

    return world.entityGroups.map(x => (<Toggle
        key={x.name}
        variant="outline"
        aria-label={`Toggle ${x.name}`}
        pressed={entityGroups.has(x)}
        onPressedChange={(p) => {
            console.log(p)
            x.active = p
        }}
    >
        <Grid2x2 />
        {x.name}
    </Toggle>))
}

/*

*/

export function WorldOverlay() {
    const world = useWorld((s) => s.world)
    const building = useSelection(store => store.building)
    const [floor, setFloor] = useState(() => building?.activeFloor ?? 0)

    useEffect(() => {
        setFloor(building?.activeFloor ?? 0)
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

        <div className="absolute top-0 bottom-0 right-0 pointer-events-none">
            <div className="flex flex-col justify-center items-center h-full p-8">
                <div className="pointer-events-auto h-full max-h-80">
                    <AnimatePresence>
                        {building && building.floors.length > 1 && (
                            <motion.div
                                className="transform p-3 py-4 bg-primary/50 rounded-full h-full"
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
            </div>
        </div>

        {world && <div className="absolute bottom-20 left-1/2 transform -translate-x-1/2 p-4">
            <div className="flex flex-row gap-4">
                <EntityGroupsOverlay />
            </div>
        </div>}

        {world && <TimelineOverlay />}
        {world && <EntityDetailSheet />}
    </>
}
