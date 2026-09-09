import { AbstractMesh, Observer, Scene, TransformNode } from "@babylonjs/core";
import { AdvancedDynamicTexture } from "@babylonjs/gui";
import type { World } from "../world";
import type { Building } from "./building";
import { EntityTag } from "./tag";
import { type UiSchema } from "./ui-schema";

export interface EntityState {
}

export interface EntityFeature {
    attach(scene: Scene): void
    sync(dt: number): void
    detach(): void
}

/**
 * A tagged, selectable thing in the world (an area, a piece of equipment, ...).
 */
export abstract class Entity<N extends TransformNode = TransformNode, S extends EntityState = EntityState> {
    readonly id: string

    readonly name: string

    readonly node: N

    /** The world this entity belongs to. */
    readonly world: World

    /** Extra visuals rendered while the entity is active. */
    readonly features: EntityFeature[] = []

    //

    /** Declares if the entity is focused, i.e., is being focused on the user-interface */
    private _focused = false

    private _state: S

    /**
     * Bumped on every write to {@link state}. Views compare it against the
     * version they last rendered instead of rebuilding their content every
     * frame — see {@link EntityTag}.
     */
    private _stateVersion = 0

    /**
     * Every mesh under {@link node}, cached by {@link attach}. The model is
     * static, so the subtree is walked once: some of them (the final packaging
     * cell) are ~200 meshes, far too many to re-walk per frame.
     */
    private _meshes: AbstractMesh[] = []

    /** Pixels the tag floats above the node's anchor point. */
    abstract readonly linkOffsetY: number

    /** Pick priority applied to the node's meshes (see {@link PICK_PRIORITY}). */
    abstract readonly pickPriority: number

    private _tag?: EntityTag

    private _observer: Observer<Scene> | null = null

    constructor(id: string, name: string, node: N, world: World, defaultState: S) {
        this.id = id
        this.name = name
        this.node = node
        this.world = world
        this._state = defaultState
    }

    get active() {
        return !!this.world.entityGroups.find(g => g.active && g.entities.includes(this))
    }

    /**
     * The building this entity currently belongs to, if any. Static entities are
     * always in one; a movable entity has none while it is unplaced.
     */
    abstract get building(): Building | undefined

    get state() {
        return this._state
    }

    set state(val: S) {
        this._state = val
        this._stateVersion++
    }

    /** Changes whenever {@link state} is written; see {@link _stateVersion}. */
    get stateVersion() {
        return this._stateVersion
    }

    /** Every mesh under this entity's node (empty until {@link attach}). */
    get meshes(): readonly AbstractMesh[] {
        return this._meshes
    }

    set focused(val: boolean) {
        this._focused = val
    }

    get focused() {
        return this._focused
    }

    /** Meshes to highlight in the world's outline layer when this entity is focused or hovered. */
    getOutlineMeshes(): AbstractMesh[] {
        return this._meshes
    }

    /*

    */

    abstract buildUiSchema(): UiSchema;

    /*

    */

    /** Create the tag and features, and start driving the features per frame. */
    attach(gui: AdvancedDynamicTexture, scene: Scene) {
        this._meshes = this.node instanceof AbstractMesh
            ? [this.node, ...this.node.getChildMeshes(false)]
            : this.node.getChildMeshes(false)

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
        this._meshes = []
        for (const feature of this.features) {
            feature.detach()
        }
    }
}
