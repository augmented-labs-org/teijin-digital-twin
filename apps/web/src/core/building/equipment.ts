import { Observable, TransformNode } from "@babylonjs/core"
import type { Area } from "./area"
import type { Building } from "./building"
import { Entity, EntityStatus, TagBody } from "./entity"
import { PICK_PRIORITY } from "./pick-priority"
import type { EntityStateSnapshot } from "../telemetry/timeline"

/**
 * An {@link Entity} for a single piece of equipment. Its status comes straight
 * off its own state; the detail card adds a "Running" row and an error row.
 */
export class Equipment extends Entity<TransformNode> {
    readonly idPrefix = "equipment"
    readonly linkOffsetY = -30
    readonly pickPriority = PICK_PRIORITY.EQUIPMENT

    readonly area: Area

    /**
     * Fired whenever any of {@link online}/{@link running}/{@link errored}/
     * {@link errorReason} actually changes. View side-effects that aren't read
     * every frame (semaphore lights, press animations) subscribe here so they are
     * reproduced identically whether the change came from live data or from
     * scrubbing history through {@link applyState}.
     */
    readonly onStateChanged = new Observable<Equipment>()

    private _online = false
    private _running = false
    private _errored = false
    private _errorReason?: string

    constructor(area: Area, name: string, node: TransformNode) {
        super(name, node, area.floor)

        this.area = area
    }

    get building(): Building {
        return this.area.building
    }

    get online() {
        return this._online
    }

    set online(val: boolean) {
        if (val === this._online) {
            return
        }
        this._online = val
        this.onStateChanged.notifyObservers(this)
    }

    get running() {
        return this._running
    }

    set running(val: boolean) {
        if (val === this._running) {
            return
        }
        this._running = val
        this.onStateChanged.notifyObservers(this)
    }

    get errored() {
        return this._errored
    }

    set errored(val: boolean) {
        if (val === this._errored) {
            return
        }
        this._errored = val
        this.onStateChanged.notifyObservers(this)
    }

    get errorReason() {
        return this._errorReason
    }

    set errorReason(val: string | undefined) {
        if (val === this._errorReason) {
            return
        }
        this._errorReason = val
        this.onStateChanged.notifyObservers(this)
    }

    override applyState(state: EntityStateSnapshot) {
        super.applyState(state)
        if (state.online !== undefined) {
            this.online = state.online
        }
        if (state.running !== undefined) {
            this.running = state.running
        }
        if (state.errored !== undefined) {
            this.errored = state.errored
        }
        // errorReason is only meaningful while errored; clear it otherwise.
        this.errorReason = state.errored ? state.errorReason : undefined
    }


    get status(): EntityStatus {
        if (this.errored) {
            return {
                status: "Error",
                color: "#ef4444"
            }
        }

        return this.online ? {
            status: "Online",
            color: "#22c55e"
        } : {
            status: "Offline"
        }
    }

    buildDetailBody(body: TagBody): (color: string) => void {
        const runningRow = body.infoRow()
        const errorRow = body.errorRow()

        return () => {
            runningRow.text = `Running: ${this.running ? "Yes" : "No"}`

            errorRow.isVisible = this.errored
            if (this.errored) {
                errorRow.text = this.errorReason ?? "Unknown error"
            }
        }
    }
}
