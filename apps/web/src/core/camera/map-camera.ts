import {
    ArcRotateCamera,
    Scene,
    Vector3,
} from '@babylonjs/core'
import { MapCameraPointersInput } from './map-camera-input'

const DEFAULT_ALPHA = -Math.PI / 2 - 0.5
const DEFAULT_BETA = 0.8
const DEFAULT_RADIUS = 100

// MapCamera replicates google maps camera style
export class MapCamera extends ArcRotateCamera {

    constructor(name: string, scene?: Scene) {
        super(name, DEFAULT_ALPHA, DEFAULT_BETA, DEFAULT_RADIUS, Vector3.Zero(), scene)

        // Limits
        this.lowerRadiusLimit = 1
        this.upperRadiusLimit = 2000
        this.upperBetaLimit = Math.PI / 2.5
        this.minZ = 1
        this.maxZ = 30000

        this.inertia = 0.35
        this.wheelDeltaPercentage = 0.05
        this.zoomToMouseLocation = true
    }

    attachControl() {
        // Replace the built-in pointers input with the map-style one before the
        // input manager attaches everything to the DOM.
        const defaultPointers = this.inputs.attached["pointers"]
        if (defaultPointers) {
            this.inputs.remove(defaultPointers)
        }
        
        this.inputs.add(new MapCameraPointersInput())

        super.attachControl()
    }

}