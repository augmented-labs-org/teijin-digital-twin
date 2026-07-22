import { TransformNode } from "@babylonjs/core"
import type { Area } from "./area"
import type { Building, Floor } from "./building"
import { Entity, TagBody } from "./entity"
import { PICK_PRIORITY } from "./pick-priority"
import { TagStatus } from "./tag"

export interface EquipmentInit {
    name: string
    node: TransformNode
    online?: boolean
    running?: boolean
    errored?: boolean
    errorReason?: string
}

/**
 * An {@link Entity} for a single piece of equipment. Its status comes straight
 * off its own state; the detail card adds a "Running" row and an error row.
 */
export class Equipment extends Entity<TransformNode> {
    readonly idPrefix = "equipment"
    readonly linkOffsetY = -22
    readonly pickPriority = PICK_PRIORITY.EQUIPMENT

    readonly area: Area
    online: boolean
    running: boolean
    errored: boolean
    errorReason?: string

    constructor(area: Area, params: EquipmentInit) {
        super(params.name, params.node, area.floor)

        this.area = area
        this.online = params.online ?? false
        this.running = params.running ?? false
        this.errored = params.errored ?? false
        this.errorReason = params.errorReason
    }

    get building(): Building {
        return this.area.building
    }

    get status(): TagStatus {
        if (this.errored) {
            return "error"
        }
        return this.online ? "online" : "offline"
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
