import { AbstractMesh, Color3, ISceneLoaderAsyncResult, TransformNode } from "@babylonjs/core"
import { Area } from "./core/building/area"
import { Building, Floor } from "./core/building/building"
import { Entity, type EntityState } from "./core/building/entity"
import { PICK_PRIORITY } from "./core/building/pick-priority"
import type { UiSchema, UiStatValue } from "./core/building/ui-schema"
import type { StatIcon } from "./core/utils/icons"
import { World } from "./core/world"

/*
Demo Factory — the site modelled by `public/models/demo.glb`.

Seven areas, each an area marker mesh in the model. Six of them run equipment;
Facilities has no operational data and shows an empty card:

    Area                     Marker mesh                Stations
    Facilities               `Facilities`               —
    Welding Line             `Welding line`             1
    Inspection Line          `Inspection line`          2
    Bottle Packaging Line    `Bottle packaging line`    1
    Final Packaging Line     `Final Packaging line`     1
    Painting Line            `Painting`                 4
    Milling Line             `Milling line`             4

Stations are matched to the model by node name:

    Welding Station          `Welding station 2`        (the KUKA cell: robot, rotary table, clamps)
    Inspection Station 1/2   `Robot structure{,.001}`   (the two UR5e inspection cells)
    Bottle Packaging         `Bottle conveyor:1`
    Final Packaging          `Line`                     (palletizer, SCARA, box + part conveyors)
    UV Painting 1/2          `Cabin {1,2}`
    Drying                   `Drying Tunel`
    Polymerization           `Polimerization Tunel`
    Milling Station 1-4      `Machine{,.001,.002,.003}`

Where the areas' single station carries the same readings as the area itself
(welding and both packaging lines), one state is recorded onto both ids, so the
area card and the machine card show the same figures.

Unmapped for want of data: the second welding cell (`Rotary welding table.001`)
and the welding palletizer, the pre-treatment baths (`Bath 1-3`) and the hanger
conveyor (`Painting Hooks`) — all left over from the previous site — and every
Facilities fixture.

There is no broker in this demo. The MQTT client is idle (nothing registers a
topic, so `World` never connects it) and {@link ImplBuilder.startSimulation}
generates the whole site in the browser instead, recording onto the world's
timeline exactly where the broker's messages used to land. Everything
downstream — entity state, tags, the detail panel, history charts, scrubbing —
is unchanged.
*/

/*
Value formatting
*/

/** Thousands-separated, so a part counter stays readable as it climbs. */
const num = (value: number, digits = 0) =>
    value.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })

/*
Status
*/

/** The three states every station in the demo reports. */
export type StationStatus = "running" | "stopped" | "alarm"

/** The status side of an entity's state, shared by stations and their areas. */
export interface StatusState extends EntityState {
    status?: StationStatus
    /** What tripped, while {@link status} is `alarm`. */
    alarm?: string
}

type EntityHeader = Pick<UiSchema, "status" | "color" | "badges" | "error">

/** Status line, accent color and badges for a reported {@link StationStatus}. */
function statusHeader(state: StatusState): EntityHeader {
    switch (state.status) {
        case "running":
            return { status: "Running", color: "#22c55e", badges: [{ label: "Running", tone: "positive" }] }
        case "stopped":
            return { status: "Stopped", color: "#f59e0b", badges: [{ label: "Stopped", tone: "warning" }] }
        case "alarm":
            return {
                status: "Alarm",
                color: "#ef4444",
                badges: [{ label: "Alarm", tone: "critical" }],
                error: state.alarm ?? "Unknown alarm",
            }
        default:
            return { status: "Offline", color: "#6b7280", badges: [{ label: "Offline", tone: "neutral" }] }
    }
}

/*
Stat specs

Every entity in this file renders its stats the same way — a tile per state
field, grouped — so the entity kinds below only differ in the list of specs they
are built with, rather than in a hand-written `buildUiSchema` each.
*/

/** How one field of an entity's state becomes a tile in its detail card. */
type StatSpec<S> = {
    group: string
    name: string
    icon: StatIcon
    /** The tile's text and the raw reading behind it, or undefined to hide the tile. */
    read: (state: S) => { text: string; raw: number | string } | undefined
}

/** A numeric reading, hidden until the field has a value. */
function numberStat<S>(
    group: string,
    name: string,
    icon: StatIcon,
    pick: (state: S) => number | undefined,
    unit = "",
    digits = 0,
): StatSpec<S> {
    return {
        group,
        name,
        icon,
        read: (state) => {
            const value = pick(state)
            if (value === undefined) {
                return undefined
            }

            const text = num(value, digits)
            return { text: unit ? `${text} ${unit}` : text, raw: value }
        },
    }
}

