import { EventState, Observer, Scene, TransformNode, Vector3 } from "@babylonjs/core"
import { AdvancedDynamicTexture, Control, Ellipse, Rectangle, TextBlock, Vector2WithInfo } from "@babylonjs/gui"
import { getLocalBoundingBox } from "../utils/bounds"
import { guiPadding } from "../utils/gui"
import { type Entity } from "./entity"

const CARD_BACKGROUND = "#ffffff"
const TEXT_PRIMARY = "#111827"

/** Higher = snappier fade/scale transitions. */
const ANIM_SPEED = 14

/**
 * Granularity, in metres, of the camera distance a tag's depth ordering is
 * derived from. Every change to a control's `zIndex` re-sorts the GUI's control
 * list (and re-links it to its anchor), so ordering is bucketed this coarsely
 * rather than tracking distance continuously: two tags within one bucket of
 * each other keep whatever order they had, which is invisible in practice.
 */
const DEPTH_BUCKET_METRES = 10

/**
 * A screen-space tag anchored to an {@link Entity}, attached to the world's
 * shared GUI layer. One class serves every kind of entity — the entity supplies
 * what varies.
 *
 * Behaviour:
 *  - By default shows a name pill with a status-colored border.
 *  - Distance/activity-driven LOD: full label when the entity is active, a
 *    status dot when inactive, nothing when the node is disabled.
 *  - Clicking the label (or dot, or the node's meshes) focuses the entity,
 *    which drives the "Entity Details" card in the React layer; clicking again
 *    unfocuses it.
 *
 * The tag reads everything it needs off the entity — {@link Entity.name},
 * {@link Entity.active}, and the pick priority / link offset / id prefix — and
 * drives its own per-frame update via a scene observer, so callers only need
 * to construct it and {@link dispose} it.
 */
export class EntityTag {
    private readonly node: TransformNode
    /**
     * Zero-offset child of {@link node} that every control links to. Babylon's
     * GUI projects an {@link AbstractMesh} at its bounding-box center but a plain
     * {@link TransformNode} at its origin; linking to this anchor — which has no
     * bounding info and sits at the node's local origin — makes controls stick
     * to the node position regardless of whether {@link node} is a mesh.
     */
    private _anchor!: TransformNode

    private _icon!: Ellipse
    private _label!: Rectangle

    private _renderObserver: Observer<Scene> | null = null

    /** {@link Entity.stateVersion} the controls were last colored from, or -1 before the first sync. */
    private _syncedStateVersion = -1

    /** Whether the entity's meshes are currently flagged pickable; undefined before the first frame. */
    private _pickable?: boolean

    constructor(
        private readonly entity: Entity,
        private readonly gui: AdvancedDynamicTexture,
        private readonly scene: Scene,
    ) {
        this.node = entity.node
        this._init()
    }

    /** Wire up the controls and per-frame update. */
    private _init() {
        this._anchor = new TransformNode(`${this.node.name}_tagAnchor`, this.scene)
        this._anchor.parent = this.node

        const bounds = getLocalBoundingBox(this.node, true)
        this._anchor.position.x = (bounds.max.x + bounds.min.x) / 2
        this._anchor.position.y = bounds.max.y
        this._anchor.position.z = (bounds.max.z + bounds.min.z) / 2

        this._icon = this._buildIcon()
        this._label = this._buildLabel()

        this._renderObserver = this.scene.onBeforeRenderObservable.add(this._update)
    }

    dispose() {
        this._renderObserver?.remove()
        this._renderObserver = null
        this._icon.dispose()
        this._label.dispose()
        this._anchor.dispose()
    }

    /*
    Controls
    */

    private _buildIcon(): Ellipse {
        const icon = new Ellipse(`${this.entity.id}-tag-icon`)
        icon.width = "16px"
        icon.height = "16px"
        icon.thickness = 2
        icon.background = CARD_BACKGROUND
        icon.shadowColor = "rgba(0,0,0,0.25)"
        icon.shadowBlur = 4
        this._makeInteractive(icon)
        this._attach(icon)
        return icon
    }

