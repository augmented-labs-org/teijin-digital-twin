import { ArcRotateCamera, BoundingSphere, Camera, Color3, Color4, DirectionalLight, GlowLayer, HemisphericLight, ImportMeshAsync, KeyboardEventTypes, Mesh, MeshBuilder, Observable, Observer, PBRMaterial, PointerEventTypes, SelectionOutlineLayer, ShadowGenerator, Vector3, type KeyboardInfo, type Scene } from "@babylonjs/core";
import { AdvancedDynamicTexture } from "@babylonjs/gui";
import { GridMaterial } from "@babylonjs/materials";
import { Building } from "./building/building";
import { Entity } from "./building/entity";
import { installPriorityPicking } from "./building/pick-priority";
import { MapCamera } from "./camera/map-camera";
import { MqttTelemetry } from "./telemetry/mqtt";
import { ImplBuilder } from "@/impl";

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

    private _onKeyboard?: Observer<KeyboardInfo>

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

    /** Live sensor feed from the Coreflux broker, wired to topic-bound stats. */
    public readonly mqtt = new MqttTelemetry()

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

        const gl = new GlowLayer("glow", scene, { 
            blurKernelSize: 64,
        });

        gl.intensity = 1.2;

        this.gui = AdvancedDynamicTexture.CreateFullscreenUI("worldUI", true, scene, undefined, true)
        this.initGui()

        this.outlineLayer = new SelectionOutlineLayer("worldSelectionOutline", this.scene)
        this.outlineLayer.outlineColor = new Color3(0.1, 0.1, 0.1);
        this.outlineLayer.outlineThickness = 2.0;
        this.outlineLayer.occlusionStrength = 0;

        this._onAfterCameraRender = scene.onAfterRenderCameraObservable.add(this._afterCameraRender)
        this._onKeyboard = scene.onKeyboardObservable.add(this._onKeyboardEvent)
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

            const materialSet = new Set(buildingModel.meshes.flatMap(m => m.material).filter(m => !!m))
            for (const material of materialSet) {
                if (!(material instanceof PBRMaterial)) {
                    continue
                }

                material.emissiveIntensity = Math.min(1, (material.emissiveIntensity - 1) / 10)
                console.log(material.name, material.emissiveIntensity)
            }

            const impl = new ImplBuilder(buildingModel)
            const building = impl.build(this)

            building.activeFloor = building.floors.length - 1

            this.buildings.push(building)

            // Attach every area and its equipment. Each entity builds its own tag
            // and render features (an area's zone fade, ...) and self-manages them.
            const areas = building.floors.flatMap(f => f.areas)
            for (const entity of [...areas, ...areas.flatMap(a => a.equipments)]) {
                entity.attach(this.gui, this.scene)
                this._entities.push(entity)
            }

            // Subscribe every topic-bound stat to the Coreflux broker and start
            // streaming live sensor values into their detail cards.
            this._entities.flatMap(e => e.stats).forEach(stat => {
                if (!stat.topic) {
                    return
                }

                this.mqtt.register(stat.topic, (data) => {
                    const value = data && typeof data === "object" && "value" in data ? data.value : data
                    stat.value = stat.format ? stat.format(value) : String(value)
                })
            })

            this.mqtt.connect()
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

        // A press landed on a real control: drop the pending pointer-up mesh pick.
        // The fullscreen root container "contains" every point and is hit-test
        // visible, so it reports itself as picked on every down — ignore it, or no
        // click on a bare entity mesh would ever pick (skipPointerUpPicking would
        // be stuck on).
        this.gui.onControlPickedObservable.add((control) => {
            if (control === this.gui.rootContainer) {
                return
            }
            this.scene.skipPointerUpPicking = true
        })
    }

    /*

    */

    /** ESC clears the focused entity. */
    private _onKeyboardEvent = (info: KeyboardInfo) => {
        if (info.type === KeyboardEventTypes.KEYDOWN && info.event.key === "Escape") {
            this.focusedEntity = undefined
        }
    }

    private _dispose = () => {
        this._onAfterCameraRender?.remove()
        this._onAfterCameraRender = undefined
        this._onKeyboard?.remove()
        this._onKeyboard = undefined
        this._cameraFocusObserver?.remove()
        this._cameraFocusObserver = null
        this.mqtt.dispose()
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