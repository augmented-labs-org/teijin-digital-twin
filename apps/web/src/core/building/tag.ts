import { AbstractMesh, ActionManager, EventState, ExecuteCodeAction, Observer, Scene, TransformNode, Vector3 } from "@babylonjs/core"
import {
    AdvancedDynamicTexture,
    Control,
    Ellipse,
    Rectangle,
    StackPanel,
    TextBlock,
    Vector2WithInfo,
} from "@babylonjs/gui"
import { guiPadding } from "../utils/gui"
import type { Entity, TagBody } from "./entity"
import { setPickPriority } from "./pick-priority"

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
 * A screen-space tag anchored to an {@link Entity}, attached to the world's
 * shared GUI layer. One class serves every kind of entity — the entity supplies
 * what varies.
 *
 * Behaviour:
 *  - By default shows a name pill with a status-colored border.
 *  - Distance/activity-driven LOD: full label when the entity is active, a
 *    status dot when inactive, nothing when the node is disabled.
 *  - Clicking the label (or dot, or the node's meshes) expands an animated
 *    detail card; clicking again collapses it.
 *
 * The tag reads everything it needs off the entity — {@link Entity.name},
 * {@link Entity.active}, {@link Entity.status}, the pick priority / link offset /
 * id prefix, and the variable rows via {@link Entity.buildDetailBody} — and
 * drives its own per-frame update via a scene observer, so callers only need to
 * construct it and {@link dispose} it.
 */
export class EntityTag {
    private readonly node: TransformNode

    private _icon!: Ellipse
    private _label!: Rectangle
    private _detail!: Rectangle
    private _detailDot!: Ellipse
    private _statusRow!: TextBlock
    /** Entity-provided callback that refreshes the detail card's variable rows. */
    private _syncBody: (color: string) => void = () => {}
    /** Container the stat rows are reconciled into. */
    private _statsPanel!: StackPanel
    /** Live stat rows, reconciled against {@link Entity.stats} each frame. */
    private _statRows: { row: Rectangle; icon: TextBlock; name: TextBlock; value: TextBlock }[] = []

    private _renderObserver: Observer<Scene> | null = null

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
    Detail-card helpers (exposed to the entity via a TagBody)
    */

    /** A muted, left-aligned info row. */
    private detailRow(parent: StackPanel): TextBlock {
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
    private errorRow(parent: StackPanel): TextBlock {
        const row = new TextBlock()
        row.color = "#ef4444"
        row.fontSize = 12
        row.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT
        row.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT
        row.width = "182px"
        row.textWrapping = true
        row.resizeToFit = true
        parent.addControl(row)
        return row
    }

    /**
     * Build one empty stat row and append it to {@link _statsPanel}. Its contents
     * (icon/name/value text) are filled in by {@link _syncStats}.
     */
    private _buildStatRow(): { row: Rectangle; icon: TextBlock; name: TextBlock; value: TextBlock } {
        const row = new Rectangle()
        row.width = "182px"
        row.height = "18px"
        row.thickness = 0
        row.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT

        const icon = new TextBlock()
        icon.color = TEXT_PRIMARY
        icon.fontSize = 13
        icon.resizeToFit = true
        icon.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT
        icon.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT
        row.addControl(icon)

        const name = new TextBlock()
        name.color = TEXT_MUTED
        name.fontSize = 12
        name.resizeToFit = true
        name.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT
        name.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT
        guiPadding(name, 0, 0, 0, 22)
        row.addControl(name)

        const value = new TextBlock()
        value.color = TEXT_PRIMARY
        value.fontSize = 12
        value.fontWeight = "600"
        value.width = "100%"
        value.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_RIGHT
        value.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_RIGHT
        value.paddingRightInPixels = 5
        row.addControl(value)

        this._statsPanel.addControl(row)
        return { row, icon, name, value }
    }

    /**
     * Reconcile the stat rows against {@link Entity.stats}: grow or shrink the row
     * pool to match, then refresh each row's icon/name/value. Cheap when nothing
     * changed — text setters no-op on unchanged values.
     */
    private _syncStats() {
        const stats = this.entity.stats

        while (this._statRows.length > stats.length) {
            this._statRows.pop()!.row.dispose()
        }
        while (this._statRows.length < stats.length) {
            this._statRows.push(this._buildStatRow())
        }

        for (let i = 0; i < stats.length; i++) {
            const stat = stats[i]!
            const { icon, name, value } = this._statRows[i]!
            icon.text = stat.icon
            name.text = stat.name
            value.text = `${stat.value}`
        }

        this._statsPanel.isVisible = stats.length > 0
    }

    /*
    Controls
    */

    private _buildIcon(): Ellipse {
        const icon = new Ellipse(`${this.entity.idPrefix}-${this.entity.name}-tag-icon`)
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
        const root = new Rectangle(`${this.entity.idPrefix}-${this.entity.name}-tag-label`)
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

    private _buildDetail(): { root: Rectangle; dot: Ellipse; statusRow: TextBlock } {
        const root = new Rectangle(`${this.entity.idPrefix}-${this.entity.name}-tag-detail`)
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
        title.text = this.entity.name
        title.color = TEXT_PRIMARY
        title.fontSize = 15
        title.fontWeight = "700"
        title.resizeToFit = true
        titleRow.addControl(title)

        // Shared status line, then entity-specific rows.
        const statusRow = this.detailRow(panel)
        guiPadding(statusRow, 0, 0, 4, 0)
        
        const body: TagBody = {
            infoRow: () => this.detailRow(panel),
            errorRow: () => this.errorRow(panel),
        }
        this._syncBody = this.entity.buildDetailBody(body)

        // Generic per-entity stats, reconciled against `entity.stats` each frame
        // into this container (rows are created lazily by `_syncStats`).
        const statsPanel = new StackPanel()
        statsPanel.isVertical = true
        statsPanel.width = "100%"
        statsPanel.spacing = 5
        statsPanel.isVisible = false
        panel.addControl(statsPanel)
        this._statsPanel = statsPanel

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
        control.linkOffsetYInPixels = this.entity.linkOffsetY
    }

    /** Fully faded-out controls still receive pointer events; ignore clicks on those. */
    private _onControlClick = (_ignored: Vector2WithInfo, state: EventState) => {
        if (state.currentTarget instanceof Control && state.currentTarget.alpha < 1) {
            return
        }

        this._toggleExpanded()
    }

    private _toggleExpanded() {
        const world = this.entity.floor.building.world
        const expanded = world.focusedEntity === this.entity
        if (expanded) {
            world.focusedEntity = undefined
        } else {
            world.focusedEntity = this.entity
            world.moveCameraToFocusedEntity()
        }
    }

    /** Every mesh under the node toggles the detail card on click. */
    private _makeMeshInteractive() {
        setPickPriority(this._meshes(), this.entity.pickPriority)
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

        const world = this.entity.floor.building.world
        const expanded = world.focusedEntity === this.entity

        this._syncContent()

        // 2 = full label, 1 = icon only, 0 = hidden. A node on a hidden floor is
        // treated as fully out of view.
        let lod = 0;
        if (this.entity.active && this.node.isEnabled()) {
            lod = this.entity.floor.building.focused ? 2 : 1
        }

        const showDetail = expanded && lod >= 1
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
            this.entity.linkOffsetY + (this._label.heightInPixels - this._detail.heightInPixels) / 2
    }

    /** Push live state into the controls (cheap; setters no-op on unchanged values). */
    private _syncContent() {
        const status = this.entity.status
        const color = status.color ?? "#374151"

        this._icon.color = color
        this._label.color = color
        this._detail.color = color
        this._detailDot.background = color

        this._statusRow.text = `Status: ${status.status}`
        this._statusRow.color = color

        this._syncBody(color)
        this._syncStats()
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
