import { AbstractMesh, Color3, Scene } from "@babylonjs/core"
import { AreaMaterial } from "../shaders/areaShader"
import { getLocalBoundingBox } from "../utils/bounds"
import { damp } from "../utils/tween"
import type { Building, Floor } from "./building"
import { Entity, EntityFeature, EntityStatus, TagBody } from "./entity"
import { Equipment, EquipmentInit } from "./equipment"
import { PICK_PRIORITY } from "./pick-priority"

/**
 * Renders an area's zone as a vertical fade using {@link AreaMaterial}. The area
 * is authored in the model as an opaque "bounds mesh"; this feature replaces its
 * material with the fade and only shows it while the area is active.
 */
class AreaFadeFeature implements EntityFeature {
    private material?: AreaMaterial

    constructor(private readonly area: Area) {}

    attach(scene: Scene) {
        const material = new AreaMaterial("areaFade", scene)
        const { min } = getLocalBoundingBox(this.area.node)

        material.alpha = 0
        material.setup(min.y, min.y + 0.5, this.area.color)

        this.area.node.material = material
        this.material = material
    }

    sync(dt: number) {
        if (!this.material) {
            return
        }

        const targetAlpha = this.area.active ? 0.5 : 0
        this.material.alpha = damp(this.material.alpha, targetAlpha, 0.005, dt)
        this.area.node.isVisible = this.material.alpha > 0.001
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

    readonly color: Color3

    constructor(floor: Floor, name: string, node: AbstractMesh, color: Color3) {
        super(name, node, floor)

        this.floor = floor
        this.color = color

        this.features.push(new AreaFadeFeature(this))
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

    get status(): EntityStatus {
        if (this.equipments.some(e => e.errored)) {
            return {
                status: "Error",
                color: "#ef4444"
            }
        }

        return {
            status: "Ok",
            color: this.color.toHexString()
        }
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
