import { AbstractMesh, Color3, Scene } from "@babylonjs/core"
import { AreaMaterial } from "../shaders/areaShader"
import { getLocalBoundingBox } from "../utils/bounds"
import { damp } from "../utils/tween"
import { World } from "../world"
import { Entity, EntityFeature, type EntityState } from "./entity"
import { PICK_PRIORITY } from "./pick-priority"

/**
 * Renders an area's zone as a vertical fade using {@link AreaMaterial}. The area
 * is authored in the model as an opaque "bounds mesh"; this feature replaces its
 * material with the fade and only shows it while the area is active.
 */
class AreaFadeFeature<S extends EntityState> implements EntityFeature {
    private material?: AreaMaterial

    constructor(private readonly area: Area<S>) {}

    attach(scene: Scene) {
        const material = new AreaMaterial("areaFade", scene)
        const { min } = getLocalBoundingBox(this.area.node)

        material.alpha = 0
        material.setup(min.y, min.y + 0.9, this.area.color)

        this.area.node.material = material
        this.material = material
    }

    sync(dt: number) {
        if (!this.material) {
            return
        }

        const targetAlpha = this.area.active ? 0.3 : 0
        const alpha = damp(this.material.alpha, targetAlpha, 0.005, dt)

        // Snap once imperceptibly close. `damp` only ever approaches its target,
        // and every write to `alpha` marks the material dirty — without this the
        // area materials would be re-validated on every frame, forever.
        this.material.alpha = Math.abs(alpha - targetAlpha) < 0.001 ? targetAlpha : alpha
        this.area.node.isVisible = this.material.alpha > 0.001
    }

    detach() {
        this.material?.dispose()
        this.material = undefined
    }
}

/**
 * An {@link Entity} for a single building area.
 */
export abstract class Area<S extends EntityState> extends Entity<AbstractMesh, S> {

    readonly linkOffsetY = -30
    readonly pickPriority = PICK_PRIORITY.ROOM

    readonly color: Color3

    constructor(id: string, name: string, node: AbstractMesh, world: World, color: Color3, defaultState: S) {
        super(id, name, node, world, defaultState)

        this.color = color

        this.features.push(new AreaFadeFeature(this))
    }
}
