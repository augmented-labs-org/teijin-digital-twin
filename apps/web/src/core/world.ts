import { ArcRotateCamera, BoundingSphere, Camera, Color3, Color4, DirectionalLight, HemisphericLight, ImportMeshAsync, MeshBuilder, Observable, Observer, PointerEventTypes, SelectionOutlineLayer, ShadowGenerator, Vector3, type Scene } from "@babylonjs/core";
import { AdvancedDynamicTexture } from "@babylonjs/gui";
import { GridMaterial } from "@babylonjs/materials";
import { Building } from "./building/building";
import { Entity } from "./building/entity";
import { installPriorityPicking } from "./building/pick-priority";
import { MapCamera } from "./camera/map-camera";

export class EntityGroup {
    readonly world: World
    readonly name: string
    readonly entities: Entity[]

    private _active = false

    constructor(world: World, name: string, entities: Entity[]) {
        this.world = world
        this.name = name
        this.entities = entities
    }

    get active() {
        return this._active
    }

    set active(val: boolean) {
        if (val === this._active) {
            return
        }

        if (!this.active && this.world.focusedEntity && this.entities.includes(this.world.focusedEntity)) {
            this.world.focusedEntity = undefined
        }

        this._active = val
        this.world.onEntityGroupActiveChanged.notifyObservers(this)
    }
}

export class World {

    public scene: Scene

    public buildings: Building[] = []

    public entityGroups: EntityGroup[] = []

    /*

    */

    private _focusedBuilding: Building | undefined = undefined

    public readonly onFocusBuildingChanged = new Observable<Building | undefined>()

    private _focusedEntity: Entity | undefined = undefined

    public readonly onFocusEntityChanged = new Observable<Entity | undefined>()

    public readonly onEntityGroupActiveChanged = new Observable<EntityGroup>()

    /*

    */

    private _onAfterCameraRender?: Observer<Camera>

    private _cameraFocusObserver: Observer<Scene> | null = null
    private _cameraFocusStartTarget: Vector3 | null = null
    private _cameraFocusStartRadius = 0
    private _cameraFocusTargetGoal: Vector3 | null = null
    private _cameraFocusRadiusGoal: number | null = null
    private _cameraFocusElapsed = 0

    /** The one shared fullscreen GUI layer. All label features attach controls here. */
    public readonly gui: AdvancedDynamicTexture

    public readonly outlineLayer: SelectionOutlineLayer

    //

    /** Every attached entity (areas + equipment); each owns its tag and features. */
    private readonly _entities: Entity[] = []

    /*

    */