/** A label, verdict or tally: shown as-is, with no chartable number behind it. */
function textStat<S>(
    group: string,
    name: string,
    icon: StatIcon,
    pick: (state: S) => string | undefined,
): StatSpec<S> {
    return {
        group,
        name,
        icon,
        read: (state) => {
            const value = pick(state)
            return value === undefined ? undefined : { text: value, raw: value }
        },
    }
}

/** Accumulates stats into their display groups in first-seen order. */
class StatSet {
    private groups: { group: string; stats: UiStatValue[] }[] = []
    private indexByGroup = new Map<string, number>()

    push(group: string, stat: UiStatValue) {
        let index = this.indexByGroup.get(group)
        if (index === undefined) {
            index = this.groups.length
            this.indexByGroup.set(group, index)
            this.groups.push({ group, stats: [] })
        }
        this.groups[index]!.stats.push(stat)
    }

    build(): UiSchema["statGroups"] {
        return this.groups
    }
}

/** Run a spec list against a state, dropping the specs that have no reading. */
function buildStats<S>(state: S, specs: StatSpec<S>[]): UiSchema["statGroups"] {
    const set = new StatSet()

    for (const spec of specs) {
        const read = spec.read(state)
        if (read) {
            set.push(spec.group, { name: spec.name, icon: spec.icon, value: read.text, raw: read.raw } as UiStatValue)
        }
    }

    return set.build()
}

/*
Entities
*/

/**
 * A piece of equipment anchored to a floor. Its status line, accent color and
 * badges come from the shared {@link StationStatus}; its stats come from the
 * spec list it was built with.
 */
class Station<S extends StatusState> extends Entity<TransformNode, S> {
    readonly linkOffsetY = -30
    readonly pickPriority = PICK_PRIORITY.EQUIPMENT

    constructor(
        id: string,
        name: string,
        node: TransformNode,
        readonly floor: Floor,
        world: World,
        area: Area<any>,
        private readonly specs: StatSpec<S>[],
    ) {
        super(id, name, node, world, {} as S, area)
    }

    get building(): Building {
        return this.floor.building
    }

    buildUiSchema(): UiSchema {
        return {
            name: this.name,
            ...statusHeader(this.state),
            statGroups: buildStats(this.state, this.specs),
        }
    }
}

/**
 * A building area. An area that owns equipment shows the roll-up of its
 * stations — status, machine tally, totals; one with no data at all
 * (Facilities) shows a plain `Ok` card. Unlike a station, an area keeps its own
 * accent color whatever its status, since that color also tints its zone fade.
 */
class FactoryArea<S extends StatusState> extends Area<S> {
    constructor(
        id: string,
        name: string,
        node: AbstractMesh,
        readonly floor: Floor,
        world: World,
        color: Color3,
        private readonly specs: StatSpec<S>[],
    ) {
        super(id, name, node, world, color, {} as S)
    }

    get building(): Building {
        return this.floor.building
    }

    buildUiSchema(): UiSchema {
        const equipped = this.state.status !== undefined
        const header = statusHeader(this.state)

        return {
            name: this.name,
            status: equipped ? header.status : "Ok",
            color: this.color.toHexString(),
            badges: equipped ? header.badges : [],
            error: header.error,
            statGroups: buildStats(this.state, this.specs),
        }
    }
}

/*
State

One state kind per shape of card. Fields are optional by convention — a partial
update is itself a valid state, which is what lets the timeline fold updates
together (see `World.recordState`).
*/

/**
 * A line with a single station, whose area data and station data are the same
 * set of readings: welding, bottle packaging and final packaging.
 * {@link productionRate} is carried in whatever unit that line reports — parts
 * per hour, except final packaging, which reports units per day.
 */
export interface LineState extends StatusState {
    parts?: number
    productionRate?: number
    cycleTime?: number
    /** Bottle packaging only; the other two lines leave it unset. */
    conveyorSpeed?: number
    power?: number
}

/** One of the two inspection cells. */
export interface InspectionStationState extends StatusState {
    inspected?: number
    cycleTime?: number
    accepted?: number
    rejected?: number
    /** The verdict on the part that just left the cell: `OK` or `NOK`. */
    lastInspection?: string
}

/** The inspection line's roll-up of both cells. */
export interface InspectionAreaState extends StatusState {
    /** How many cells are not in alarm, e.g. `1/2 OK`. */
    machines?: string
    inspected?: number
    accepted?: number
    rejected?: number
    productionRate?: number
}

/** A UV painting booth. */
export interface PaintBoothState extends StatusState {
    parts?: number
    cycleTime?: number
    paintFlow?: number
    paintPressure?: number
    temperature?: number
}

/**
 * A painting-line tunnel — drying or polymerization. Both are continuous, so
 * {@link residenceTime} (how long a part spends inside) is a process value in
 * its own right rather than the station's cycle.
 */
export interface TunnelState extends StatusState {
    parts?: number
    temperature?: number
    targetTemperature?: number
    residenceTime?: number
}

