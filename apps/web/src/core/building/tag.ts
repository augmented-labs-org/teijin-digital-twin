import { AbstractMesh, ActionManager, EventState, ExecuteCodeAction, Node, Observer, Scene, TransformNode, Vector3 } from "@babylonjs/core"
import {
    AdvancedDynamicTexture,
    Control,
    Ellipse,
    Rectangle,
    StackPanel,
    TextBlock,
    Vector2WithInfo,
} from "@babylonjs/gui"
import { setPickPriority } from "./pick-priority"
import { guiPadding } from "../utils/gui"

/** A tag's headline state, shown as an accent color and a status line. */
export type TagStatus = "online" | "offline" | "error"

/** Border/accent color per status. Green online, dark gray offline, red error. */
export const STATUS_COLOR: Record<TagStatus, string> = {
    online: "#22c55e",
    offline: "#374151",
    error: "#ef4444",
}

const STATUS_TEXT: Record<TagStatus, string> = {
    online: "Online",
    offline: "Offline",
    error: "Error",
}

const CARD_BACKGROUND = "#ffffff"
const TEXT_PRIMARY = "#111827"
const TEXT_MUTED = "#6b7280"

/** Higher = snappier fade/scale transitions. */
const ANIM_SPEED = 14

/**
 * Added to an expanded detail card's depth-based zIndex so it paints over every
 * other (unexpanded) tag regardless of distance. Large enough to dwarf any
 * plausible camera-distance spread; two expanded cards still order near-over-far
 * relative to each other.
 */
const DETAIL_Z_BOOST = 1_000_000

/**
 * A screen-space tag anchored to a scene node, attached to the world's shared
 * GUI layer.
 *
 * Behaviour (identical for every subclass):
 *  - By default shows a name pill with a status-colored border.
 *  - Distance/activity-driven LOD: full label when active, a status dot when
 *    inactive, nothing when the node is disabled.
 *  - Clicking the label (or dot, or the node's meshes) expands an animated
 *    detail card; clicking again collapses it.
 *
 * The tag drives its own per-frame update via a scene observer, so callers only
 * need to construct it and {@link dispose} it.
 *
 * Subclasses supply the target-specific bits: {@link name}, {@link active},
 * {@link status}, the pick priority / link offset / id prefix constants, and the
 * variable rows of the detail card via {@link buildDetailBody}. They MUST call
 * {@link init} at the end of their constructor (after their own fields are set).
 */
export abstract class WorldTag {
    protected readonly node: TransformNode

    private _icon!: Ellipse
    private _label!: Rectangle
    private _detail!: Rectangle
    private _detailDot!: Ellipse
    private _statusRow!: TextBlock
    /** Subclass-provided callback that refreshes the detail card's variable rows. */
    private _syncBody: (color: string) => void = () => {}

    private _expanded = false
    private _renderObserver: Observer<Scene> | null = null

    constructor(
        node: TransformNode,
        protected readonly gui: AdvancedDynamicTexture,
        protected readonly scene: Scene,
    ) {
        this.node = node
    }

    /*
    Subclass surface
    */

    /** Text shown on the label pill and detail-card title. */
    protected abstract get name(): string

    /** When true the full label shows; when false it collapses to a status dot. */
    protected abstract get active(): boolean

    /** Current headline state driving the accent color and status line. */
    protected abstract get status(): TagStatus

    /** Namespaces control names so tags of different kinds never collide. */
    protected abstract readonly idPrefix: string

    /** Pixels the tag floats above the node's anchor point. */
    protected abstract readonly linkOffsetY: number

    /** Pick priority applied to the node's meshes (see {@link PICK_PRIORITY}). */
    protected abstract readonly pickPriority: number

    /**
     * Append the target-specific rows to the detail card's `panel` (the shared
     * title + status rows are already present). Return a callback that refreshes
     * those rows; it is invoked every frame with the current accent color.
     */
    protected abstract buildDetailBody(panel: StackPanel): (color: string) => void

    /**
     * Wire up the controls and per-frame update. Subclasses MUST call this at the
     * end of their constructor — not the base's, because it reads subclass state
     * (name/status/…) that only exists once the subclass fields are assigned.
     */
    protected init() {
        this._icon = this._buildIcon()
        this._label = this._buildLabel()
        const detail = this._buildDetail()
        this._detail = detail.root
        this._detailDot = detail.dot
        this._statusRow = detail.statusRow

        this._makeMeshInteractive()

        this._renderObserver = this.scene.onBeforeRenderObservable.add(this._update)
    }

    dispose() {
        this._renderObserver?.remove()
        this._renderObserver = null
        this._icon.dispose()
        this._label.dispose()
        this._detail.dispose()

        for (const mesh of this._meshes()) {
            mesh.actionManager?.dispose()
            mesh.actionManager = null
        }
    }

    /*
    Detail-card helpers (for subclasses building their body)
    */

    /** A muted, left-aligned info row. */
    protected detailRow(parent: StackPanel): TextBlock {
        const row = new TextBlock()
        row.color = TEXT_MUTED
        row.fontSize = 12
        row.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT
        row.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT
        row.resizeToFit = true
        parent.addControl(row)
        return row
    }

    /** A red, wrapping row for error text (hidden by default). */
    protected errorRow(parent: StackPanel): TextBlock {
        const row = new TextBlock()
        row.color = STATUS_COLOR.error
        row.fontSize = 12
        row.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT
        row.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT
        row.width = "182px"
        row.textWrapping = true
        row.resizeToFit = true
        parent.addControl(row)
        return row
    }

