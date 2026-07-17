import { Camera, Color3, Color4, DirectionalLight, HemisphericLight, ImportMeshAsync, MeshBuilder, Observable, Observer, ShadowGenerator, Vector3, type Scene, BoundingSphere } from "@babylonjs/core";
import { GridMaterial } from "@babylonjs/materials";
import { Building } from "./building/building";
import { MapCamera } from "./camera/map-camera";

export class World {

    public scene: Scene

    public buildings: Building[] = []

    public focusedBuilding: Building | undefined = undefined

    /** Fires when the camera-focused building changes. The React layer bridges this into the store. */
    public readonly onFocusChanged = new Observable<Building | undefined>()

    /*

    */

    private _onAfterCameraRender?: Observer<Camera>

    /*

    */

    constructor(scene: Scene) {
        this.scene = scene
        scene.clearColor = Color4.FromColor3(Color3.White());

        const camera = new MapCamera('camera', scene)
        camera.attachControl()

        const hemi = new HemisphericLight('hemi', new Vector3(0, 1, 0), this.scene)
        hemi.intensity = 0.9
        hemi.groundColor = new Color3(0.82, 0.82, 0.8)
        hemi.specular = Color3.Black()

        const sun = new DirectionalLight('sun', new Vector3(-0.55, -1, -0.35), this.scene)
        sun.position = new Vector3(80, 140, 60)
        sun.intensity = 0.6

        const shadowGenerator = new ShadowGenerator(2048, sun)
        shadowGenerator.useBlurExponentialShadowMap = true
        shadowGenerator.blurKernel = 32
        shadowGenerator.setDarkness(0.35)

        this._onAfterCameraRender = scene.onAfterRenderCameraObservable.add(this._afterCameraRender)
        scene.onDisposeObservable.add(this._dispose)
    }

    async load() {
        const groundMat = new GridMaterial("groundMaterial", this.scene);
        groundMat.mainColor = Color3.White()
        groundMat.lineColor = Color3.Black()

        const ground = MeshBuilder.CreateGround('ground', { width: 80, height: 80 }, this.scene)

        ground.material = groundMat

        try {
            const model = await ImportMeshAsync("/models/building.glb", this.scene)
            const rootNode = model.meshes[0]!

            const floors = [
                { name: 'floor_0', node: this.scene.getNodeByName('floor_0')! },
                { name: 'floor_1', node: this.scene.getNodeByName('floor_1')! },
                { name: 'floor_2', node: this.scene.getNodeByName('floor_2')! },
            ]

            this.buildings.push({
                name: 'building',
                rootNode,
                floors,
                visibleFloor: floors.length - 1,
            })
        } catch (err) {
            if (this.scene.isDisposed) {
                return
            }

            throw err
        }
    }

    private _dispose = () => {
        this._onAfterCameraRender?.remove()
        this._onAfterCameraRender = undefined
        this.onFocusChanged.clear()
    }

    /*
    Commands — the imperative surface the React layer calls into. UI never touches
    the scene graph directly; it issues commands here.
    */

    /** Show every floor up to and including `floor`; hide the ones above it. */
    setVisibleFloor(building: Building, floor: number) {
        building.visibleFloor = floor
        for (let i = 0; i < building.floors.length; i++) {
            building.floors[i]!.node.setEnabled(i <= floor)
        }
    }

    private _setFocusedBuilding(next: Building | undefined) {
        if (next === this.focusedBuilding) {
            return
        }

        this.focusedBuilding = next
        this.onFocusChanged.notifyObservers(next)
    }

    /*

    */

    private _afterCameraRender = (camera: Camera) => {
        let maximumCoverage = -1;
        let maximumBuilding: Building | undefined = undefined

        for (const building of this.buildings) {
            const root = building.rootNode
            const { min, max } = root.getHierarchyBoundingVectors(true)
            const bSphere = new BoundingSphere(min, max)

            const distanceToCamera = camera.mode === Camera.ORTHOGRAPHIC_CAMERA ? camera.minZ : bSphere.centerWorld.subtract(camera.globalPosition).length();

            const screenArea = camera.screenArea;
            let meshArea = (bSphere.radiusWorld * camera.minZ) / distanceToCamera;
            meshArea = meshArea * meshArea * Math.PI;

            const compareValue = meshArea / screenArea;
            if (compareValue > maximumCoverage) {
                maximumCoverage = compareValue
                maximumBuilding = building
            }
        }

        const selectedBuildingThreshold = 0.15;
        this._setFocusedBuilding(maximumCoverage > selectedBuildingThreshold ? maximumBuilding : undefined)
    }

}