/** The painting line's roll-up of its four stations. */
export interface PaintingAreaState extends StatusState {
    parts?: number
    productionRate?: number
    power?: number
    activeAlarms?: number
}

/** One of the four milling machines. */
export interface MillingStationState extends StatusState {
    parts?: number
    cycleTime?: number
}

/** The milling line's roll-up of its four machines. */
export interface MillingAreaState extends StatusState {
    machines?: string
    parts?: number
    productionRate?: number
    cycleTime?: number
    power?: number
}

/** An area with no operational data at all (Facilities). */
export interface EmptyAreaState extends StatusState {}

/*
Cards

The documented data set for each area and station, in the order it is displayed.
*/

const WELDING_STATS: StatSpec<LineState>[] = [
    numberStat("Production", "Parts Produced", "hash", (s) => s.parts),
    numberStat("Production", "Production Rate", "activity", (s) => s.productionRate, "u/h"),
    numberStat("Production", "Cycle Time", "timer", (s) => s.cycleTime, "s", 1),
    numberStat("Power", "Energy Consumption", "zap", (s) => s.power, "kW", 1),
]

const BOTTLE_PACKAGING_STATS: StatSpec<LineState>[] = [
    numberStat("Production", "Bottles Packaged", "package", (s) => s.parts),
    numberStat("Production", "Production Rate", "activity", (s) => s.productionRate, "u/h"),
    numberStat("Production", "Cycle Time", "timer", (s) => s.cycleTime, "s", 1),
    numberStat("Production", "Conveyor Speed", "move", (s) => s.conveyorSpeed, "m/min", 2),
    numberStat("Power", "Energy Consumption", "zap", (s) => s.power, "kW", 1),
]

const FINAL_PACKAGING_STATS: StatSpec<LineState>[] = [
    numberStat("Production", "Packages Produced", "package", (s) => s.parts),
    numberStat("Production", "Production Rate", "activity", (s) => s.productionRate, "u/day"),
    numberStat("Production", "Cycle Time", "timer", (s) => s.cycleTime, "s", 1),
    numberStat("Power", "Energy Consumption", "zap", (s) => s.power, "kW", 1),
]

const INSPECTION_AREA_STATS: StatSpec<InspectionAreaState>[] = [
    textStat("Machines", "Machine Statuses", "circle-check", (s) => s.machines),
    numberStat("Production", "Parts Inspected", "scan-eye", (s) => s.inspected),
    numberStat("Production", "Production Rate", "activity", (s) => s.productionRate, "u/h"),
    numberStat("Quality", "Accepted Parts", "circle-check", (s) => s.accepted),
    numberStat("Quality", "Rejected Parts", "circle-x", (s) => s.rejected),
]

const INSPECTION_STATION_STATS: StatSpec<InspectionStationState>[] = [
    numberStat("Production", "Parts Inspected", "scan-eye", (s) => s.inspected),
    numberStat("Production", "Cycle Time", "timer", (s) => s.cycleTime, "s", 1),
    numberStat("Quality", "Accepted Parts", "circle-check", (s) => s.accepted),
    numberStat("Quality", "Rejected Parts", "circle-x", (s) => s.rejected),
    textStat("Quality", "Last Inspection", "scan-eye", (s) => s.lastInspection),
]

const PAINTING_AREA_STATS: StatSpec<PaintingAreaState>[] = [
    numberStat("Production", "Parts Processed", "hash", (s) => s.parts),
    numberStat("Production", "Production Rate", "activity", (s) => s.productionRate, "u/h"),
    numberStat("Power", "Energy Consumption", "zap", (s) => s.power, "kW", 1),
    numberStat("Alarms", "Active Alarms", "siren", (s) => s.activeAlarms),
]

const PAINT_BOOTH_STATS: StatSpec<PaintBoothState>[] = [
    numberStat("Production", "Parts Processed", "hash", (s) => s.parts),
    numberStat("Production", "Cycle Time", "timer", (s) => s.cycleTime, "s", 1),
    numberStat("Process", "Paint Flow", "spray-can", (s) => s.paintFlow, "L/min", 2),
    numberStat("Process", "Paint Pressure", "gauge", (s) => s.paintPressure, "bar", 2),
    numberStat("Process", "Temperature", "thermometer", (s) => s.temperature, "°C", 1),
]

/** Drying and polymerization differ only in what their residence time is called. */
const tunnelStats = (timeName: string): StatSpec<TunnelState>[] => [
    numberStat("Production", "Parts Processed", "hash", (s) => s.parts),
    numberStat("Process", "Temperature", "thermometer", (s) => s.temperature, "°C", 1),
    numberStat("Process", "Target Temperature", "thermometer", (s) => s.targetTemperature, "°C"),
    numberStat("Process", timeName, "hourglass", (s) => s.residenceTime, "min", 1),
]

