import type { Entity } from "@/core/building/entity"
import { useFocusedEntity } from "@/hooks/use-focused-entity"
import { useWorld } from "@/hooks/use-world"
import { cn } from "@workspace/ui/lib/utils"

function EntityRow({ entity, focused }: { entity: Entity; focused: boolean }) {
    return (
        <button
            type="button"
            onClick={() => {
                entity.world.focusedEntity = entity
            }}
            className={cn(
                "rounded-md px-2 py-1.5 text-left text-sm text-foreground transition-colors hover:bg-muted",
                focused && "bg-muted font-medium",
            )}
        >
            {entity.name}
        </button>
    )
}

/**
 * A tree of every entity in the world, grouped the same way {@link World.entityGroups}
 * groups them for visibility toggling. Clicking a row focuses that entity, the
 * same as clicking it in the 3D scene.
 */
export function EntityTreePanel() {
    const world = useWorld((s) => s.world)
    const focused = useFocusedEntity()

    return (
        <>
            <div className="p-6 pr-14">
                <h2 className="font-heading text-base font-medium text-foreground">Entity Tree</h2>
            </div>

            <div className="flex-1 overflow-y-auto px-6 pb-6">
                {world?.entityGroups.map((group) => (
                    <div key={group.name} className="mb-4 flex flex-col gap-1">
                        <span className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                            {group.name}
                        </span>
                        <div className="flex flex-col gap-0.5">
                            {group.entities.map((entity) => (
                                <EntityRow key={entity.id} entity={entity} focused={focused === entity} />
                            ))}
                        </div>
                    </div>
                ))}
            </div>
        </>
    )
}