    constructor(scene: Scene) {
        this.scene = scene
        scene.clearColor = Color4.FromColor3(Color3.White());

        // Resolve pointer picks by priority (equipment over the room enclosing it)
        // rather than raw depth. Global + idempotent; harmless to unmarked meshes.
        installPriorityPicking()

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
        this.initGui()

        this.outlineLayer = new SelectionOutlineLayer("worldSelectionOutline", this.scene)
        this.outlineLayer.outlineColor = new Color3(0.1, 0.1, 0.1);
        this.outlineLayer.outlineThickness = 2.0;
        this.outlineLayer.occlusionStrength = 0;

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
            const buildingModel = await ImportMeshAsync("/models/factory.glb", this.scene)
            const buildingRootNode = buildingModel.meshes[0]!

            const building = new Building(this, 'Factory', buildingRootNode)

            const floor = building.addFloor("Floor 0", buildingModel.meshes.find(x => x.name === 'Floor 0')!)

            const areaEntrance = floor.addArea('Entrance', buildingModel.meshes.find(x => x.name === 'Area 1 - Entrance')!);
            const areaWarehouse1 = floor.addArea('Warehouse 1', buildingModel.meshes.find(x => x.name === 'Area 2 - Warehouse 1')!);
            const areaWarehouse2 = floor.addArea('Warehouse 2', buildingModel.meshes.find(x => x.name === 'Area 3 - Warehouse 2')!);
            const areaFactory = floor.addArea('Factory', buildingModel.meshes.find(x => x.name === 'Area 4 - Factory')!);
            const areaLab1 = floor.addArea('Lab 1', buildingModel.meshes.find(x => x.name === 'Area 5 - Lab 1')!);
            const areaLab2 = floor.addArea('Lab 2', buildingModel.meshes.find(x => x.name === 'Area 6 - Lab 2')!);
            const areaLab3 = floor.addArea('Lab 3', buildingModel.meshes.find(x => x.name === 'Area 7 - Lab 3')!);
            const areaDressingRoom = floor.addArea('dressing room', buildingModel.meshes.find(x => x.name === 'Area 8 - dressing room')!);
            const areaPantry = floor.addArea('Pantry', buildingModel.meshes.find(x => x.name === 'Area 9 - Pantry')!);
            const areaWc1 = floor.addArea('WC 1', buildingModel.meshes.find(x => x.name === 'Area 10 - WC 1')!);
            const areaWc2 = floor.addArea('WC 2', buildingModel.meshes.find(x => x.name === 'Area 11 - WC 2')!);
            const areaOffice1 = floor.addArea('Office 1', buildingModel.meshes.find(x => x.name === 'Area 12 - Office 1')!);
            const areaOffice2 = floor.addArea('Office 2', buildingModel.meshes.find(x => x.name === 'Area 13 - Office 2')!);
            const areaOffice3 = floor.addArea('Office 3', buildingModel.meshes.find(x => x.name === 'Area 14 - Office 3')!);
            const areaOffice4 = floor.addArea('Office 4', buildingModel.meshes.find(x => x.name === 'Area 15 - Office 4')!);

            building.activeFloor = building.floors.length - 1

            this.buildings.push(building)

            // Attach every area and its equipment. Each entity builds its own tag
            // and render features (an area's zone fade, ...) and self-manages them.
            const areas = building.floors.flatMap(f => f.areas)
            for (const entity of [...areas, ...areas.flatMap(a => a.equipments)]) {
                entity.attach(this.gui, this.scene)
                this._entities.push(entity)
            }

            this.entityGroups.push(new EntityGroup(this, 'Areas', [
                areaEntrance,
                areaWarehouse1,
                areaWarehouse2,
                areaFactory,
                areaLab1,
                areaLab2,
                areaLab3,
                areaDressingRoom,
                areaPantry,
                areaWc1,
                areaWc2,
                areaOffice1,
                areaOffice2,
                areaOffice3,
                areaOffice4
            ]))

        } catch (err) {
            if (!this.scene.isDisposed) {
                throw err
            }
        }
    }

    private initGui() {
        this.gui.skipBlockEvents =
            PointerEventTypes.POINTERDOWN |
            PointerEventTypes.POINTERMOVE |
            PointerEventTypes.POINTERUP |
            PointerEventTypes.POINTERWHEEL

        this.gui.usePointerTapForClickEvent = true

        // Reset at the start of every press. insertFirst so this runs before the GUI's
        // own pointer handler reports a picked control below, letting a control press win.
        this.scene.onPrePointerObservable.add(
            () => {
                this.scene.skipPointerUpPicking = false
            },
            PointerEventTypes.POINTERDOWN,
            true,
        )
        // A press landed on a control: drop the pending pointer-up mesh pick.
        this.gui.onControlPickedObservable.add(() => {
            this.scene.skipPointerUpPicking = true
        })
    }

    /*

    */

    private _dispose = () => {
        this._onAfterCameraRender?.remove()
        this._onAfterCameraRender = undefined
        this._cameraFocusObserver?.remove()
        this._cameraFocusObserver = null
        this._entities.forEach(entity => entity.dispose())
        this._entities.length = 0
        this.gui.dispose()
        this.outlineLayer.dispose()
        this.onFocusBuildingChanged.clear()
    }

    /** Show every floor up to and including `floor`; hide the ones above it. */
    setVisibleFloor(building: Building, floor: number) {
        building.activeFloor = floor
        for (let i = 0; i < building.floors.length; i++) {
            building.floors[i]!.node.setEnabled(i <= floor)
        }
    }

    /*

    */

    get focusedBuilding() {
        return this._focusedBuilding
    }

    set focusedBuilding(next: Building | undefined) {
        if (next === this._focusedBuilding) {
            return
        }

        if (this._focusedBuilding) {
            this._focusedBuilding.focused = false
        }

        this._focusedBuilding = next

        if (this._focusedBuilding) {
            this._focusedBuilding.focused = true
        }

        if (this.focusedEntity && this.focusedEntity.floor.building !== next) {
            this.focusedEntity = undefined
        }

        this.onFocusBuildingChanged.notifyObservers(next)
    }

    get focusedEntity() {
        return this._focusedEntity
    }

    set focusedEntity(next: Entity | undefined) {
        if (next === this._focusedEntity) {
            return
        }

        if (this._focusedEntity) {
            this._focusedEntity.focused = false
        }

        this._focusedEntity = next

        if (this._focusedEntity) {
            this._focusedEntity.focused = true
        }

        this.onFocusEntityChanged.notifyObservers(next)

        if (this._focusedEntity) {
            this.moveCameraToFocusedEntity()
        }
    }

    /*

    */

    /** Smoothly pan/zoom the active camera so the focused entity's bounds fill the viewport. */
    moveCameraToFocusedEntity() {
        const entity = this._focusedEntity
        const camera = this.scene.activeCamera
        if (!entity || !(camera instanceof ArcRotateCamera)) {
            return
        }

        const { min, max } = entity.node.getHierarchyBoundingVectors(true)
        const center = min.add(max).scale(0.5)

        // Same frustum-fitting formula ArcRotateCamera.zoomOn uses internally, so the
        // entity's bounding sphere ends up fully inside the viewport on both axes.
        const aspectRatio = this.scene.getEngine().getAspectRatio(camera)
        const verticalSlope = Math.tan(camera.fov / 2)
        const horizontalSlope = verticalSlope * aspectRatio

        const boundingRadius = Vector3.Distance(min, max) * 0.5
        const distanceForVertical = boundingRadius * Math.sqrt(1 + 1 / (verticalSlope * verticalSlope))
        const distanceForHorizontal = boundingRadius * Math.sqrt(1 + 1 / (horizontalSlope * horizontalSlope))

        const framingPadding = 1.3
        const rawRadius = Math.max(distanceForVertical, distanceForHorizontal) * framingPadding
        const targetRadius = Math.min(
            Math.max(rawRadius, camera.lowerRadiusLimit ?? 0),
            camera.upperRadiusLimit ?? rawRadius,
        )

        this._animateCameraTo(camera, center, targetRadius)
    }

    /**
     * Eases `target`/`radius` to their goals over a fixed duration with a cubic ease-in-out curve,
     * so the camera accelerates out of rest and decelerates into the goal. Re-targeting mid-flight
     * (e.g. focusing a new entity before the previous focus finished) restarts the ease from the
     * camera's current position/radius, keeping motion continuous rather than snapping from rest.
     */
    private _animateCameraTo(camera: ArcRotateCamera, target: Vector3, radius: number) {
        this._cameraFocusStartTarget = camera.target.clone()
        this._cameraFocusStartRadius = camera.radius
        this._cameraFocusTargetGoal = target.clone()
        this._cameraFocusRadiusGoal = radius
        this._cameraFocusElapsed = 0

        if (this._cameraFocusObserver) {
            return
        }

        camera.detachControl()

        const duration = 0.6

        // Cubic ease-in-out: slow near the endpoints, fast through the middle.
        const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)

        this._cameraFocusObserver = this.scene.onBeforeRenderObservable.add(() => {
            const startTarget = this._cameraFocusStartTarget
            const targetGoal = this._cameraFocusTargetGoal
            const radiusGoal = this._cameraFocusRadiusGoal
            if (startTarget === null || targetGoal === null || radiusGoal === null) {
                return
            }

            const dt = this.scene.getEngine().getDeltaTime() / 1000
            if (dt <= 0) {
                return
            }

            this._cameraFocusElapsed += dt
            const t = Math.min(this._cameraFocusElapsed / duration, 1)
            const k = easeInOut(t)

            camera.target = Vector3.Lerp(startTarget, targetGoal, k)
            camera.radius = this._cameraFocusStartRadius + (radiusGoal - this._cameraFocusStartRadius) * k

            if (t >= 1) {
                camera.target = targetGoal.clone()
                camera.radius = radiusGoal

                this._cameraFocusObserver?.remove()
                this._cameraFocusObserver = null
                this._cameraFocusStartTarget = null
                this._cameraFocusTargetGoal = null
                this._cameraFocusRadiusGoal = null
                this._cameraFocusElapsed = 0

                camera.attachControl()
            }
        })
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
        this.focusedBuilding = maximumCoverage > selectedBuildingThreshold ? maximumBuilding : undefined
    }

}