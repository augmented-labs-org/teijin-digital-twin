import { EventState, Observer, RotationGizmo, Scene, TransformNode, Vector3 } from "@babylonjs/core"
import {
    AdvancedDynamicTexture,
    Control,
    Ellipse,
    Rectangle,
    StackPanel,
    TextBlock,
    Vector2WithInfo,
} from "@babylonjs/gui"
import { BuildingEquipment } from "./building"
import { guiPadding } from "../utils/gui"

type EquipmentStatus = "online" | "offline" | "error"

/** Border/accent color per status. Green online, dark gray offline, red error. */
const STATUS_COLOR: Record<EquipmentStatus, string> = {
    online: "#22c55e",
    offline: "#374151",
    error: "#ef4444",
}

const STATUS_TEXT: Record<EquipmentStatus, string> = {
    online: "Online",
    offline: "Offline",
    error: "Error",
}

const CARD_BACKGROUND = "#ffffff"
const TEXT_PRIMARY = "#111827"
const TEXT_MUTED = "#6b7280"

/**
 * Level-of-detail thresholds, measured as the world-space distance from the
 * camera to the equipment. At/under {@link LABEL_DISTANCE} the full name label
 * is shown; between there and {@link ICON_DISTANCE} only a status dot; beyond
 * it, nothing.
 */
const LABEL_DISTANCE = 95
const ICON_DISTANCE = 150

/** Higher = snappier fade/scale transitions. */
const ANIM_SPEED = 14

/** Pixels the tag floats above the equipment's anchor point. */
const LINK_OFFSET_Y = -22

/**
 * A screen-space label for a single {@link BuildingEquipment}, attached to the
 * world's shared GUI layer and anchored to the equipment's mesh.
 *
 * Behaviour:
 *  - By default shows the equipment name in a pill with a status-colored border.
 *  - Distance-driven LOD: full label when near, a status dot when a bit far,
 *    nothing when very far.
 *  - Clicking the label (or dot) expands an animated detail card; clicking
 *    again collapses it.
 *
 * The tag drives its own per-frame update via a scene observer, so callers only
 * need to construct it and {@link dispose} it.
 */
export class EquipmentTag {
    private readonly _node: TransformNode

    private readonly _icon: Ellipse
    private readonly _label: Rectangle
    private readonly _detail: Rectangle
    private readonly _detailDot: Ellipse
    private readonly _statusRow: TextBlock
    private readonly _runningRow: TextBlock
    private readonly _errorRow: TextBlock

    private _expanded = false
    private _renderObserver: Observer<Scene> | null

    constructor(
        private readonly equipment: BuildingEquipment,
        private readonly gui: AdvancedDynamicTexture,
        private readonly scene: Scene,
    ) {
        // Equipment nodes are meshes in practice; TransformNode is enough for
        // positioning and GUI linking.
        this._node = equipment.node as TransformNode

        this._icon = this._buildIcon()
        const label = this._buildLabel()
        this._label = label.root
        const detail = this._buildDetail()
        this._detail = detail.root
        this._detailDot = detail.dot
        this._statusRow = detail.statusRow
        this._runningRow = detail.runningRow
        this._errorRow = detail.errorRow

        this._renderObserver = scene.onBeforeRenderObservable.add(this._update)
    }

    dispose() {
        this._renderObserver?.remove()
        this._renderObserver = null
        this._icon.dispose()
        this._label.dispose()
        this._detail.dispose()
    }

    /*
    Status
    */

    private get _status(): EquipmentStatus {
        if (this.equipment.errored) {
            return "error"
        }
        return this.equipment.online ? "online" : "offline"
    }

    /*
    Controls
    */