const MILLING_AREA_STATS: StatSpec<MillingAreaState>[] = [
    textStat("Machines", "Machine Statuses", "circle-check", (s) => s.machines),
    numberStat("Production", "Parts Produced", "hash", (s) => s.parts),
    numberStat("Production", "Production Rate", "activity", (s) => s.productionRate, "u/day"),
    numberStat("Production", "Average Cycle Time", "timer", (s) => s.cycleTime, "s", 1),
    numberStat("Power", "Energy Consumption", "zap", (s) => s.power, "kW", 1),
]

const MILLING_STATION_STATS: StatSpec<MillingStationState>[] = [
    numberStat("Production", "Parts Produced", "hash", (s) => s.parts),
    numberStat("Production", "Cycle Time", "timer", (s) => s.cycleTime, "s", 1),
]

/*
Simulation

The site's data, generated in the browser. Every line advances its own stations
once per {@link TICK_SECONDS} and records their state onto the timeline; nothing
here touches the scene, so live and scrubbed views stay identical.
*/

/** Simulated seconds per recorded sample — the rate the broker used to publish at. */
const TICK_SECONDS = 1

/** Longest step a single tick may take, so a backgrounded tab doesn't jump the site forward. */
const MAX_TICK_SECONDS = 5

const rand = (min: number, max: number) => min + Math.random() * (max - min)

/** `value` scaled by ±`spread` (a fraction of it), for sensor noise. */
const jitter = (value: number, spread: number) => value * (1 + rand(-spread, spread))

const chance = (probability: number) => Math.random() < probability

const pickOne = <T,>(values: readonly T[]): T => values[Math.floor(Math.random() * values.length)]!

/** Move `current` a `rate`-per-second fraction of the way towards `target`. */
const approach = (current: number, target: number, rate: number, dt: number) =>
    current + (target - current) * Math.min(1, rate * dt)

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0)

const average = (values: number[]) => (values.length === 0 ? 0 : sum(values) / values.length)

const WELDING_ALARMS = ["Torch collision", "Wire feed jam", "Shielding gas flow low", "Rotary table unclamped"]
const INSPECTION_ALARMS = ["Camera calibration lost", "Part not detected", "Reject bin full"]
const BOTTLE_ALARMS = ["Bottle jam at infeed", "Gripper vacuum low", "Carton magazine empty"]
const FINAL_PACKAGING_ALARMS = ["Box pusher stalled", "Pallet not in place", "Label printer error"]
const PAINTING_ALARMS = ["Paint pressure low", "Nozzle clogged", "Extraction fan fault", "Oven temperature deviation"]
const MILLING_ALARMS = ["Tool wear limit reached", "Spindle overload", "Coolant pressure low", "Door interlock open"]

/** Share of inspected parts that fail. */
const REJECT_RATE = 0.045

/** Nominal behaviour of one simulated station. */
type StationProfile = {
    /** Seconds per part at nominal speed. */
    cycleTime: number
    /** Draw in kW while running and while down. */
    power?: { running: number; idle: number }
    /** Chance per second of an unplanned stop. */
    stopChance?: number
    /** Chance per second of an alarm. */
    alarmChance?: number
    alarms?: readonly string[]
}

/**
 * The part of every station that behaves the same: a cycle that completes
 * parts, the running/stopped/alarm state machine that interrupts it, and the
 * throughput and power that follow from both. Line-specific readings (paint
 * pressure, inspection verdicts, tunnel temperatures, ...) are layered on by
 * the line simulations below.
 */
class StationSim {
    status: StationStatus = "running"
    alarm?: string

    /** Parts completed since the page was opened. */
    parts = 0

    /** The cycle currently being run, re-jittered every tick. */
    cycleTime: number

    /** Instantaneous draw in kW, or 0 for a station with no meter. */
    power = 0

    /** Seconds accumulated into the part currently being made. */
    private phase: number

    /** Seconds left before the current stop or alarm clears. */
    private downtime = 0

    /**
     * Smoothed throughput in parts per second: the rate the station is
     * sustaining right now — its cycle while producing, zero while down or
     * starved — rather than the nominal cycle, so downtime and being starved by
     * the stage upstream both pull the reported production rate down. Seeded at
     * the nominal rate so the first cards aren't reading zero.
     */
    private throughput: number

    constructor(private readonly profile: StationProfile) {
        this.cycleTime = profile.cycleTime
        this.phase = rand(0, profile.cycleTime)
        this.throughput = 1 / profile.cycleTime
        this.power = profile.power?.running ?? 0
    }

