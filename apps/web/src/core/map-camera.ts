import {
    ArcRotateCamera,
    Matrix,
    Plane,
    PointerEventTypes,
    Scene,
    Vector3,
} from '@babylonjs/core'

const DEFAULT_ALPHA = -Math.PI / 2 - 0.5
const DEFAULT_BETA = 1.05
const DEFAULT_RADIUS = 500

// MapCamera replicates google maps camera style
export class MapCamera extends ArcRotateCamera {

    constructor(name: string, scene?: Scene) {
        super(name, DEFAULT_ALPHA, DEFAULT_BETA, DEFAULT_RADIUS, Vector3.Zero(), scene)

        // Limits
        this.lowerRadiusLimit = 10
        this.upperRadiusLimit = 2000
        this.upperBetaLimit = Math.PI / 2.1
        this.minZ = 1
        this.maxZ = 3000

        // Feel
        this.inertia = 0.35
        this.angularSensibilityX = 500
        this.angularSensibilityY = 500

        // Delta scales with the current radius instead of a fixed step
        this.wheelDeltaPercentage = 0.05

        this._setupCursorAnchoredPan();
    }

    /*

    */

    // Makes it so that when panning, the object below the cursor stays below the cursor, regardless of the zoom level.
    private _setupCursorAnchoredPan() {
        const camera = this
        const scene = this.getScene()

        let panPlane: Plane | null = null
        let panAnchor: Vector3 | null = null

        const pickPlane = (): Vector3 | null => {
            if (!panPlane) {
                return null
            }

            const ray = scene.createPickingRay(scene.pointerX, scene.pointerY, Matrix.Identity(), camera, false)
            const distance = ray.intersectsPlane(panPlane)
            if (distance === null) {
                return null
            }

            return ray.origin.add(ray.direction.scale(distance))
        }

        scene.onPointerObservable.add((info) => {
            const event = info.event as PointerEvent
            switch (info.type) {
                case PointerEventTypes.POINTERDOWN: {
                    if (event.button !== 0 || event.shiftKey) {
                        return
                    }

                    const surfaceHit = scene.pick(scene.pointerX, scene.pointerY, undefined, false, camera)
                    const anchorPoint = surfaceHit.hit ? surfaceHit.pickedPoint : null
                    panPlane = Plane.FromPositionAndNormal(anchorPoint ?? camera.target, Vector3.Up())
                    panAnchor = anchorPoint ?? pickPlane()
                    break
                }
                
                case PointerEventTypes.POINTERMOVE: {
                    if (!panAnchor) {
                        return
                    }

                    const hit = pickPlane()
                    if (!hit) {
                        return
                    }

                    camera.target.addInPlace(panAnchor.subtract(hit))
                    break
                }

                case PointerEventTypes.POINTERUP: {
                    panPlane = null
                    panAnchor = null
                    break
                }
            }
        })
    }

}