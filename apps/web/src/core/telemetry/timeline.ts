import { deepMerge, Observable } from "@babylonjs/core";
import type { EntityState } from "../building/entity";

/**
 * The structured state of the whole scene, keyed by {@link Entity.id}. A
 * heterogeneous runtime map — each entity's concrete state kind lives only in
 * its own {@link Entity} subclass, not here.
 */
export type SceneSnapshot = Record<string, EntityState>

type TimeRange = { start: number; end: number }

/**
 * Where timeline history comes from. Today it is recorded in-memory
 * ({@link InMemoryTimelineSource}); in the future a database-backed source can be
 * dropped in with no changes to the entities or UI, since both only ever consume
 * {@link stateAt}/{@link latest}/{@link range}.
 */
export interface TimelineSource {
    /** The recorded time span, or null when nothing has been recorded yet. */
    range(): TimeRange | null

    /** The merged structured state as of time `t` (latest sample at-or-before `t` per entity). */
    stateAt(t: number): SceneSnapshot

    /** The most recent structured state per entity. */
    latest(): SceneSnapshot

    /** Every recorded sample for one entity, oldest first (for history graphs). */
    history(key: string): Sample[]

    /** Fires whenever new state is recorded (i.e. the range or latest state changes). */
    readonly onChanged: Observable<TimelineSource>
}

export type Sample = { t: number; state: EntityState }

/** Keep memory bounded until a database backs the history. */
const MAX_SAMPLES_PER_ENTITY = 5000

/**
 * Shallow-merge a partial snapshot onto a base. Also deep-merges the `stats`
 * map when present, so a partial update to one stat doesn't drop the others —
 * duck-typed via {@link StatValues}, since the base {@link EntityState} stays
 * empty and only some entity kinds opt into a `stats` bag.
 */
function mergeState(base: EntityState, partial: Partial<EntityState>): EntityState {
    return deepMerge(base, partial)
}

/**
 * In-memory timeline history. Each entity gets an append-only, timestamp-ordered
 * list of merged snapshots; `record` folds a partial update onto the running
 * state so every stored sample is the entity's full state at that instant, which
 * keeps {@link stateAt} a simple per-entity binary search.
 */
export class InMemoryTimelineSource implements TimelineSource {
    readonly onChanged = new Observable<TimelineSource>()

    private readonly samplesByKey = new Map<string, Sample[]>()
    private readonly latestByKey = new Map<string, EntityState>()
    private _start?: number
    private _end?: number

    range(): TimeRange | null {
        return this._start === undefined || this._end === undefined
            ? null
            : { start: this._start, end: this._end }
    }

    /** Fold a partial update onto the entity's running state and record it at `t`. */
    record(key: string, partial: Partial<EntityState>, t: number) {
        const merged = mergeState(this.latestByKey.get(key) ?? {}, partial)
        this.latestByKey.set(key, merged)

        let samples = this.samplesByKey.get(key)
        if (!samples) {
            samples = []
            this.samplesByKey.set(key, samples)
        }
        samples.push({ t, state: merged })
        if (samples.length > MAX_SAMPLES_PER_ENTITY) {
            samples.shift()
        }

        this._start = this._start === undefined ? t : Math.min(this._start, t)
        this._end = this._end === undefined ? t : Math.max(this._end, t)

        this.onChanged.notifyObservers(this)
    }

    stateAt(t: number): SceneSnapshot {
        const snapshot: SceneSnapshot = {}
        for (const [key, samples] of this.samplesByKey) {
            const sample = lastAtOrBefore(samples, t)
            if (sample) {
                snapshot[key] = sample.state
            }
        }
        return snapshot
    }

    latest(): SceneSnapshot {
        const snapshot: SceneSnapshot = {}
        for (const [key, state] of this.latestByKey) {
            snapshot[key] = state
        }
        return snapshot
    }

    history(key: string): Sample[] {
        return [...(this.samplesByKey.get(key) ?? [])]
    }
}

/** Binary search for the last sample whose timestamp is <= `t`. */
function lastAtOrBefore(samples: Sample[], t: number): Sample | undefined {
    let lo = 0
    let hi = samples.length - 1
    let result: Sample | undefined
    while (lo <= hi) {
        const mid = (lo + hi) >> 1
        if (samples[mid]!.t <= t) {
            result = samples[mid]
            lo = mid + 1
        } else {
            hi = mid - 1
        }
    }
    return result
}

/**
 * A timeline state change. {@link animate} is true only for real-time live
 * updates (a fresh record while live), so consumers can play transition
 * animations then but snap instantly on a jump (seek, or catching back up to
 * live) to avoid mid-transition glitches while scrubbing.
 */
export type TimelineChange = { timeline: Timeline; animate: boolean }

/**
 * Drives which moment the scene displays. In live mode the current time tracks
 * the end of the recorded range; scrubbing pins it to a chosen instant while the
 * source keeps recording in the background. Emits {@link onChanged} on seek/live
 * and whenever the underlying source records new data.
 */
export class Timeline {
    readonly onChanged = new Observable<TimelineChange>()

    private _live = true
    private _currentTime?: number

    constructor(readonly source: TimelineSource) {
        this.source.onChanged.add(() => {
            if (this._live) {
                this._currentTime = this.source.range()?.end
            }
            // A fresh record while live is a real-time update → animate. While
            // scrubbing, the projected (past) state is unchanged, so this is a
            // no-op projection anyway.
            this.onChanged.notifyObservers({ timeline: this, animate: this._live })
        })
    }

    get live() {
        return this._live
    }

    get currentTime(): number | undefined {
        return this._live ? this.source.range()?.end : this._currentTime
    }

    /** The structured scene state that should currently be displayed. */
    currentState(): SceneSnapshot {
        const t = this.currentTime
        return t === undefined ? {} : this.source.stateAt(t)
    }

    /** Every recorded sample for one entity, oldest first (for history graphs). */
    history(key: string): Sample[] {
        return this.source.history(key)
    }

    /** Pin the scene to a past instant. Jumps snap, so scrubbing shows no in-progress animations. */
    seek(t: number) {
        this._live = false
        this._currentTime = t
        this.onChanged.notifyObservers({ timeline: this, animate: false })
    }

    /** Resume tracking the present. The catch-up jump snaps; subsequent live updates animate. */
    goLive() {
        this._live = true
        this._currentTime = this.source.range()?.end
        this.onChanged.notifyObservers({ timeline: this, animate: false })
    }

    dispose() {
        this.onChanged.clear()
        this.source.onChanged.clear()
    }
}