    /**
     * Advance the station by `dt` seconds and return how many parts it
     * finished. `available` caps completions to what the stage upstream can
     * feed; the head of a line passes `Infinity` and never starves.
     */
    tick(dt: number, available = Infinity): number {
        this.updateStatus(dt)

        const power = this.profile.power
        if (power) {
            this.power = jitter(this.status === "running" ? power.running : power.idle, 0.04)
        }

        let made = 0
        let starved = false

        if (this.status === "running") {
            this.cycleTime = jitter(this.profile.cycleTime, 0.05)
            this.phase += dt

            while (this.phase >= this.cycleTime && made < available) {
                this.phase -= this.cycleTime
                made++
            }

            // A cycle that ran out but had nothing left to take was starved by
            // the stage upstream. The part waits in the machine rather than
            // being dropped, so the stage resumes the moment it is fed again.
            starved = this.phase >= this.cycleTime
            this.phase = Math.min(this.phase, this.cycleTime)
        }

        const producing = this.status === "running" && !starved
        this.throughput = approach(this.throughput, producing ? 1 / this.cycleTime : 0, 1 / 60, dt)

        this.parts += made
        return made
    }

    private updateStatus(dt: number) {
        if (this.status !== "running") {
            this.downtime -= dt
            if (this.downtime <= 0) {
                this.status = "running"
                this.alarm = undefined
            }
            return
        }

        if (chance((this.profile.alarmChance ?? 0.0005) * dt)) {
            this.status = "alarm"
            this.alarm = pickOne(this.profile.alarms ?? ["Unknown fault"])
            this.downtime = rand(25, 70)
            return
        }

        if (chance((this.profile.stopChance ?? 0.0012) * dt)) {
            this.status = "stopped"
            this.downtime = rand(12, 45)
        }
    }

    get ratePerHour() {
        return this.throughput * 3600
    }

    get ratePerDay() {
        return this.ratePerHour * 24
    }

    /** Whether the station counts towards its area's `n/m OK` tally. */
    get ok() {
        return this.status !== "alarm"
    }

    /** The status half of this station's recorded state. */
    get statusState(): StatusState {
        return { status: this.status, alarm: this.alarm }
    }
}

/** `2/4 OK` — the machine tally the inspection and milling areas display. */
const okTally = (stations: StationSim[]) => `${stations.filter((s) => s.ok).length}/${stations.length} OK`

/** An area is in alarm if any of its stations is, and running while any of them runs. */
function rollUpStatus(stations: StationSim[]): StationStatus {
    if (stations.some((s) => s.status === "alarm")) {
        return "alarm"
    }
    if (stations.some((s) => s.status === "running")) {
        return "running"
    }
    return "stopped"
}

/** The alarm shown on an area's card: the first one active on the line. */
const firstAlarm = (stations: StationSim[]) => stations.find((s) => s.status === "alarm")?.alarm

/** One simulated line: advances its stations and records their state each tick. */
interface LineSim {
    tick(dt: number): void
}

/**
 * A line whose one station *is* the line — welding, bottle packaging and final
 * packaging. The same state is recorded onto the area and the station, so both
 * cards read identically, as the documented data set does.
 */
class SingleStationLine implements LineSim {
    private readonly station: StationSim

    constructor(
        private readonly world: World,
        private readonly areaId: string,
        private readonly stationId: string,
        profile: StationProfile,
        /** `ratePerDay` reports units/day instead of parts/h; `conveyorSpeed` is the nominal belt speed in m/min. */
        private readonly options: { ratePerDay?: boolean; conveyorSpeed?: number } = {},
    ) {
        this.station = new StationSim(profile)
    }

    tick(dt: number) {
        const station = this.station
        station.tick(dt)

        const running = station.status === "running"
        const nominalSpeed = this.options.conveyorSpeed

        const state: LineState = {
            ...station.statusState,
            parts: station.parts,
            productionRate: this.options.ratePerDay ? station.ratePerDay : station.ratePerHour,
            cycleTime: station.cycleTime,
            power: station.power,
            conveyorSpeed:
                nominalSpeed === undefined ? undefined : running ? jitter(nominalSpeed, 0.02) : 0,
        }

        this.world.recordState(this.areaId, state)
        this.world.recordState(this.stationId, state)
    }
}

/** The two inspection cells, each judging the parts it measures. */
class InspectionLine implements LineSim {
    private readonly stations: StationSim[]

    /** Per-cell verdict tally, kept alongside the shared station simulation. */
    private readonly quality: { accepted: number; rejected: number; last?: string }[]

    constructor(
        private readonly world: World,
        private readonly areaId: string,
        private readonly stationIds: string[],
    ) {
        this.stations = stationIds.map(
            () =>
                new StationSim({
                    cycleTime: 18,
                    power: { running: 4.2, idle: 0.7 },
                    alarms: INSPECTION_ALARMS,
                }),
        )
        this.quality = stationIds.map(() => ({ accepted: 0, rejected: 0 }))
    }

