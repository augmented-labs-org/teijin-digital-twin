import { AbstractMesh, Color3, Scene } from "@babylonjs/core"
import { AreaMaterial } from "../shaders/areaShader"
import { getLocalBoundingBox } from "../utils/bounds"
import type { Building, Floor } from "./building"
import { Entity, EntityFeature, TagBody } from "./entity"
import { Equipment, EquipmentInit } from "./equipment"
import { PICK_PRIORITY } from "./pick-priority"
import { TagStatus } from "./tag"
import { damp } from "../utils/tween"

/**
 * Renders an area's zone as a vertical fade using {@link AreaMaterial}. The area
 * is authored in the model as an opaque "bounds mesh"; this feature replaces its
 * material with the fade and only shows it while the area is active.
 */
class AreaFadeFeature implements EntityFeature {
    private material?: AreaMaterial

    constructor(private readonly node: AbstractMesh) {}

    attach(scene: Scene) {
        const material = new AreaMaterial("areaFade", scene)
        const { min } = getLocalBoundingBox(this.node)

        material.alpha = 0
        material.setup(min.y, min.y + 0.5, new Color3(0, 1, 1))

        this.node.material = material
        this.material = material
    }

    sync(entity: Entity, dt: number) {
        if (!this.material) {
            return
        }

        const targetAlpha = entity.active ? 0.5 : 0
        this.material.alpha = damp(this.material.alpha, targetAlpha, 0.005, dt)
        this.node.isVisible = this.material.alpha > 0.001
    }

    detach() {
        this.material?.dispose()
        this.material = undefined
    }
}

/**
 * An {@link Entity} for a single building area. An area has no intrinsic status,
 * so it is derived from the equipment it contains: an error takes precedence,
 * then any equipment online marks the area online, otherwise it is offline
 * (including when the area has no equipment). Its detail card adds equipment-count
 * rows and an error row, and it renders a zone fade while active.
 */
export class Area extends Entity<AbstractMesh> {
    readonly idPrefix = "area"
    readonly linkOffsetY = -60
    readonly pickPriority = PICK_PRIORITY.ROOM

    readonly floor: Floor
    readonly equipments: Equipment[] = []

    constructor(floor: Floor, name: string, node: AbstractMesh) {
        super(name, node, floor)
        this.floor = floor
        this.features.push(new AreaFadeFeature(node))
    }

    override set focused(val: boolean) {
        if (super.focused && !val) {
            this.world.outlineLayer.clearSelection()
        }

        if (!super.focused && val) {
            this.world.outlineLayer.addSelection(this.node)
        }

        super.focused = val
    }

    get building(): Building {
        return this.floor.building
    }

    addEquipment(params: EquipmentInit): Equipment {
        const equipment = new Equipment(this, params)
        this.equipments.push(equipment)
        return equipment
    }

    get status(): TagStatus {
        if (this.equipments.some(e => e.errored)) {
            return "error"
        }
        return this.equipments.some(e => e.online) ? "online" : "offline"
    }

    buildDetailBody(body: TagBody): (color: string) => void {
        const equipmentRow = body.infoRow()
        const onlineRow = body.infoRow()
        const errorRow = body.errorRow()

        return () => {
            const equipments = this.equipments
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
