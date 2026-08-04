import type { TransformNode } from "@babylonjs/core"
import type { EntityStatus, TagBody } from "./entity"
import { MovableEntity } from "./movable"
import { PICK_PRIORITY } from "./pick-priority"
import type { World } from "../world"

/**
 * A {@link MovableEntity} for a workpiece that flows between areas. Its status
 * and detail card just report where it currently is.
 */
export class Part extends MovableEntity {
    readonly idPrefix = "part"
    readonly linkOffsetY = -30
    readonly pickPriority = PICK_PRIORITY.EQUIPMENT

    constructor(id: string, world: World, name: string, node: TransformNode) {
        super(id, name, node, world)
    }

    get status(): EntityStatus {
        const location = this.location
        return location
            ? { status: location.area.name, color: "#3b82f6" }
            : { status: "Unplaced" }
    }

    buildDetailBody(body: TagBody): (color: string) => void {
        const locationRow = body.infoRow()

        return () => {
            const location = this.location
            locationRow.text = location
                ? `Location: ${location.area.name} · ${location.name}`
                : "Location: —"
        }
    }
}
