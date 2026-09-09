import { ImplBuilder } from "@/impl";
import { AbstractMesh, ArcRotateCamera, BoundingSphere, Camera, Color3, Color4, DirectionalLight, HemisphericLight, ImageProcessingConfiguration, ImportMeshAsync, ISceneLoaderAsyncResult, KeyboardEventTypes, Material, Observable, Observer, PBRMaterial, PointerEventTypes, Scene, SelectionOutlineLayer, Vector3, type KeyboardInfo, type PointerInfo } from "@babylonjs/core";
import { AdvancedDynamicTexture, Control, TextBlock } from "@babylonjs/gui";
import { Building } from "./building/building";
import { Entity, type EntityState } from "./building/entity";
import { installPriorityPicking, setPickPriority } from "./building/pick-priority";
import { DEFAULT_RADIUS, MAP_MODE_RADIUS_RATIO, MapCamera } from "./camera/map-camera";
import { MqttTelemetry } from "./telemetry/mqtt";
import { InMemoryTimelineSource, Timeline, type SceneSnapshot, type TimelineChange } from "./telemetry/timeline";

export class World {

    public scene: Scene

    public buildings: Building[] = []

    /** Every entity in the world (areas + machine entities), populated by the impl builder before {@link load} attaches them. */
    public entities: Entity[] = []

    /*

    */

    private _focusedBuilding: Building | undefined = undefined

    public readonly onFocusBuildingChanged = new Observable<Building | undefined>()

    private _focusedEntity: Entity | undefined = undefined

    public readonly onFocusEntityChanged = new Observable<Entity | undefined>()

    private _hoveredEntity: Entity | undefined = undefined

    /** Whether the camera is zoomed out far enough that the world map should take over. */
    private _mapMode = false

    public readonly onMapModeChanged = new Observable<boolean>()

    /*

    */

    private _onAfterCameraRender?: Observer<Camera>

    private _onKeyboard?: Observer<KeyboardInfo>

    private _onPointerTap?: Observer<PointerInfo>

    private _onFpsUpdate?: Observer<Scene>

    private _cameraFocusObserver: Observer<Scene> | null = null
    private _cameraFocusStartTarget: Vector3 | null = null
    private _cameraFocusStartRadius = 0
    private _cameraFocusTargetGoal: Vector3 | null = null
    private _cameraFocusRadiusGoal: number | null = null
    private _cameraFocusElapsed = 0

    /**
     * Matches the canvas fade in `App.tsx`, so the model is only dropped from
     * the scene once it has faded out of sight rather than blanking mid-fade.
     */
    private static readonly MAP_FADE_MS = 700

    private _mapFadeTimer?: number

    /** The one shared fullscreen GUI layer. All label features attach controls here. */
    public readonly gui: AdvancedDynamicTexture

    /** Outlines the focused entity/area (black). Hover uses its own layer since a layer's outlineColor is shared by its whole selection. */
    public readonly outlineLayer: SelectionOutlineLayer

    /** Outlines the hovered entity, e.g. from the entity tree panel (white). */
    public readonly hoverOutlineLayer: SelectionOutlineLayer

    //

    /** Every attached entity (areas + custom machine entities); each owns its tag and features. */
    private readonly _entities: Entity[] = []

    /**
     * Which entity each pickable mesh belongs to, so a pointer tap resolves to
     * one in a single map lookup. Populated by {@link _registerPickTargets}.
     */
    private readonly _entityByMesh = new Map<AbstractMesh, Entity>()

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

        // Nothing in the world reacts to hover in 3D (the entity tree panel drives
        // `hoveredEntity` from React), so the pointer never needs to be resolved
        // to a mesh on move — only on tap, below. On a model this size a move
        // pick is far too expensive to run per pointer event.
        scene.skipPointerMovePicking = true

