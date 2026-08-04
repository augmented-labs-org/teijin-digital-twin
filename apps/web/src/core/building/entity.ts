import { Observer, Scene, TransformNode } from "@babylonjs/core";
import { AdvancedDynamicTexture, TextBlock } from "@babylonjs/gui";
import type { Building, Floor } from "./building";
import type { World } from "../world";
import { EntityTag } from "./tag";
import type { EntityStateSnapshot } from "../telemetry/timeline";

export interface EntityFeature {
    attach(scene: Scene): void
    sync(dt: number): void
    detach(): void
}

export type EntityStatus = {
    status: string,
    color?: string
}

/**
 * A single named metric shown in an entity's detail card. The {@link icon} is a
 * glyph (e.g. an emoji) rendered inline before the name; {@link value} is
 * stringified live each frame, so mutating it updates the card.
 */
export type EntityStat = {
    /** Short label shown next to the icon. */
    name: string
    /** Displayed value; read every frame, so it can change over time. */
    value: string | number
    /** Icon glyph drawn before the name (e.g. "🌡️"). */
    icon: string
    /**
     * MQTT topic whose published value drives this stat live. When set, the
     * telemetry service subscribes to it and writes each message into
     * {@link value} (via {@link format}).
     */
    topic?: string
    /** Maps a raw published value to the string/number shown in {@link value}. */
    format?: (raw: unknown) => string | number
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
    /**
     * Stable, unique identity used to key this entity's structured state on the
     * timeline. Provided at construction (never derived from location), so it stays
     * fixed even for movable entities that change which building/floor they are on,
     * and maps cleanly onto a future database row.
     */
    readonly id: string

    /** Text shown on the label pill and the detail-card title. */
    readonly name: string

    /** The scene node this entity is anchored to and picked through. */
    readonly node: N

    /** The world this entity belongs to. */
    readonly world: World

    /** Declares if the entity is focused, i.e., is being focused on the user-interface */
    private _focused = false

    /** Extra visuals rendered while the entity is active. */
    readonly features: EntityFeature[] = []

    /** Named metrics shown in the detail card, each with an icon glyph. */
    readonly stats: EntityStat[] = []

    /** Namespaces tag control names so entities of different kinds never collide. */
    abstract readonly idPrefix: string

    /** Pixels the tag floats above the node's anchor point. */
    abstract readonly linkOffsetY: number

    /** Pick priority applied to the node's meshes (see {@link PICK_PRIORITY}). */
    abstract readonly pickPriority: number

    private _tag?: EntityTag
    private _observer: Observer<Scene> | null = null

    constructor(id: string, name: string, node: N, world: World) {
        this.id = id
        this.name = name
        this.node = node
        this.world = world
    }

    get active() {
        return !!this.world.entityGroups.find(g => g.active && g.entities.includes(this))
    }

    /**
     * The building this entity currently belongs to, if any. Static entities are
     * always in one; a movable entity has none while it is unplaced.
     */
    abstract get building(): Building | undefined

    /**
     * Project a structured state snapshot onto this entity. Entities are pure
     * projections of timeline state — this is the single write path, used for both
     * live data and scrubbed history. The base handles the generic {@link stats};
     * subclasses override to apply their own fields (calling `super.applyState`).
     */
    applyState(state: EntityStateSnapshot) {
        if (!state.stats) {
            return
        }
        for (const stat of this.stats) {
            const value = state.stats[stat.name]
            if (value !== undefined) {
                stat.value = value
            }
        }
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
    abstract get status(): EntityStatus

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
        this._observer = scene.onBeforeRenderObservable.add((scene) => {
            for (const feature of this.features) {
                feature.sync(scene.deltaTime / 1000.0)
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

/**
 * An {@link Entity} with a fixed place in the building hierarchy: it lives on one
 * {@link Floor} for its whole life. Areas and equipment are static. (Movable
 * entities extend {@link Entity} directly and track their location as state.)
 */
export abstract class StaticEntity<N extends TransformNode = TransformNode> extends Entity<N> {
    /** The floor that this entity is on. */
    readonly floor: Floor

    constructor(id: string, name: string, node: N, floor: Floor) {
        super(id, name, node, floor.building.world)
        this.floor = floor
    }

    get building(): Building {
        return this.floor.building
    }
}
