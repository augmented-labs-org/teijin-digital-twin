import { ImplBuilder } from "@/impl";
import { ArcRotateCamera, BoundingSphere, Camera, Color3, Color4, DefaultRenderingPipeline, DirectionalLight, HemisphericLight, ImageProcessingConfiguration, ImportMeshAsync, KeyboardEventTypes, Observable, Observer, PBRMaterial, PointerEventTypes, Scene, SelectionOutlineLayer, Vector3, type KeyboardInfo } from "@babylonjs/core";
import { AdvancedDynamicTexture, Control, TextBlock } from "@babylonjs/gui";
import { Building } from "./building/building";
import { Entity, type EntityState } from "./building/entity";
import { installPriorityPicking } from "./building/pick-priority";
import { DEFAULT_RADIUS, MAP_MODE_RADIUS_RATIO, MapCamera } from "./camera/map-camera";
import { MqttTelemetry } from "./telemetry/mqtt";
import { InMemoryTimelineSource, Timeline, type SceneSnapshot, type TimelineChange } from "./telemetry/timeline";

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

    private _hoveredEntity: Entity | undefined = undefined

    public readonly onEntityGroupActiveChanged = new Observable<EntityGroup>()

    /** Whether the camera is zoomed out far enough that the world map should take over. */
    private _mapMode = false

    public readonly onMapModeChanged = new Observable<boolean>()

    /*

    */

    private _onAfterCameraRender?: Observer<Camera>

    private _onKeyboard?: Observer<KeyboardInfo>

    private _onFpsUpdate?: Observer<Scene>

    private _cameraFocusObserver: Observer<Scene> | null = null
    private _cameraFocusStartTarget: Vector3 | null = null
    private _cameraFocusStartRadius = 0
    private _cameraFocusTargetGoal: Vector3 | null = null
    private _cameraFocusRadiusGoal: number | null = null
    private _cameraFocusElapsed = 0

    /** The one shared fullscreen GUI layer. All label features attach controls here. */
    public readonly gui: AdvancedDynamicTexture

    /** Outlines the focused entity/area (black). Hover uses its own layer since a layer's outlineColor is shared by its whole selection. */
    public readonly outlineLayer: SelectionOutlineLayer

    /** Outlines the hovered entity, e.g. from the entity tree panel (white). */
    public readonly hoverOutlineLayer: SelectionOutlineLayer

    //

    /** Every attached entity (areas + custom machine entities); each owns its tag and features. */
    private readonly _entities: Entity[] = []

    /** Live sensor feed from the Coreflux broker; entities wire their own topic bindings against it. */
    public readonly mqtt = new MqttTelemetry()

    /** In-memory history of structured entity state; swappable for a DB source later. */
    private readonly _timelineSource = new InMemoryTimelineSource()

    /**
     * Drives which moment the scene displays. The scene is a pure projection of
     * {@link Timeline.currentState} — live data and scrubbed history both flow
     * through the same {@link applySnapshot} path.
     */
    public readonly timeline = new Timeline(this._timelineSource)

    private _timelineObserver?: Observer<TimelineChange>

    /** Whether the in-progress projection should play transition animations or snap. */
    private _projectionAnimates = true

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

        scene.imageProcessingConfiguration.toneMappingEnabled = true
        scene.imageProcessingConfiguration.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES

        this.gui = AdvancedDynamicTexture.CreateFullscreenUI("worldUI", true, scene, undefined, true)
        this.initGui()

        this.outlineLayer = new SelectionOutlineLayer("worldSelectionOutline", this.scene)
        this.outlineLayer.outlineColor = new Color3(0.1, 0.1, 0.1);
        this.outlineLayer.outlineThickness = 2.0;
        this.outlineLayer.occlusionStrength = 0;

        this.hoverOutlineLayer = new SelectionOutlineLayer("worldHoverSelectionOutline", this.scene)
        this.hoverOutlineLayer.outlineColor = Color3.White();
        this.hoverOutlineLayer.outlineThickness = 2.0;
        this.hoverOutlineLayer.occlusionStrength = 0;

        this._onAfterCameraRender = scene.onAfterRenderCameraObservable.add(this._afterCameraRender)
        this._onKeyboard = scene.onKeyboardObservable.add(this._onKeyboardEvent)
        scene.onDisposeObservable.add(this._dispose)
    }

    async load() {
        /* const groundMat = new GridMaterial("groundMaterial", this.scene);
        groundMat.mainColor = Color3.White()
        groundMat.lineColor = Color3.Black()

        const ground = MeshBuilder.CreateGround('ground', { width: 80, height: 80 }, this.scene)

        ground.material = groundMat */

        try {
            const buildingModel = await ImportMeshAsync("/models/teijin3.glb", this.scene)

            buildingModel.animationGroups.forEach(a => a.stop())

            const materialSet = new Set(buildingModel.meshes.flatMap(m => m.material).filter(m => !!m))
            for (const material of materialSet) {
                if (!(material instanceof PBRMaterial)) {
                    continue
                }

                material.emissiveIntensity = Math.min(1, (material.emissiveIntensity - 1) / 10)
            }

            const impl = new ImplBuilder(buildingModel)
            const building = impl.build(this)

            building.activeFloor = building.floors.length - 1

            this.buildings.push(building)

            // Every entity (areas + custom machine entities) is collected into
            // `entityGroups` by `impl.build` above. Attach each one: it builds its
            // own tag and render features (an area's zone fade, ...) and
            // self-manages them, and wires its own mqtt topic bindings during
            // `impl.build` — there is no generic topic-subscription pass here.
            const entities = new Set(this.entityGroups.flatMap(g => g.entities))
            for (const entity of entities) {
                entity.attach(this.gui, this.scene)
                this._entities.push(entity)
            }

            // Project the timeline's current state onto the entities whenever it
            // changes (new live data, a seek, or going live). Idempotent: entity
            // setters no-op on unchanged values, so re-projecting the same sought
            // snapshot as live data keeps streaming in the background is cheap.
            this._timelineObserver = this.timeline.onChanged.add((change) => {
                this.applySnapshot(this.timeline.currentState(), change.animate)
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

        const fpsText = new TextBlock("fpsCounter")
        fpsText.text = "0 FPS"
        fpsText.color = "white"
        fpsText.outlineColor = "black"
        fpsText.outlineWidth = 3
        fpsText.fontFamily = "monospace"
        fpsText.fontSize = 14
        fpsText.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_RIGHT
        fpsText.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP
        fpsText.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_RIGHT
        fpsText.left = -8
        fpsText.top = 8
        fpsText.width = "80px"
        fpsText.height = "20px"
        fpsText.isPointerBlocker = false
        this.gui.addControl(fpsText)

        this._onFpsUpdate = this.scene.onBeforeRenderObservable.add(() => {
            fpsText.text = `${this.scene.getEngine().getFps().toFixed(0)} FPS`
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
        this._onFpsUpdate?.remove()
        this._onFpsUpdate = undefined
        this._cameraFocusObserver?.remove()
        this._cameraFocusObserver = null
        this._timelineObserver?.remove()
        this._timelineObserver = undefined
        this.timeline.dispose()
        this.mqtt.dispose()
        this._entities.forEach(entity => entity.dispose())
        this._entities.length = 0
        this.gui.dispose()
        this.outlineLayer.dispose()
        this.hoverOutlineLayer.dispose()
        this.onFocusBuildingChanged.clear()
        this.onMapModeChanged.clear()
    }

    /**
     * Record a structured, interpreted state update for an entity onto the
     * timeline. This is the only place live broker data enters the history; a
     * future database-backed source would populate history elsewhere and this
     * would go away. `S` is inferred from the partial passed at the call site —
     * callers don't need to name their entity's state type explicitly. Every
     * concrete state's fields are optional by convention, so a partial update
     * is itself a valid `S`; no `Partial<S>` wrapper is needed (and one would
     * defeat generic inference from an object literal argument).
     */
    recordState<S extends EntityState = EntityState>(key: string, partial: S) {
        this._timelineSource.record(key, partial, Date.now())
    }

    /**
     * Whether the state change currently being projected should play transition
     * animations (real-time live update) or snap to the final pose (a seek or
     * go-live jump). Read by entities' view side-effects when {@link Entity.state} is set.
     */
    get projectionAnimates() {
        return this._projectionAnimates
    }

    /**
     * Project a structured scene snapshot onto the entities that appear in it.
     * `animate` is threaded to entity view side-effects (e.g. press animations)
     * via {@link projectionAnimates} for the duration of the synchronous apply.
     */
    applySnapshot(snapshot: SceneSnapshot, animate = true) {
        this._projectionAnimates = animate
        for (const entity of this._entities) {
            const state = snapshot[entity.id]
            if (state) {
                entity.state = state
            }
        }
        // Default back to animating for any state change outside a projection.
        this._projectionAnimates = true
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

        if (this.focusedEntity && this.focusedEntity.building !== next) {
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
        this._syncOutlineSelection()

        if (this._focusedEntity) {
            this.moveCameraToFocusedEntity()
        }
    }

    get hoveredEntity() {
        return this._hoveredEntity
    }

    /** Highlights an entity in the scene via {@link outlineLayer} without focusing it (e.g. hovering it in the entity tree). */
    set hoveredEntity(next: Entity | undefined) {
        if (next === this._hoveredEntity) {
            return
        }

        this._hoveredEntity = next
        this._syncOutlineSelection()
    }

    /**
     * Recomputes the outline layers' selections from the current focused and hovered
     * entities. Each layer only supports replacing its whole selection at once, so
     * both are re-added here rather than managed independently by each entity. Focus
     * and hover live on separate layers since a layer's outlineColor applies to its
     * whole selection.
     */
    private _syncOutlineSelection() {
        this.outlineLayer.clearSelection()
        this.hoverOutlineLayer.clearSelection()
        
        if (this._hoveredEntity) {
            this.hoverOutlineLayer.addSelection(this._hoveredEntity.getOutlineMeshes())
        }
        
        if (this._focusedEntity && this._focusedEntity !== this._hoveredEntity) {
            this.outlineLayer.addSelection(this._focusedEntity.getOutlineMeshes())
        }
    }

    get mapMode() {
        return this._mapMode
    }

    set mapMode(next: boolean) {
        if (next === this._mapMode) {
            return
        }

        this._mapMode = next
        this.onMapModeChanged.notifyObservers(next)
    }

    /**
     * Leave the world map and fly the camera back to the default scene view.
     * Called when a factory marker is clicked or the map is zoomed in a lot.
     */
    exitMapMode() {
        this.mapMode = false

        const camera = this.scene.activeCamera
        if (camera instanceof ArcRotateCamera) {
            camera.target = Vector3.Zero()
            camera.radius = DEFAULT_RADIUS
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
        // Zooming out past most of the camera's range hands off to the world map.
        // Only auto-enters map mode; leaving it is an explicit user action
        // (marker click or zooming in a lot on the map) via `exitMapMode`.
        if (!this.mapMode && camera instanceof ArcRotateCamera) {
            const upperRadiusLimit = camera.upperRadiusLimit ?? Infinity
            if (camera.radius >= upperRadiusLimit * MAP_MODE_RADIUS_RATIO) {
                this.mapMode = true
            }
        }

        let maximumCoverage = -1;
        let maximumBuilding: Building | undefined = undefined

        for (const building of this.buildings) {
            const bSphere = new BoundingSphere(building.boundsMin, building.boundsMax)

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