    tick(dt: number) {
        this.stations.forEach((station, index) => {
            const inspected = station.tick(dt)
            const quality = this.quality[index]!

            for (let part = 0; part < inspected; part++) {
                const accepted = !chance(REJECT_RATE)
                if (accepted) {
                    quality.accepted++
                } else {
                    quality.rejected++
                }
                quality.last = accepted ? "OK" : "NOK"
            }

            const state: InspectionStationState = {
                ...station.statusState,
                inspected: station.parts,
                cycleTime: station.cycleTime,
                accepted: quality.accepted,
                rejected: quality.rejected,
                lastInspection: quality.last,
            }

            this.world.recordState(this.stationIds[index]!, state)
        })

        const state: InspectionAreaState = {
            status: rollUpStatus(this.stations),
            alarm: firstAlarm(this.stations),
            machines: okTally(this.stations),
            inspected: sum(this.stations.map((s) => s.parts)),
            accepted: sum(this.quality.map((q) => q.accepted)),
            rejected: sum(this.quality.map((q) => q.rejected)),
            productionRate: sum(this.stations.map((s) => s.ratePerHour)),
        }

        this.world.recordState(this.areaId, state)
    }
}

/** Ambient the tunnels cool towards once they stop heating. */
const TUNNEL_COLD = 40

const DRYING_TARGET = 65
const DRYING_MINUTES = 12

const POLYMERIZATION_TARGET = 180
const POLYMERIZATION_MINUTES = 25

/**
 * The painting line: the two UV booths paint in parallel, and what they finish
 * moves through the drying tunnel and then the polymerization tunnel. Both
 * tunnels are continuous, so their cycle is the takt of one part passing
 * through while the residence time is how long it spends inside; their
 * temperatures climb towards setpoint while heating and fall towards
 * {@link TUNNEL_COLD} while stopped.
 */
class PaintingLine implements LineSim {
    private readonly booths: StationSim[]
    private readonly drying = new StationSim({
        cycleTime: 14,
        power: { running: 34, idle: 9 },
        alarms: PAINTING_ALARMS,
    })
    private readonly polymerization = new StationSim({
        cycleTime: 14,
        power: { running: 52, idle: 14 },
        alarms: PAINTING_ALARMS,
    })

    /** Parts finished upstream and not yet taken by the next stage. */
    private toDry = 0
    private toPolymerize = 0

    private dryingTemperature = DRYING_TARGET
    private polymerizationTemperature = POLYMERIZATION_TARGET

    constructor(
        private readonly world: World,
        private readonly areaId: string,
        private readonly boothIds: string[],
        private readonly dryingId: string,
        private readonly polymerizationId: string,
    ) {
        // Two booths at 36 s each feed the tunnels a part every 18 s, comfortably
        // inside the 14 s the tunnels take, so the booths set the line's pace.
        this.booths = boothIds.map(
            () =>
                new StationSim({
                    cycleTime: 36,
                    power: { running: 18, idle: 3 },
                    alarms: PAINTING_ALARMS,
                }),
        )
    }

    tick(dt: number) {
        this.toDry += sum(this.booths.map((booth) => booth.tick(dt)))

        const dried = this.drying.tick(dt, this.toDry)
        this.toDry -= dried
        this.toPolymerize += dried

        this.toPolymerize -= this.polymerization.tick(dt, this.toPolymerize)

        this.booths.forEach((booth, index) => {
            const running = booth.status === "running"

            const state: PaintBoothState = {
                ...booth.statusState,
                parts: booth.parts,
                cycleTime: booth.cycleTime,
                paintFlow: running ? jitter(0.42, 0.06) : 0,
                paintPressure: running ? jitter(2.6, 0.04) : jitter(0.25, 0.3),
                temperature: jitter(23.5, 0.02),
            }

            this.world.recordState(this.boothIds[index]!, state)
        })

        this.dryingTemperature = approach(
            this.dryingTemperature,
            this.drying.status === "running" ? DRYING_TARGET : TUNNEL_COLD,
            1 / 90,
            dt,
        )
        this.polymerizationTemperature = approach(
            this.polymerizationTemperature,
            this.polymerization.status === "running" ? POLYMERIZATION_TARGET : TUNNEL_COLD,
            1 / 150,
            dt,
        )

        this.world.recordState<TunnelState>(this.dryingId, {
            ...this.drying.statusState,
            parts: this.drying.parts,
            temperature: jitter(this.dryingTemperature, 0.006),
            targetTemperature: DRYING_TARGET,
            residenceTime: jitter(DRYING_MINUTES, 0.02),
        })

        this.world.recordState<TunnelState>(this.polymerizationId, {
            ...this.polymerization.statusState,
            parts: this.polymerization.parts,
            temperature: jitter(this.polymerizationTemperature, 0.004),
            targetTemperature: POLYMERIZATION_TARGET,
            residenceTime: jitter(POLYMERIZATION_MINUTES, 0.02),
        })

        const stations = [...this.booths, this.drying, this.polymerization]

        const state: PaintingAreaState = {
            status: rollUpStatus(stations),
            alarm: firstAlarm(stations),
            parts: this.polymerization.parts,
            productionRate: this.polymerization.ratePerHour,
            power: sum(stations.map((s) => s.power)),
            activeAlarms: stations.filter((s) => s.status === "alarm").length,
        }

        this.world.recordState(this.areaId, state)
    }
}

