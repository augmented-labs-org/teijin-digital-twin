import { Observer, Scene, TransformNode } from "@babylonjs/core";
import { AdvancedDynamicTexture, TextBlock } from "@babylonjs/gui";
import { Floor } from "./building";
import { EntityTag, TagStatus } from "./tag";

export interface EntityFeature {
    attach(scene: Scene): void
    sync(entity: Entity): void
    detach(): void
}

/**
 * The surface an {@link Entity} uses to build its detail-card rows, handed to
 * {@link Entity.buildDetailBody}. It hides the tag's control plumbing: entities
 * just ask for rows and fill them in.
 */
export interface TagBody {
    /** A muted, left-aligned info row appended to the card. */
    infoRow(): TextBlock
    /** A red, wrapping row for error text (hidden by default). */
    errorRow(): TextBlock
}

/**
 * A tagged, selectable thing in the world (an area, a piece of equipment, ...).
 *
 * Every entity is anchored to a scene {@link node} and, once {@link attach}ed,
 * gets a screen-space {@link EntityTag} plus any {@link features} it declares.
 * Subclasses supply the tag configuration ({@link idPrefix}, {@link linkOffsetY},
 * {@link pickPriority}), the current {@link status}, and the variable rows of the
 * detail card via {@link buildDetailBody}.
 */
export abstract class Entity<N extends TransformNode = TransformNode> {
    /** Text shown on the label pill and the detail-card title. */
    readonly name: string

    /** The scene node this entity is anchored to and picked through. */
    readonly node: N

    /** The floor that this entity is on */
    readonly floor: Floor

    /** Declares if the entity is focused, i.e., is being focused on the user-interface */
    private _focused = false

    /** Extra visuals rendered while the entity is active. */
    readonly features: EntityFeature[] = []

    /** Namespaces tag control names so entities of different kinds never collide. */
    abstract readonly idPrefix: string

    /** Pixels the tag floats above the node's anchor point. */
    abstract readonly linkOffsetY: number

    /** Pick priority applied to the node's meshes (see {@link PICK_PRIORITY}). */
    abstract readonly pickPriority: number

    private _tag?: EntityTag
    private _observer: Observer<Scene> | null = null

    constructor(name: string, node: N, floor: Floor) {
        this.name = name
        this.node = node
        this.floor = floor
    }

    get active() {
        return !!this.world.entityGroups.find(g => g.active && g.entities.includes(this))
    }

    get world() {
        return this.floor.building.world
    }

    set focused(val: boolean) {
        this._focused = val
    }

    get focused() {
        return this._focused
    }

    /*

    */

    /** Current headline state driving the tag's accent color and status line. */
    abstract get status(): TagStatus

    /**
     * Append the entity-specific rows to the detail card via `body`. Return a
     * callback that refreshes those rows; it is invoked every frame with the
     * current accent color.
     */
    abstract buildDetailBody(body: TagBody): (color: string) => void

    /** Create the tag and features, and start driving the features per frame. */
    attach(gui: AdvancedDynamicTexture, scene: Scene) {
        this._tag = new EntityTag(this, gui, scene)
        for (const feature of this.features) {
            feature.attach(scene)
        }
        this._observer = scene.onBeforeRenderObservable.add(() => {
            for (const feature of this.features) {
                feature.sync(this)
            }
        })
    }

    dispose() {
        this._observer?.remove()
        this._observer = null
        this._tag?.dispose()
        this._tag = undefined
        for (const feature of this.features) {
            feature.detach()
        }
    }
}