    private _buildLabel(): Rectangle {
        const root = new Rectangle(`${this.entity.id}-tag-label`)
        root.adaptWidthToChildren = true
        root.cornerRadius = 13
        root.thickness = 2
        root.background = CARD_BACKGROUND
        root.shadowColor = "rgba(0,0,0,0.25)"
        root.shadowBlur = 5
        root.heightInPixels = 24

        const name = new TextBlock()
        name.text = this.entity.name
        name.color = TEXT_PRIMARY
        name.fontSize = 13
        name.fontWeight = "600"
        name.resizeToFit = true
        name.textVerticalAlignment = Control.VERTICAL_ALIGNMENT_CENTER
        guiPadding(name, 0, 24)

        root.addControl(name)

        this._makeInteractive(root)
        this._attach(root)
        return root
    }

    private _makeInteractive(control: Control) {
        control.isPointerBlocker = true
        control.hoverCursor = "pointer"
        control.alpha = 0
        control.isVisible = false
        control.onPointerClickObservable.add(this._onControlClick)
    }

    private _attach(control: Control) {
        this.gui.addControl(control)
        control.linkWithMesh(this._anchor)
        control.linkOffsetYInPixels = this.entity.linkOffsetY
    }

    /** Fully faded-out controls still receive pointer events; ignore clicks on those. */
    private _onControlClick = (_ignored: Vector2WithInfo, state: EventState) => {
        if (state.currentTarget instanceof Control && state.currentTarget.alpha < 1) {
            return
        }

        this._toggleExpanded()
    }

    /**
     * Clicks on the entity's meshes are resolved by {@link World} from a single
     * scene-level handler, not per mesh here; this is only the tag's own
     * controls taking the same path.
     */
    private _toggleExpanded() {
        this.entity.world.toggleEntityFocus(this.entity)
    }

    /*
    Per-frame update
    */

    private _update = () => {
        const camera = this.scene.activeCamera
        if (!camera) {
            return
        }

        const dt = this.scene.getEngine().getDeltaTime() / 1000

        // `buildUiSchema` allocates a whole render model (and formats every
        // reading) so it is only run when the state behind it actually changed,
        // not once per entity per frame.
        if (this._syncedStateVersion !== this.entity.stateVersion) {
            this._syncedStateVersion = this.entity.stateVersion
            const color = this.entity.buildUiSchema().color
            this._icon.color = color
            this._label.color = color
        }

        // 2 = full label, 1 = icon only, 0 = hidden. A node on a hidden floor is
        // treated as fully out of view.
        let lod = 0;
        if (this.entity.active && this.node.isEnabled()) {
            lod = this.entity.building?.focused ? 2 : 1
        }

        // Only re-flag the subtree when pickability actually flips — an
        // equipment subtree can be a couple of hundred meshes.
        const pickable = lod !== 0
        if (pickable !== this._pickable) {
            this._pickable = pickable
            for (const mesh of this.entity.meshes) {
                mesh.isPickable = pickable
            }
        }

        const iconTarget = lod === 1 ? 1 : 0
        const labelTarget = lod === 2 ? 1 : 0

        this._fade(this._icon, iconTarget, dt)
        this._fade(this._label, labelTarget, dt)

        const distance = Vector3.Distance(camera.globalPosition, this.node.getAbsolutePosition())
        const depthZ = -Math.round(distance / DEPTH_BUCKET_METRES)
        this._icon.zIndex = depthZ
        this._label.zIndex = depthZ
    }

    private _fade(control: Control, target: number, dt: number) {
        control.alpha = this._approach(control.alpha, target, dt)
        control.isVisible = control.alpha > 0.01
    }

    /** Exponential smoothing toward `target`, snapping once close enough. */
    private _approach(current: number, target: number, dt: number): number {
        const next = current + (target - current) * (1 - Math.exp(-dt * ANIM_SPEED))
        return Math.abs(next - target) < 0.001 ? target : next
    }
}