    private _buildIcon(): Ellipse {
        const icon = new Ellipse(`${this.equipment.name}-tag-icon`)
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

    private _buildLabel(): { root: Rectangle; } {
        const root = new Rectangle(`${this.equipment.name}-tag-label`)
        root.adaptWidthToChildren = true
        root.cornerRadius = 13
        root.thickness = 2
        root.background = CARD_BACKGROUND
        root.shadowColor = "rgba(0,0,0,0.25)"
        root.shadowBlur = 5
        root.heightInPixels = 24

        const name = new TextBlock()
        name.text = this.equipment.name
        name.color = TEXT_PRIMARY
        name.fontSize = 13
        name.fontWeight = "600"
        name.resizeToFit = true
        name.textVerticalAlignment = Control.VERTICAL_ALIGNMENT_CENTER
        guiPadding(name, 0, 24)

        root.addControl(name)

        this._makeInteractive(root)
        this._attach(root)
        return { root }
    }

    private _buildDetail(): {
        root: Rectangle
        dot: Ellipse
        statusRow: TextBlock
        runningRow: TextBlock
        errorRow: TextBlock
    } {
        const root = new Rectangle(`${this.equipment.name}-tag-detail`)
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

        // Title row: status dot + equipment name.
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
        title.text = this.equipment.name
        title.color = TEXT_PRIMARY
        title.fontSize = 15
        title.fontWeight = "700"
        title.resizeToFit = true
        titleRow.addControl(title)

        const statusRow = this._detailRow(panel)
        const runningRow = this._detailRow(panel)

        const errorRow = new TextBlock()
        errorRow.color = STATUS_COLOR.error
        errorRow.fontSize = 12
        errorRow.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT
        errorRow.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT
        errorRow.width = "182px"
        errorRow.textWrapping = true
        errorRow.resizeToFit = true
        panel.addControl(errorRow)

        this._makeInteractive(root)
        this._attach(root)
        return { root, dot, statusRow, runningRow, errorRow }
    }

    private _detailRow(parent: StackPanel): TextBlock {
        const row = new TextBlock()
        row.color = TEXT_MUTED
        row.fontSize = 12
        row.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT
        row.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT
        row.resizeToFit = true
        parent.addControl(row)
        return row
    }

    private _makeInteractive(control: Control) {
        control.isPointerBlocker = true
        control.hoverCursor = "pointer"
        control.alpha = 0
        control.isVisible = false
        control.onPointerClickObservable.add(this._toggleExpanded)
    }

    private _attach(control: Control) {
        this.gui.addControl(control)
        control.linkWithMesh(this._node)
        control.linkOffsetYInPixels = LINK_OFFSET_Y
    }

    private _toggleExpanded = (_ignored: Vector2WithInfo, state: EventState) => {
        if (state.currentTarget instanceof Control && state.currentTarget.alpha < 1) {
            return
        }

        this._expanded = !this._expanded
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

        const distance = Vector3.Distance(this._node.getAbsolutePosition(), camera.globalPosition)

        // 2 = full label, 1 = icon only, 0 = hidden. Equipment on a hidden
        // floor is treated as fully out of view.
        let lod = distance <= LABEL_DISTANCE ? 2 : distance <= ICON_DISTANCE ? 1 : 0
        if (!this._node.isEnabled()) {
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

        // Every tag's controls share the same GUI root container, so bumping
        // zIndex here reorders draw order across ALL equipment tags: an
        // expanded detail card always wins over any other tag's icon, label,
        // or (unexpanded) detail card.
        this._detail.zIndex = showDetail ? 1 : 0

        const scale = this._approach(this._detail.scaleX, showDetail ? 1 : 0.92, dt)
        this._detail.scaleX = scale
        this._detail.scaleY = scale
    }

    /** Push the equipment's live state into the controls (cheap; setters no-op on unchanged values). */
    private _syncContent() {
        const status = this._status
        const color = STATUS_COLOR[status]

        this._icon.color = color
        this._label.color = color
        this._detail.color = color
        this._detailDot.background = color

        this._statusRow.text = `Status: ${STATUS_TEXT[status]}`
        this._statusRow.color = color
        this._runningRow.text = `Running: ${this.equipment.running ? "Yes" : "No"}`

        this._errorRow.isVisible = this.equipment.errored
        if (this.equipment.errored) {
            this._errorRow.text = this.equipment.errorReason ?? "Unknown error"
        }
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
