import { AbstractMesh, Color3, Scene, TransformNode } from "@babylonjs/core"
import { AreaMaterial } from "../shaders/areaShader"
import { getLocalBoundingBox } from "../utils/bounds"
import { damp } from "../utils/tween"
import type { Floor } from "./building"
import { EntityFeature, EntityStatus, StaticEntity, TagBody } from "./entity"
import { Equipment } from "./equipment"
import { Waypoint } from "./waypoint"
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
export class Area extends StaticEntity<AbstractMesh> {

    readonly idPrefix = "area"
    readonly linkOffsetY = -30
    readonly pickPriority = PICK_PRIORITY.ROOM

    readonly equipments: Equipment[] = []
    readonly waypoints: Waypoint[] = []

    readonly color: Color3

    constructor(id: string, floor: Floor, name: string, node: AbstractMesh, color: Color3) {
        super(id, name, node, floor)

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

    addEquipment(id: string, name: string, node: TransformNode): Equipment {
        const equipment = new Equipment(id, this, name, node)
        this.equipments.push(equipment)
        return equipment
    }

    addWaypoint(id: string, name: string, node: TransformNode): Waypoint {
        const waypoint = new Waypoint(this, id, name, node)
        this.waypoints.push(waypoint)
        return waypoint
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
        return () => {
        }
    }
}
