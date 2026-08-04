import { Observable, TransformNode, Vector3 } from "@babylonjs/core"
import type { Building } from "./building"
import { Entity } from "./entity"
import type { Waypoint } from "./waypoint"
import type { World } from "../world"
import type { EntityStateSnapshot } from "../telemetry/timeline"

/**
 * An {@link Entity} that is not fixed in the building hierarchy: it occupies a
 * {@link Waypoint} and can move to another over time (a part flowing between
 * areas or buildings). Its location is timeline state — projected through
 * {@link applyState} — so moves replay identically for live data and history.
 *
 * For now a movable has no free world position: it snaps onto its current
 * waypoint's node and inherits that node's transform. When it has no waypoint it
 * is "unplaced" and hidden.
 */
export abstract class MovableEntity extends Entity<TransformNode> {
    private _location: Waypoint | undefined

    /**
     * Fired whenever the movable's {@link location} actually changes, for view
     * side-effects (overlays, lists) that don't read it every frame.
     */
    readonly onLocationChanged = new Observable<MovableEntity>()

    /**
     * Waypoint the movable should be seeded onto when the world first projects
     * state. Authoring sets this; it is only a starting hint, not live state.
     */
    initialWaypoint?: Waypoint

    constructor(id: string, name: string, node: TransformNode, world: World) {
        super(id, name, node, world)
    }

    get location(): Waypoint | undefined {
        return this._location
    }

    get building(): Building | undefined {
        return this._location?.building
    }

    override applyState(state: EntityStateSnapshot) {
        super.applyState(state)
        if (state.location !== undefined) {
            this._place(this.world.resolveLocation(state.location))
        }
    }

    /** Snap onto a waypoint (or hide, when `undefined`). */
    private _place(waypoint: Waypoint | undefined) {
        if (waypoint !== this._location) {
            this._location = waypoint

            if (waypoint) {
                this.node.parent = waypoint.node
                this.node.position = Vector3.Zero()
                this.node.rotationQuaternion = null
                this.node.rotation = Vector3.Zero()
            }

            this.onLocationChanged.notifyObservers(this)
        }

        this.updateVisibility()
    }

    /**
     * Show the node only when it is placed on a floor at or below its building's
     * active floor. Called on placement, and by the world when floor visibility
     * changes (the node isn't a child of the floor, so it can't rely on cascade).
     */
    updateVisibility() {
        const waypoint = this._location
        const visible = !!waypoint && waypoint.floor.floor <= waypoint.building.activeFloor
        this.node.setEnabled(visible)
    }
}
