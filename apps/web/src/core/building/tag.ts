import { AbstractMesh, ActionManager, EventState, ExecuteCodeAction, Observer, Scene, TransformNode, Vector3 } from "@babylonjs/core"
import {
    AdvancedDynamicTexture,
    Control,
    Ellipse,
    Image,
    Rectangle,
    StackPanel,
    TextBlock,
    Vector2WithInfo,
} from "@babylonjs/gui"
import { getLocalBoundingBox } from "../utils/bounds"
import { guiPadding } from "../utils/gui"
import { statIconDataUri } from "../utils/icons"
import { type Entity } from "./entity"
import { setPickPriority } from "./pick-priority"
import { BADGE_TONE_COLOR, UiSchema, UiStatValue, type EntityBadge } from "./ui-schema"

const CARD_BACKGROUND = "#ffffff"
const TEXT_PRIMARY = "#111827"
const TEXT_MUTED = "#6b7280"
const DIVIDER = "#e5e7eb"

/** Detail card width. */
const CARD_WIDTH = 280
/** Detail card horizontal/vertical padding. */
const CARD_PADDING_X = 12
const CARD_PADDING_Y = 12
/** Width available to the card's content, inside its padding. */
const CARD_CONTENT_WIDTH = CARD_WIDTH - CARD_PADDING_X * 2

/** Tiles per grid row in the detail card's stats section. */
const STAT_COLUMNS = 2
/** Gap between stat tiles, both across a row and between rows. */
const STAT_GAP = 8
/** Width of a stat tile: fits {@link STAT_COLUMNS} of them across the card's content width. */
const STAT_TILE_WIDTH = (CARD_CONTENT_WIDTH - STAT_GAP * (STAT_COLUMNS - 1)) / STAT_COLUMNS
/** Padding inside a stat tile. */
const STAT_TILE_PADDING = 8
/** Opacity of a stat tile's background tint, drawn from the entity's accent color. */
const STAT_TILE_ALPHA = 0.07
/** Vertical gap between a group heading and its tile grid. */
const STAT_GROUP_HEADING_GAP = 6

/** Gap between badge pills. */
const BADGE_GAP = 6
/** Badge pill height. */
const BADGE_HEIGHT = 20

