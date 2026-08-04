import type { TransformNode } from "@babylonjs/core"
import type { Area } from "./area"
import type { Building, Floor } from "./building"

/**
 * A predefined placement slot a {@link MovableEntity} can occupy. A waypoint is
 * not itself a tagged/selectable entity — it is just an anchor node owned by an
 * {@link Area}, so it already knows its floor and building. Movables snap onto a
 * waypoint's {@link node}; moving is a matter of switching which waypoint.
 */
export class Waypoint {
    readonly area: Area
    /** Stable, unique id used as the serializable location key on the timeline. */
    readonly id: string
    readonly name: string
    /** The scene node a movable is parented to while placed here. */
    readonly node: TransformNode

    constructor(area: Area, id: string, name: string, node: TransformNode) {
        this.area = area
        this.id = id
        this.name = name
        this.node = node
    }

    get floor(): Floor {
        return this.area.floor
    }

    get building(): Building {
        return this.area.building
    }
}
