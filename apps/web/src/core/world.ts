import { BoundingSphere, Camera, Color3, Color4, DirectionalLight, HemisphericLight, ImportMeshAsync, MeshBuilder, NodeMaterialDefines, Observable, Observer, ShadowGenerator, Vector3, type Scene } from "@babylonjs/core";
import { AdvancedDynamicTexture } from "@babylonjs/gui";
import { GridMaterial } from "@babylonjs/materials";
import { Building, BuildingFloor, BuildingRoom } from "./building/building";
import { EquipmentTag } from "./building/equipment";
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

    /** The one shared fullscreen GUI layer. All label features attach controls here. */
    public readonly gui: AdvancedDynamicTexture

    /** One screen-space tag per equipment, anchored to its mesh on the shared GUI layer. */
    private readonly _equipmentTags: EquipmentTag[] = []

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

        this.gui = AdvancedDynamicTexture.CreateFullscreenUI("worldUI", true, scene, undefined, true)

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
            const buildingModel = await ImportMeshAsync("/models/building.glb", this.scene)
            const buildingRootNode = buildingModel.meshes[0]!

            const floor2Rooms: BuildingRoom[] = [
                {
                    name: 'Horto', node: buildingModel.meshes.find(x => x.name === 'Room 1')!, equipments: [
                        { name: 'Arbusto', node: buildingModel.meshes.find(x => x.name === 'Bush_07')!, online: true, running: false, errored: false }
                    ]
                },
                { name: 'Stand', node: buildingModel.meshes.find(x => x.name === 'Room 2')!, equipments: [
                        { name: 'Porsche', node: buildingModel.transformNodes.find(x => x.name === 'Car_16')!, online: false, running: false, errored: false },
                        { name: 'Lamborghini', node: buildingModel.transformNodes.find(x => x.name === 'Car_16.001')!, online: true, running: false, errored: true, errorReason: 'No engine' }
                ] },
                { name: 'Room 3', node: buildingModel.meshes.find(x => x.name === 'Room 3')!, equipments: [] },
            ]
            console.log(floor2Rooms)

            const buildingFloors: BuildingFloor[] = [
                { name: 'Floor 0', node: buildingModel.transformNodes.find(x => x.name === 'Floor 0')!, rooms: [] },
                { name: 'Floor 1', node: buildingModel.transformNodes.find(x => x.name === 'Floor 1')!, rooms: [] },
                { name: 'Floor 2', node: buildingModel.transformNodes.find(x => x.name === 'Floor 2')!, rooms: floor2Rooms },
            ]

            buildingFloors.flatMap(f => f.rooms).forEach(r => {
                r.node.visibility = 0;
            })

            const building: Building = {
                name: `Building`,
                rootNode: buildingRootNode,
                floors: buildingFloors,
                visibleFloor: buildingFloors.length - 1,
            }
            this.buildings.push(building)

            for (const equipment of building.floors.flatMap(f => f.rooms).flatMap(r => r.equipments)) {
                this._equipmentTags.push(new EquipmentTag(equipment, this.gui, this.scene))
            }
        } catch (err) {
            if (!this.scene.isDisposed) {
                throw err
            }
        }
    }

    private _dispose = () => {
        this._onAfterCameraRender?.remove()
        this._onAfterCameraRender = undefined
        this._equipmentTags.forEach(tag => tag.dispose())
        this._equipmentTags.length = 0
        this.gui.dispose()
        this.onFocusChanged.clear()
    }

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