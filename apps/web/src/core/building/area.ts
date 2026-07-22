import { Scene } from "@babylonjs/core"
import { AdvancedDynamicTexture, StackPanel } from "@babylonjs/gui"
import { BuildingArea } from "./building"
import { PICK_PRIORITY } from "./pick-priority"
import { TagStatus, WorldTag } from "./tag"

/**
 * A {@link WorldTag} for a single {@link BuildingArea}. A room has no intrinsic
 * status, so it is derived from the equipment it contains: an error takes
 * precedence, then any equipment online marks the room online, otherwise it is
 * offline (including when the room has no equipment). The detail card adds
 * equipment-count rows and an error row.
 */
export class AreaTag extends WorldTag {
    protected readonly idPrefix = "room"
    protected readonly linkOffsetY = -60
    protected readonly pickPriority = PICK_PRIORITY.ROOM

    constructor(
        private readonly room: BuildingArea,
        gui: AdvancedDynamicTexture,
        scene: Scene,
    ) {
        super(room.node, gui, scene)
        this.init()
    }

    protected get name() {
        return this.room.name
    }

    protected get active() {
        return this.room.active
    }

    protected get status(): TagStatus {
        const equipments = this.room.equipments
        if (equipments.some(e => e.errored)) {
            return "error"
        }
        return equipments.some(e => e.online) ? "online" : "offline"
    }

    protected buildDetailBody(panel: StackPanel): (color: string) => void {
        const equipmentRow = this.detailRow(panel)
        const onlineRow = this.detailRow(panel)
        const errorRow = this.errorRow(panel)

        return () => {
            const equipments = this.room.equipments
            const total = equipments.length
            const online = equipments.filter(e => e.online).length
            const errored = equipments.filter(e => e.errored).length

            equipmentRow.text = `Equipment: ${total}`
            onlineRow.text = `Online: ${online}/${total}`

            errorRow.isVisible = errored > 0
            if (errored > 0) {
                errorRow.text = `${errored} in error`
            }
        }
    }
}
