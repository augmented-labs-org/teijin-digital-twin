import { EntityDetailPanel } from "@/components/world/entity-detail-panel"
import { Area } from "@/core/building/area"
import { useFocusedEntity } from "@/hooks/use-focused-entity"
import { useWorld } from "@/hooks/use-world"
import { Button } from "@workspace/ui/components/button"
import { Card, CardContent, CardHeader, CardTitle } from "@workspace/ui/components/card"
import { cn } from "@workspace/ui/lib/utils"
import { XIcon } from "lucide-react"
import { AnimatePresence, motion } from "motion/react"
import { useEffect } from "react"

function AreaRow({ entity, focused }: { entity: Area<any>; focused: boolean }) {
    return (
        <button
            type="button"
            onClick={() => {
                entity.world.focusedEntity = entity
            }}
            onMouseEnter={() => {
                entity.world.hoveredEntity = entity
            }}
            onMouseLeave={() => {
                if (entity.world.hoveredEntity === entity) {
                    entity.world.hoveredEntity = undefined
                }
            }}
            className={cn(
                "flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-foreground transition-colors hover:bg-muted",
                focused && "bg-muted font-medium",
            )}
        >
            <span
                className="size-2.5 shrink-0 rounded-[3px]"
                style={{ backgroundColor: entity.color.toHexString() }}
            />
            {entity.name}
        </button>
    )
}

/**
 * The world's left-hand "Areas" card and the right-hand "Entity Details" card
 * shown for whichever entity is currently focused. Babylon only ever reports
 * which entity is focused via {@link useFocusedEntity} — closing the details
 * card clears that focus rather than owning any separate open/closed state.
 */
export function EntitySidebar() {
    const world = useWorld((s) => s.world)
    const focused = useFocusedEntity()
    const areas = world?.entities.filter((entity): entity is Area<any> => entity instanceof Area) ?? []

    // Clear the hover outline if the world changes mid-hover, since a row's
    // onMouseLeave won't fire once it's unmounted.
    useEffect(() => {
        return () => {
            if (world) {
                world.hoveredEntity = undefined
            }
        }
    }, [world])

    return (
        <>
            <Card className="fixed top-4 left-4 z-40 flex max-h-[calc(100vh-2rem)] w-64 flex-col">
                <CardHeader>
                    <CardTitle>Areas</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-0.5 overflow-y-auto">
                    {areas.map((entity) => (
                        <AreaRow key={entity.id} entity={entity} focused={focused === entity} />
                    ))}
                </CardContent>
            </Card>

            <AnimatePresence>
                {focused && (
                    <motion.div
                        key="entity-details-panel"
                        initial={{ opacity: 0, x: 16 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: 16 }}
                        transition={{ type: "spring", stiffness: 320, damping: 32 }}
                        className="fixed top-4 right-4 bottom-4 z-40 flex w-full max-w-sm flex-col"
                    >
                        <Card className="relative flex flex-1 flex-col overflow-hidden">
                            <Button
                                variant="ghost"
                                size="icon-sm"
                                className="absolute top-4 right-4 z-10"
                                onClick={() => {
                                    if (world) {
                                        world.focusedEntity = undefined
                                    }
                                }}
                            >
                                <XIcon />
                                <span className="sr-only">Close</span>
                            </Button>
                            <CardContent className="flex flex-1 flex-col overflow-hidden p-0">
                                <EntityDetailPanel entity={focused} />
                            </CardContent>
                        </Card>
                    </motion.div>
                )}
            </AnimatePresence>
        </>
    )
}