    /*
    Controls
    */

    private _buildIcon(): Ellipse {
        const icon = new Ellipse(`${this.idPrefix}-${this.name}-tag-icon`)
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
        const root = new Rectangle(`${this.idPrefix}-${this.name}-tag-label`)
        root.adaptWidthToChildren = true
        root.cornerRadius = 13
        root.thickness = 2
        root.background = CARD_BACKGROUND
        root.shadowColor = "rgba(0,0,0,0.25)"
        root.shadowBlur = 5
        root.heightInPixels = 24

        const name = new TextBlock()
        name.text = this.name
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

    private _buildDetail(): { root: Rectangle; dot: Ellipse; statusRow: TextBlock } {
        const root = new Rectangle(`${this.idPrefix}-${this.name}-tag-detail`)
        root.width = "210px"
        root.adaptHeightToChildren = true
        root.cornerRadius = 12
        root.thickness = 2
        root.background = CARD_BACKGROUND
        root.shadowColor = "rgba(0,0,0,0.3)"
        root.shadowBlur = 10
        root.scaleX = 0.92
        root.scaleY = 0.92

        const panel = new StackPanel()
        panel.isVertical = true
        panel.width = "100%"
        panel.spacing = 5
        guiPadding(panel, 12, 14)
        root.addControl(panel)

        // Title row: status dot + name.
        const titleRow = new StackPanel()
        titleRow.isVertical = false
        titleRow.spacing = 7
        titleRow.height = "20px"
        titleRow.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT
        panel.addControl(titleRow)

        const dot = new Ellipse()
        dot.width = "9px"
        dot.height = "9px"
        dot.thickness = 0
        titleRow.addControl(dot)

        const title = new TextBlock()
        title.text = this.name
        title.color = TEXT_PRIMARY
        title.fontSize = 15
        title.fontWeight = "700"
        title.resizeToFit = true
        titleRow.addControl(title)

        // Shared status line, then subclass-specific rows.
        const statusRow = this.detailRow(panel)
        this._syncBody = this.buildDetailBody(panel)

        this._makeInteractive(root)
        this._attach(root)
        return { root, dot, statusRow }
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
        control.linkWithMesh(this.node)
        control.linkOffsetYInPixels = this.linkOffsetY
    }

    /** Fully faded-out controls still receive pointer events; ignore clicks on those. */
    private _onControlClick = (_ignored: Vector2WithInfo, state: EventState) => {
        if (state.currentTarget instanceof Control && state.currentTarget.alpha < 1) {
            return
        }

        this._toggleExpanded()
    }

    private _toggleExpanded() {
        this._expanded = !this._expanded
    }

    /** Every mesh under the node toggles the detail card on click. */
    private _makeMeshInteractive() {
        setPickPriority(this._meshes(), this.pickPriority)
        for (const mesh of this._meshes()) {
            mesh.isPickable = true
            mesh.actionManager ??= new ActionManager(this.scene)
            mesh.actionManager.registerAction(
                new ExecuteCodeAction(ActionManager.OnPickTrigger, () => {
                    this._toggleExpanded()
                }),
            )
            mesh.actionManager.registerAction(
                new ExecuteCodeAction(ActionManager.OnPointerOverTrigger, () => {
                    this.scene.hoverCursor = "pointer"
                }),
            )
        }
    }

    private _meshes(): AbstractMesh[] {
        const meshes = this.node instanceof AbstractMesh ? [this.node] : []
        return [...meshes, ...this.node.getChildMeshes(false)]
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

        this._syncContent()

        // 2 = full label, 1 = icon only, 0 = hidden. A node on a hidden floor is
        // treated as fully out of view.
        let lod = this.active ? 2 : 1
        if (!this.node.isEnabled()) {
            lod = 0
        }

        if (lod === 0 && this._expanded) {
            this._expanded = false
        }

        const showDetail = this._expanded && lod >= 1
        const iconTarget = !showDetail && lod === 1 ? 1 : 0
        const labelTarget = !showDetail && lod === 2 ? 1 : 0
        const detailTarget = showDetail ? 1 : 0

        this._fade(this._icon, iconTarget, dt)
        this._fade(this._label, labelTarget, dt)
        this._fade(this._detail, detailTarget, dt)

        const distance = Vector3.Distance(camera.globalPosition, this.node.getAbsolutePosition())
        const depthZ = -Math.round(distance)
        this._icon.zIndex = depthZ
        this._label.zIndex = depthZ
        this._detail.zIndex = depthZ + (showDetail ? DETAIL_Z_BOOST : 0)

        const scale = this._approach(this._detail.scaleX, showDetail ? 1 : 0.92, dt)
        this._detail.scaleX = scale
        this._detail.scaleY = scale

        // The label and detail card are both centered on the same anchor point, so
        // the (taller, variable-height) detail card would otherwise expand
        // symmetrically around it. Shift the card up by the difference of the two
        // half-heights so its bottom edge lines up with the label's bottom edge —
        // it then grows upward out of where the label sits.
        this._detail.linkOffsetYInPixels =
            this.linkOffsetY + (this._label.heightInPixels - this._detail.heightInPixels) / 2
    }

    /** Push live state into the controls (cheap; setters no-op on unchanged values). */
    private _syncContent() {
        const status = this.status
        const color = STATUS_COLOR[status]

        this._icon.color = color
        this._label.color = color
        this._detail.color = color
        this._detailDot.background = color

        this._statusRow.text = `Status: ${STATUS_TEXT[status]}`
        this._statusRow.color = color

        this._syncBody(color)
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