/** Four independent milling machines, each tended by its own robot. */
class MillingLine implements LineSim {
    private readonly stations: StationSim[]

    constructor(
        private readonly world: World,
        private readonly areaId: string,
        private readonly stationIds: string[],
    ) {
        this.stations = stationIds.map(
            () =>
                new StationSim({
                    cycleTime: rand(88, 104),
                    power: { running: 21, idle: 4 },
                    alarms: MILLING_ALARMS,
                }),
        )
    }

    tick(dt: number) {
        this.stations.forEach((station, index) => {
            station.tick(dt)

            this.world.recordState<MillingStationState>(this.stationIds[index]!, {
                ...station.statusState,
                parts: station.parts,
                cycleTime: station.cycleTime,
            })
        })

        const state: MillingAreaState = {
            status: rollUpStatus(this.stations),
            alarm: firstAlarm(this.stations),
            machines: okTally(this.stations),
            parts: sum(this.stations.map((s) => s.parts)),
            productionRate: sum(this.stations.map((s) => s.ratePerDay)),
            cycleTime: average(this.stations.map((s) => s.cycleTime)),
            power: sum(this.stations.map((s) => s.power)),
        }

        this.world.recordState(this.areaId, state)
    }
}

/*
Areas
*/

/** One accent color per area, used for its zone fade, tag and stat tiles. */
const AREA_COLORS = {
    welding: new Color3(0.23, 0.51, 0.96),
    inspection: new Color3(0.55, 0.36, 0.96),
    bottlePackaging: new Color3(0.06, 0.65, 0.91),
    finalPackaging: new Color3(0.02, 0.71, 0.83),
    painting: new Color3(0.96, 0.55, 0.19),
    milling: new Color3(0.34, 0.4, 0.95),
    facilities: new Color3(0.13, 0.7, 0.47),
}

/*

*/

export class ImplBuilder {

    private result: ISceneLoaderAsyncResult

    private nodesByName: Map<string, TransformNode>

    constructor(result: ISceneLoaderAsyncResult) {
        this.result = result

        this.nodesByName = new Map()

        for (const node of result.transformNodes) {
            this.nodesByName.set(node.name, node)
        }

        for (const node of result.meshes) {
            this.nodesByName.set(node.name, node)
        }
    }

    /*

    */

    findNode(name: string) {
        const transformNode = this.nodesByName.get(name)
        if (!transformNode) {
            throw new Error(`Could not find node of name '${name}'`)
        }

        return transformNode
    }

    findMesh(name: string) {
        const node = this.findNode(name)

        if (node instanceof AbstractMesh) {
            return node
        }

        throw new Error(`Expected mesh of name '${name}' but found TransformNode`)
    }

    /*
    Simulation
    */

    /**
     * Drive the line simulations off the scene's clock, one tick per
     * {@link TICK_SECONDS}. Running on the render loop means the site pauses
     * with the scene and stops with it, rather than outliving it on a timer.
     */
    private startSimulation(world: World, lines: LineSim[]) {
        // A sweep writes ~20 entity states; batching them lands the whole tick
        // on the timeline as one change instead of twenty.
        const tick = (dt: number) => {
            world.recordBatch(() => {
                for (const line of lines) {
                    line.tick(dt)
                }
            })
        }

        // Fill the cards immediately instead of showing an empty first second.
        tick(TICK_SECONDS)

        let elapsed = 0

        const observer = world.scene.onBeforeRenderObservable.add((scene) => {
            elapsed += scene.getEngine().getDeltaTime() / 1000
            if (elapsed < TICK_SECONDS) {
                return
            }

            const dt = Math.min(elapsed, MAX_TICK_SECONDS)
            elapsed = 0

            tick(dt)
        })

        world.scene.onDisposeObservable.add(() => observer.remove())
    }

    /*

    */

