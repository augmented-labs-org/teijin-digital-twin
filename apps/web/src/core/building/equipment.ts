import { TransformNode } from "@babylonjs/core"
import type { Area } from "./area"
import type { Building, Floor } from "./building"
import { Entity, EntityStatus, TagBody } from "./entity"
import { PICK_PRIORITY } from "./pick-priority"

/**
 * An {@link Entity} for a single piece of equipment. Its status comes straight
 * off its own state; the detail card adds a "Running" row and an error row.
 */
export class Equipment extends Entity<TransformNode> {
    readonly idPrefix = "equipment"
    readonly linkOffsetY = -30
    readonly pickPriority = PICK_PRIORITY.EQUIPMENT

    readonly area: Area
    online: boolean = false
    running: boolean = false
    errored: boolean = false
    errorReason?: string

    constructor(area: Area, name: string, node: TransformNode) {
        super(name, node, area.floor)

        this.area = area
    }

    get building(): Building {
        return this.area.building
    }


    get status(): EntityStatus {
        if (this.errored) {
            return {
                status: "Error",
                color: "#ef4444"
            }
        }

        return this.online ? {
            status: "Online",
            color: "#22c55e"
        } : {
            status: "Offline"
        }
    }

    buildDetailBody(body: TagBody): (color: string) => void {
        const runningRow = body.infoRow()
        const errorRow = body.errorRow()

        return () => {
            runningRow.text = `Running: ${this.running ? "Yes" : "No"}`

            errorRow.isVisible = this.errored
            if (this.errored) {
                errorRow.text = this.errorReason ?? "Unknown error"
            }
        }
    }
}
