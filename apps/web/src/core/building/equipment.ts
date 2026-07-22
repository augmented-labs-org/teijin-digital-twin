import { Scene } from "@babylonjs/core"
import { AdvancedDynamicTexture, StackPanel } from "@babylonjs/gui"
import { BuildingEquipment } from "./building"
import { PICK_PRIORITY } from "./pick-priority"
import { TagStatus, WorldTag } from "./tag"

/**
 * A {@link WorldTag} for a single {@link BuildingEquipment}. Status comes
 * straight off the equipment; the detail card adds a "Running" row and an error
 * row.
 */
export class EquipmentTag extends WorldTag {
    protected readonly idPrefix = "equipment"
    protected readonly linkOffsetY = -22
    protected readonly pickPriority = PICK_PRIORITY.EQUIPMENT

    constructor(
        private readonly equipment: BuildingEquipment,
        gui: AdvancedDynamicTexture,
        scene: Scene,
    ) {
        super(equipment.node, gui, scene)
        this.init()
    }

    protected get name() {
        return this.equipment.name
    }

    protected get active() {
        return this.equipment.active
    }

    protected get status(): TagStatus {
        if (this.equipment.errored) {
            return "error"
        }
        return this.equipment.online ? "online" : "offline"
    }

    protected buildDetailBody(panel: StackPanel): (color: string) => void {
        const runningRow = this.detailRow(panel)
        const errorRow = this.errorRow(panel)

        return () => {
            runningRow.text = `Running: ${this.equipment.running ? "Yes" : "No"}`

            errorRow.isVisible = this.equipment.errored
            if (this.equipment.errored) {
                errorRow.text = this.equipment.errorReason ?? "Unknown error"
            }
        }
    }
}