    build(world: World): Building {
        const buildingRootNode = this.result.meshes[0]!

        //

        const building = new Building(world, 'Demo Factory', buildingRootNode)

        const floor = building.addFloor("Floor 0", this.findNode('Floor'))

        const area = <S extends StatusState>(id: string, name: string, mesh: string, color: Color3, specs: StatSpec<S>[]) =>
            new FactoryArea<S>(`area:${id}`, name, this.findMesh(mesh), floor, world, color, specs)

        const station = <S extends StatusState>(id: string, name: string, node: string, area: Area<any>, specs: StatSpec<S>[]) =>
            new Station<S>(`station:${id}`, name, this.findNode(node), floor, world, area, specs)

        /*
        Facilities — the offices, canteen and warehouse. No operational data.
        */

        const areaFacilities = area<EmptyAreaState>("facilities", "Facilities", "Facilities", AREA_COLORS.facilities, [])

        /*
        Welding line — one KUKA cell on the rotary table.
        */

        const areaWelding = area<LineState>("welding", "Welding Line", "Welding line", AREA_COLORS.welding, WELDING_STATS)
        const welding = station<LineState>("welding", "Welding Station", "Welding station 2", areaWelding, WELDING_STATS)

        /*
        Inspection line — two UR5e cells measuring in parallel.
        */

        const areaInspection = area<InspectionAreaState>("inspection", "Inspection Line", "Inspection line", AREA_COLORS.inspection, INSPECTION_AREA_STATS)
        const inspection1 = station<InspectionStationState>("inspection-1", "Inspection Station 1", "Robot structure", areaInspection, INSPECTION_STATION_STATS)
        const inspection2 = station<InspectionStationState>("inspection-2", "Inspection Station 2", "Robot structure.001", areaInspection, INSPECTION_STATION_STATS)

        /*
        Bottle packaging line — the bottle conveyor, its gantry and the carton
        conveyors it feeds.
        */

        const areaBottlePackaging = area<LineState>("bottle-packaging", "Bottle Packaging Line", "Bottle packaging line", AREA_COLORS.bottlePackaging, BOTTLE_PACKAGING_STATS)
        const bottlePackaging = station<LineState>("bottle-packaging", "Bottle Packaging", "Bottle conveyor:1", areaBottlePackaging, BOTTLE_PACKAGING_STATS)

        /*
        Final packaging line — the SCARA, the palletizing KUKA and the box and
        part conveyors between them.
        */

        const areaFinalPackaging = area<LineState>("final-packaging", "Final Packaging Line", "Final Packaging line", AREA_COLORS.finalPackaging, FINAL_PACKAGING_STATS)
        const finalPackaging = station<LineState>("final-packaging", "Final Packaging", "Line", areaFinalPackaging, FINAL_PACKAGING_STATS)

        /*
        Painting line — two UV booths into the drying and polymerization tunnels.
        */

        const areaPainting = area<PaintingAreaState>("painting", "Painting Line", "Painting", AREA_COLORS.painting, PAINTING_AREA_STATS)
        const uvPainting1 = station<PaintBoothState>("uv-painting-1", "UV Painting 1", "Cabin 1", areaPainting, PAINT_BOOTH_STATS)
        const uvPainting2 = station<PaintBoothState>("uv-painting-2", "UV Painting 2", "Cabin 2", areaPainting, PAINT_BOOTH_STATS)
        const drying = station<TunnelState>("drying", "Drying", "Drying Tunel", areaPainting, tunnelStats("Drying Time"))
        const polymerization = station<TunnelState>("polymerization", "Polymerization", "Polimerization Tunel", areaPainting, tunnelStats("Polymerization Time"))

        /*
        Milling line — four machines, each with its own loading robot.
        */

        const areaMilling = area<MillingAreaState>("milling", "Milling Line", "Milling line", AREA_COLORS.milling, MILLING_AREA_STATS)
        const millingStations = ["Machine", "Machine.001", "Machine.002", "Machine.003"].map((node, index) =>
            station<MillingStationState>(`milling-${index + 1}`, `Milling Station ${index + 1}`, node, areaMilling, MILLING_STATION_STATS),
        )

        /*

        */

        world.entities.push(
            areaFacilities,
            areaWelding,
            welding,
            areaInspection,
            inspection1,
            inspection2,
            areaBottlePackaging,
            bottlePackaging,
            areaFinalPackaging,
            finalPackaging,
            areaPainting,
            uvPainting1,
            uvPainting2,
            drying,
            polymerization,
            areaMilling,
            ...millingStations,
        )

        /*
        The site's data. No broker in this demo — every line generates its own
        readings and records them where the MQTT bindings used to.
        */

        this.startSimulation(world, [
            new SingleStationLine(world, areaWelding.id, welding.id, {
                cycleTime: 42,
                power: { running: 37, idle: 6 },
                alarms: WELDING_ALARMS,
            }),

            new InspectionLine(world, areaInspection.id, [inspection1.id, inspection2.id]),

            new SingleStationLine(
                world,
                areaBottlePackaging.id,
                bottlePackaging.id,
                {
                    cycleTime: 6,
                    power: { running: 12.5, idle: 2 },
                    alarms: BOTTLE_ALARMS,
                },
                { conveyorSpeed: 14 },
            ),

            new SingleStationLine(
                world,
                areaFinalPackaging.id,
                finalPackaging.id,
                {
                    cycleTime: 26,
                    power: { running: 16, idle: 3 },
                    alarms: FINAL_PACKAGING_ALARMS,
                },
                { ratePerDay: true },
            ),

            new PaintingLine(
                world,
                areaPainting.id,
                [uvPainting1.id, uvPainting2.id],
                drying.id,
                polymerization.id,
            ),

            new MillingLine(world, areaMilling.id, millingStations.map(s => s.id)),
        ])

        return building
    }

}