/** `#rrggbb` → `rgba(r, g, b, alpha)`, used to tint stat tiles by the entity's accent color. */
function hexToRgba(hex: string, alpha: number): string {
    const value = hex.replace("#", "")
    const r = parseInt(value.substring(0, 2), 16)
    const g = parseInt(value.substring(2, 4), 16)
    const b = parseInt(value.substring(4, 6), 16)
    return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

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
 * {@link Entity.active}, {@link Entity.buildUiSchema}, and the pick priority /
 * link offset / id prefix — and drives its own per-frame update via a scene
 * observer, so callers only need to construct it and {@link dispose} it.
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
    private _detail!: Rectangle
    private _detailDot!: Ellipse
    private _statusRow!: TextBlock
    /** Red, wrapping row for {@link EntityRenderModel.error} (hidden when absent). */
    private _errorRow!: TextBlock
    /** Horizontal row of badge pills, rebuilt by {@link _rebuildBadges} when the badge set changes. */
    private _badgesPanel!: StackPanel
    /** Tiles in {@link _badgesPanel}, paired with the badge they render. Rebuilt on change, refreshed every frame. */
    private _badgeTiles: { tile: Rectangle; label: TextBlock; badge: EntityBadge }[] = []
    /** Fingerprint of the badge set last built into {@link _badgesPanel}. */
    private _badgesKey = ""
    /** Hairline separating the stats grid from the rows above it. */
    private _statsDivider!: Rectangle
    /** Vertical container each group's heading + tile grid is rebuilt into. */
    private _statsPanel!: StackPanel
    /**
     * Flattened tiles across every group, paired with the stat they render.
     * Rebuilt by {@link _rebuildStatGroups} whenever the set of groups/stats
     * changes; refreshed (tint/icon/value) every frame by {@link _syncStats}.
     */
    private _statTiles: { tile: Rectangle; icon: Image; value: TextBlock; label: TextBlock; stat: UiStatValue }[] = []
    /** Fingerprint of the grouping last built into {@link _statsPanel}. */
    private _statGroupsKey = ""

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
        this._anchor = new TransformNode(`${this.node.name}_tagAnchor`, this.scene)
        this._anchor.parent = this.node

        const bounds = getLocalBoundingBox(this.node, true)
        this._anchor.position.x = (bounds.max.x + bounds.min.x) / 2
        this._anchor.position.y = bounds.max.y
        this._anchor.position.z = (bounds.max.z + bounds.min.z) / 2

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
        this._anchor.dispose()

        for (const mesh of this._meshes()) {
            mesh.actionManager?.dispose()
            mesh.actionManager = null
        }
    }

    /*
    Detail-card helpers
    */

    /** A red, wrapping row for {@link EntityRenderModel.error} (hidden by default). */
    private _buildErrorRow(parent: StackPanel): TextBlock {
        const row = new TextBlock()
        row.color = "#ef4444"
        row.fontSize = 13
        row.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT
        row.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT
        row.width = `${CARD_CONTENT_WIDTH}px`
        row.textWrapping = true
        row.resizeToFit = true
        row.isVisible = false
        parent.addControl(row)
        return row
    }

    /** Build one empty badge pill. Its tint/text are filled in by {@link _syncBadges}. */
    private _buildBadgePill(): { tile: Rectangle; label: TextBlock } {
        const tile = new Rectangle()
        tile.adaptWidthToChildren = true
        tile.heightInPixels = BADGE_HEIGHT
        tile.cornerRadius = BADGE_HEIGHT / 2
        tile.thickness = 0

        const label = new TextBlock()
        label.fontSize = 11
        label.fontWeight = "700"
        label.resizeToFit = true
        guiPadding(label, 0, 8)

        tile.addControl(label)
        return { tile, label }
    }

    /**
     * Rebuild the badge pills from scratch into {@link _badgesPanel}. Badge
     * labels/tones only change alongside the underlying state, so this is
     * cheap to skip via {@link _badgesKey} on the common case of no change.
     */
    private _rebuildBadges(badges: EntityBadge[]) {
        for (const child of this._badgesPanel.children.slice()) {
            child.dispose()
        }
        this._badgeTiles = []

        for (const badge of badges) {
            const { tile, label } = this._buildBadgePill()
            this._badgesPanel.addControl(tile)
            this._badgeTiles.push({ tile, label, badge })
        }
    }

    /** Reconcile the badge row against `badges`, rebuilding only if the set changed. */
    private _syncBadges(badges: EntityBadge[]) {
        const key = badges.map(b => `${b.label}|${b.tone ?? ""}`).join(",")
        if (key !== this._badgesKey) {
            this._badgesKey = key
            this._rebuildBadges(badges)
        }

        for (const { tile, label, badge } of this._badgeTiles) {
            const color = BADGE_TONE_COLOR[badge.tone ?? "neutral"]
            tile.background = hexToRgba(color, STAT_TILE_ALPHA)
            label.color = color
            label.text = badge.label
        }

        this._badgesPanel.isVisible = badges.length > 0
    }

    /** A small caption naming a group of stats (e.g. "POWER"). */
    private _buildGroupHeading(parent: StackPanel, name: string) {
        const heading = new TextBlock()
        heading.text = name.toUpperCase()
        heading.color = TEXT_MUTED
        heading.fontSize = 11
        heading.fontWeight = "700"
        heading.resizeToFit = true
        heading.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT
        heading.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT
        parent.addControl(heading)
    }

    /** Build one empty grid row, sized to hold up to {@link STAT_COLUMNS} tiles. */
    private _buildStatGridRow(): StackPanel {
        const row = new StackPanel()
        row.isVertical = false
        row.width = `${CARD_CONTENT_WIDTH}px`
        row.spacing = STAT_GAP
        row.adaptHeightToChildren = true
        row.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT
        return row
    }

    /**
     * Build one empty stat tile. Its contents (background tint, icon/value/label
     * text) are filled in by {@link _syncStats}; the caller places it in a grid row.
     */
    private _buildStatTile(): { tile: Rectangle; icon: Image; value: TextBlock; label: TextBlock } {
        const tile = new Rectangle()
        tile.width = `${STAT_TILE_WIDTH}px`
        tile.adaptHeightToChildren = true
        tile.cornerRadius = 8
        tile.thickness = 0

        const content = new StackPanel()
        content.isVertical = true
        content.width = "100%"
        content.spacing = 2
        guiPadding(content, STAT_TILE_PADDING)
        tile.addControl(content)

        const icon = new Image()
        icon.width = "18px"
        icon.height = "18px"
        icon.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT
        content.addControl(icon)

        const spacer = new Rectangle()
        spacer.width = "100%"
        spacer.heightInPixels = 2
        spacer.thickness = 0
        content.addControl(spacer)

        const value = new TextBlock()
        value.color = TEXT_PRIMARY
        value.fontSize = 15
        value.fontWeight = "700"
        value.width = `${STAT_TILE_WIDTH - STAT_TILE_PADDING * 2}px`
        value.textWrapping = true
        value.resizeToFit = true
        value.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT
        value.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT
        content.addControl(value)

        const label = new TextBlock()
        label.color = TEXT_MUTED
        label.fontSize = 12
        label.width = `${STAT_TILE_WIDTH - STAT_TILE_PADDING * 2}px`
        label.textWrapping = true
        label.resizeToFit = true
        label.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT
        label.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT
        content.addControl(label)

        return { tile, icon, value, label }
    }

    /**
     * Rebuild every group section (heading + tile grid) from scratch into
     * {@link _statsPanel}. Stat names/groups are fixed at entity construction —
     * only {@link EntityStat.value} changes after that — so this only actually
     * runs once per entity, the first time {@link _syncStats} sees its stats.
     */
    private _rebuildStatGroups(statGroups: UiSchema["statGroups"]) {
        for (const child of this._statsPanel.children.slice()) {
            child.dispose()
        }
        this._statTiles = []

        const showHeadings = statGroups.length > 1

        for (const { group, stats } of statGroups) {
            const section = new StackPanel()
            section.isVertical = true
            section.width = "100%"
            section.spacing = STAT_GROUP_HEADING_GAP
            this._statsPanel.addControl(section)

            if (showHeadings && group) {
                this._buildGroupHeading(section, group)
            }

            let row: StackPanel | undefined
            stats.forEach((stat, index) => {
                if (index % STAT_COLUMNS === 0) {
                    row = this._buildStatGridRow()
                    section.addControl(row)
                }
                const tile = this._buildStatTile()
                row!.addControl(tile.tile)
                this._statTiles.push({ ...tile, stat })
            })
        }
    }

    /**
     * Reconcile the stat grid against `statGroups`: rebuild the group/tile
     * structure if the set of groups/stats changed, then refresh every tile's
     * background tint and icon/value/label against the freshly built stats —
     * `buildUiSchema` returns new stat objects every frame, so tiles are
     * re-paired with `statGroups` here by position rather than read off the
     * (otherwise stale, only rebuilt on a name/group change) `stat` captured
     * at the last rebuild. Cheap when nothing changed — setters no-op on
     * unchanged values.
     */
    private _syncStats(statGroups: UiSchema["statGroups"], color: string) {
        const key = statGroups.flatMap(g => g.stats.map(s => `${g.group} ${s.name}`)).join("")
        if (key !== this._statGroupsKey) {
            this._statGroupsKey = key
            this._rebuildStatGroups(statGroups)
        }

        const freshStats = statGroups.flatMap(g => g.stats)
        const tint = hexToRgba(color, STAT_TILE_ALPHA)
        this._statTiles.forEach((tile, index) => {
            const stat = freshStats[index] ?? tile.stat
            tile.stat = stat
            tile.tile.background = tint
            tile.icon.source = statIconDataUri(stat.icon, color)
            tile.value.text = stat.value
            tile.label.text = stat.name
        })

        const hasStats = statGroups.some((g) => g.stats.length > 0)
        this._statsPanel.isVisible = hasStats
        this._statsDivider.isVisible = hasStats
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

    private _buildDetail(): { root: Rectangle; dot: Ellipse; statusRow: TextBlock } {
        const root = new Rectangle(`${this.entity.id}-tag-detail`)
        root.width = `${CARD_WIDTH}px`
        root.adaptHeightToChildren = true
        root.cornerRadius = 14
        root.thickness = 2
        root.background = CARD_BACKGROUND
        root.shadowColor = "rgba(0,0,0,0.3)"
        root.shadowBlur = 10
        root.scaleX = 0.92
        root.scaleY = 0.92

        const panel = new StackPanel()
        panel.isVertical = true
        panel.width = "100%"
        panel.spacing = 10
        guiPadding(panel, CARD_PADDING_Y, CARD_PADDING_X)
        root.addControl(panel)

        // Title row: status dot + name.
        const titleRow = new StackPanel()
        titleRow.isVertical = false
        titleRow.spacing = 8
        titleRow.height = "24px"
        titleRow.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT
        panel.addControl(titleRow)

        const dot = new Ellipse()
        dot.width = "10px"
        dot.height = "10px"
        dot.thickness = 0
        titleRow.addControl(dot)

        const title = new TextBlock()
        title.text = this.entity.name
        title.color = TEXT_PRIMARY
        title.fontSize = 17
        title.fontWeight = "700"
        title.resizeToFit = true
        titleRow.addControl(title)

        // Shared status line.
        const statusRow = new TextBlock()
        statusRow.color = TEXT_MUTED
        statusRow.fontSize = 13
        statusRow.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT
        statusRow.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT
        statusRow.resizeToFit = true
        guiPadding(statusRow, 0, 0, 0, 0)
        panel.addControl(statusRow)

        // Badge pills (e.g. "Running"/"Idle"), from the render model.
        const badgesPanel = new StackPanel()
        badgesPanel.isVertical = false
        badgesPanel.spacing = BADGE_GAP
        badgesPanel.adaptHeightToChildren = true
        badgesPanel.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT
        badgesPanel.isVisible = false
        panel.addControl(badgesPanel)
        this._badgesPanel = badgesPanel

        // Error banner, from the render model.
        this._errorRow = this._buildErrorRow(panel)

        // Hairline separating the stats list below from the rows above; shown
        // alongside the stats panel by `_syncStats`.
        const statsDivider = new Rectangle()
        statsDivider.heightInPixels = 1
        statsDivider.width = "100%"
        statsDivider.thickness = 0
        statsDivider.background = DIVIDER
        statsDivider.isVisible = false

        panel.addControl(statsDivider)
        this._statsDivider = statsDivider

        // Generic per-entity stats, reconciled against the render model each
        // frame into this container as a grid of tiles (created lazily by `_syncStats`).
        const statsPanel = new StackPanel()
        statsPanel.isVertical = true
        statsPanel.width = "100%"
        statsPanel.spacing = STAT_GAP
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

    private _toggleExpanded() {
        const world = this.entity.world
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

        const world = this.entity.world
        const expanded = world.focusedEntity === this.entity

        this._syncContent()

        // 2 = full label, 1 = icon only, 0 = hidden. A node on a hidden floor is
        // treated as fully out of view.
        let lod = 0;
        if (this.entity.active && this.node.isEnabled()) {
            lod = this.entity.building?.focused ? 2 : 1
        }

        for (const mesh of this._meshes()) {
            mesh.isPickable = lod !== 0
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
        const schema = this.entity.buildUiSchema()
        const color = schema.color

        this._icon.color = color
        this._label.color = color
        this._detail.color = color
        this._detailDot.background = color

        this._statusRow.text = `Status: ${schema.status}`
        this._statusRow.color = color

        this._syncBadges(schema.badges)

        this._errorRow.isVisible = !!schema.error
        if (schema.error) {
            this._errorRow.text = schema.error
        }

        this._syncStats(schema.statGroups, color)
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