        this._onAfterCameraRender = scene.onAfterRenderCameraObservable.add(this._afterCameraRender)
        this._onKeyboard = scene.onKeyboardObservable.add(this._onKeyboardEvent)
        this._onPointerTap = scene.onPointerObservable.add(this._onSceneTap, PointerEventTypes.POINTERTAP)
        scene.onDisposeObservable.add(this._dispose)
    }

    async load() {
        /* const groundMat = new GridMaterial("groundMaterial", this.scene);
        groundMat.mainColor = Color3.White()
        groundMat.lineColor = Color3.Black()

        const ground = MeshBuilder.CreateGround('ground', { width: 80, height: 80 }, this.scene)

        ground.material = groundMat */

        try {
            // The optimized build of `demo.glb`, produced by `tools/optimize-model.sh`:
            // same node names and hierarchy, a third of the triangles and 40%
            // fewer draw calls. Re-run that script after every Blender re-export.
            const buildingModel = await ImportMeshAsync("/models/demo.glb", this.scene)

            buildingModel.animationGroups.forEach(a => a.stop())

            const materialSet = new Set(buildingModel.meshes.flatMap(m => m.material).filter(m => !!m))
            for (const material of materialSet) {
                if (!(material instanceof PBRMaterial)) {
                    continue
                }

                material.emissiveIntensity = Math.min(1, (material.emissiveIntensity - 1) / 10)
            }

            this._freezeStaticScene(buildingModel, materialSet)

            const impl = new ImplBuilder(buildingModel)
            const building = impl.build(this)

            building.activeFloor = building.floors.length - 1

            this.buildings.push(building)

            // Every entity (areas + custom machine entities) is collected into
            // `entities` by `impl.build` above. Attach each one: it builds its
            // own tag and render features (an area's zone fade, ...) and
            // self-manages them, and wires its own mqtt topic bindings during
            // `impl.build` — there is no generic topic-subscription pass here.
            for (const entity of this.entities) {
                entity.attach(this.gui, this.scene)
                this._entities.push(entity)
                this._registerPickTargets(entity)
            }

            // Project the timeline's current state onto the entities whenever it
            // changes (new live data, a seek, or going live). Idempotent: entity
            // setters no-op on unchanged values, so re-projecting the same sought
            // snapshot as live data keeps streaming in the background is cheap.
            this._timelineObserver = this.timeline.onChanged.add((change) => {
                this.applySnapshot(this.timeline.currentState(), change.animate)
            })

            // MQTT is off for the demo factory: `impl.build` above started an
            // in-browser simulation that records onto the timeline directly, so
            // there is nothing to subscribe to. `this.mqtt.connect()` no-ops
            // anyway with no registered topics; re-enable it here once real
            // topic bindings come back.
        } catch (err) {
            if (!this.scene.isDisposed) {
                throw err
            }
        }
    }

    /**
     * Lock down the imported model. Nothing in the scene moves — its animation
     * groups are stopped above — so there is no reason for Babylon to recompute
     * thousands of world matrices, re-sync every bounding box and re-validate
     * every material on each frame. Picking is switched off wholesale too;
     * {@link _registerPickTargets} turns it back on for the entity subtrees,
     * which are the only meshes a click should ever resolve to.
     *
     * Freezing a world matrix also freezes anything animating that node: if the
     * model's animation groups are ever played, the nodes they drive need
     * `unfreezeWorldMatrix()` (and `doNotSyncBoundingInfo = false`) first.
     */
    private _freezeStaticScene(model: ISceneLoaderAsyncResult, materials: Iterable<Material>) {
        for (const mesh of model.meshes) {
            mesh.isPickable = false
            // Computes the world matrix (and syncs bounding info) once, then pins it.
            mesh.freezeWorldMatrix()
            mesh.doNotSyncBoundingInfo = true
        }

        for (const node of model.transformNodes) {
            node.freezeWorldMatrix()
        }

        // `freeze` re-validates each material once, then stops re-checking it
        // every frame. Only the model's own materials: an area's fade material
        // is created later and animates its alpha.
        for (const material of materials) {
            material.freeze()
        }
    }

    /**
     * Make an entity's meshes the pick targets that resolve back to it, at its
     * own {@link Entity.pickPriority}. Each mesh starts unpickable (see
     * {@link _freezeStaticScene}); the entity's tag flips them on once it is
     * visible, and off again when its floor is hidden or its area deselected.
     */
    private _registerPickTargets(entity: Entity) {
        setPickPriority(entity.meshes, entity.pickPriority)

        for (const mesh of entity.meshes) {
            this._entityByMesh.set(mesh, entity)
        }
    }

    /**
     * A tap on an entity's mesh toggles its focus. One scene-level handler
     * replaces the `ActionManager` the tags used to install on every equipment
     * mesh: Babylon's pointer-move predicate accepts any mesh carrying one, so
     * a few hundred of them meant a full scene pick on every pointer move.
     * With none registered, picking only happens here — and the GUI's
     * `skipPointerUpPicking` still suppresses it when a control was pressed,
     * since this reads the pick Babylon already resolved for the tap.
     */
    private _onSceneTap = (info: PointerInfo) => {
        const mesh = info.pickInfo?.pickedMesh
        if (!mesh) {
            return
        }

        const entity = this._entityByMesh.get(mesh)
        if (entity) {
            this.toggleEntityFocus(entity)
        }
    }

    /** Focus `entity`, or clear the focus if it already holds it. */
    toggleEntityFocus(entity: Entity) {
        this.focusedEntity = this.focusedEntity === entity ? undefined : entity
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

        // Throttled, because a dirty control makes the GUI layer re-rasterize and
        // re-upload the screen region covering every visible tag. Written every
        // frame, this read-out alone guaranteed that happened on every frame,
        // camera moving or not. Four times a second is plenty for a debug HUD.
        const FPS_REFRESH_MS = 250
        let lastFpsRefresh = 0

        this._onFpsUpdate = this.scene.onBeforeRenderObservable.add(() => {
            const now = performance.now()
            if (now - lastFpsRefresh < FPS_REFRESH_MS) {
                return
            }

            lastFpsRefresh = now
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
        this._onPointerTap?.remove()
        this._onPointerTap = undefined
        this._onFpsUpdate?.remove()
        this._onFpsUpdate = undefined
        this._cameraFocusObserver?.remove()
        this._cameraFocusObserver = null
        clearTimeout(this._mapFadeTimer)
        this._mapFadeTimer = undefined
        this._timelineObserver?.remove()
        this._timelineObserver = undefined
        this.timeline.dispose()
        this.mqtt.dispose()
        this._entities.forEach(entity => entity.dispose())
        this._entities.length = 0
        this._entityByMesh.clear()
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
     * Coalesce every {@link recordState} made by `write` into a single timeline
     * change. A simulation sweep (or one message carrying a whole site) touches
     * a couple of dozen entities, and each change re-projects the scene and
     * wakes the React overlay — so a sweep should land as one update.
     */
    recordBatch(write: () => void) {
        this._timelineSource.batch(write)
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

        // The world map is an HTML layer over a canvas that is only faded out,
        // so the scene would otherwise keep drawing the entire factory behind
        // it, every frame, for nothing. Dropping the model's root skips it
        // wholesale; the floor visibility flags below it are left as they are.
        // Entering waits out the fade, leaving is immediate.
        clearTimeout(this._mapFadeTimer)
        this._mapFadeTimer = undefined

        if (next) {
            this._mapFadeTimer = window.setTimeout(() => this._setModelEnabled(false), World.MAP_FADE_MS)
        } else {
            this._setModelEnabled(true)
        }

        this.onMapModeChanged.notifyObservers(next)
    }

    private _setModelEnabled(enabled: boolean) {
        for (const building of this.buildings) {
            building.rootNode.setEnabled(enabled)
        }
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