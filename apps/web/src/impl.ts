import { AbstractMesh, Color3, ISceneLoaderAsyncResult, TransformNode } from "@babylonjs/core"
import { Area } from "./core/building/area"
import { Building, Floor } from "./core/building/building"
import { Entity, type EntityState } from "./core/building/entity"
import { PICK_PRIORITY } from "./core/building/pick-priority"
import type { StatIcon } from "./core/utils/icons"
import { EntityGroup, World } from "./core/world"
import type { UiSchema, UiStatValue } from "./core/building/ui-schema"

/*
Teijin Leça — the site simulated by `tools/teijin.py`.

Two machines publish under `teijin/leca/<machine>/<source>/<Signal_Name>`, one
sweep per second, 106 signals in total:

    php-1250          plc-a (11) · plc-b (11) · energy (20)
    pintura-classica  plc (44)  · energy (20)

Every one of those signals is wired below. Payloads are `{value, unit, ts}` — the
world unwraps `.value` before it is folded into an entity's state, so only the
raw value is dealt with here; formatting for display happens in each entity's
`buildUiSchema`.

Nodes are matched to `teijin.glb` by name. Most of it is unambiguous (`Bath 1-3`
against the `Bath_{1,2,3}_*` signals, `Cabin 1-2` against `Cabin_{1,2}_*`,
`Drying Tunel` against `Dryer_Temperature`); the rest is inferred:

  - `Press 1` is taken to be the PHP 1250. The model has a second press
    (`Press 2`) that the simulator doesn't publish, so it is left unmapped.
  - `Painting Hooks` — the hanger conveyor running the length of the line — is
    used for the painting line itself, since `Line_Speed` is that conveyor's
    speed and the baths, tunnel and booths it passes through are their own
    equipment.
  - The two Shelly 3EM meters have no geometry in the model, so their readings
    sit on the state of the area their machine is in, as does the paint room
    climate (`Paint_Room_*`, which has no room of its own in the model).
  - Unmapped for want of signals: `Press 2`, `Polimerization Tunel`, `Tanks`.

The model's `Press down` / `Press up` animation groups are unused for now.
*/

const SITE = "teijin/leca"

const PHP = `${SITE}/php-1250`
const PHP_A = `${PHP}/plc-a`
const PHP_B = `${PHP}/plc-b`
const PHP_ENERGY = `${PHP}/energy`

const PINTURA = `${SITE}/pintura-classica`
const PINTURA_PLC = `${PINTURA}/plc`
const PINTURA_ENERGY = `${PINTURA}/energy`

/** `Movable_Platen_State` is the press cycle phase as an int. */
const PLATEN_STATES = ["Stopped", "Closing", "Pressing", "Opening"]

/**
 * Painting-line alarm codes. `Alarm_1` is process/mechanical, `Alarm_2` is
 * derived from a bath reading leaving its published Min/Max band, `Alarm_3` is
 * utilities. 0 means no active alarm.
 */
const ALARM_LABELS: Record<number, string> = {
    205: "Line jam",
    402: "Conveyor drive",
    118: "Hanger",
    331: "Oven damper",
    101: "Bath temperature",
    102: "Bath pressure",
    103: "Bath pH",
    510: "Compressed air low",
    522: "Exhaust fan",
}

/*
Value formatting
*/

/** A missing reading (nothing published on that topic yet). */
const NO_VALUE = "—"

const num = (raw: unknown, digits = 1) =>
    raw === undefined || raw === null ? NO_VALUE : Number(raw).toFixed(digits)

/** Trims trailing zeros, so a configuration limit reads `52` and not `52.0`. */
const trim = (raw: unknown) => (raw === undefined || raw === null ? NO_VALUE : String(Number(raw)))

const round = (raw: unknown) => Math.round(Number(raw))

const alarm = (raw: unknown) => {
    const code = round(raw)
    if (code === 0) {
        return "None"
    }
    return `${ALARM_LABELS[code] ?? "Unknown"} (${code})`
}

const yesNo = (raw: unknown) => (raw === true ? "Yes" : "No")

/** Unwraps a `{value, unit, ts}` payload; tolerates a bare value. */
const unwrap = (data: unknown) =>
    data && typeof data === "object" && "value" in data ? (data as { value: unknown }).value : data

/** A reading shown against the setpoint it is tracking, e.g. `147.2 °C → 148`. */
const setpointText = (value: unknown, setpoint: unknown, unit: string, digits = 1) => {
    const reading = `${num(value, digits)} ${unit}`
    return setpoint === undefined ? reading : `${reading} → ${trim(setpoint)}`
}

/** A stat's displayed value paired with the raw (unformatted) reading behind it. */
function statValue(name: string, icon: StatIcon, value: string, raw: number): UiStatValue
function statValue(name: string, icon: StatIcon, value: string, raw: string): UiStatValue
function statValue(name: string, icon: StatIcon, value: string, raw: number | string): UiStatValue {
    return { name, icon, value, raw } as UiStatValue
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

/*
Entities
*/

export interface MachineState extends EntityState {
    online?: boolean
    running?: boolean
    errored?: boolean
    errorReason?: string
}

type MachineHeader = Pick<UiSchema, "status" | "color" | "badges" | "error">

/**
 * A piece of equipment anchored to a floor. Its accent color, status line and
 * badges are all derived from the shared online/running/errored trio via
 * {@link header}; subclasses only need to describe their own stat groups.
 */
abstract class Machine<S extends MachineState> extends Entity<TransformNode, S> {
    readonly linkOffsetY = -30
    readonly pickPriority = PICK_PRIORITY.EQUIPMENT

    readonly floor: Floor

    constructor(id: string, name: string, node: TransformNode, floor: Floor, world: World, defaultState: S) {
        super(id, name, node, world, defaultState)
        this.floor = floor
    }

    get building(): Building {
        return this.floor.building
    }

    protected header(): MachineHeader {
        const { online, running, errored, errorReason } = this.state

        if (errored) {
            return {
                status: "Error",
                color: "#ef4444",
                badges: [{ label: "Error", tone: "critical" }],
                error: errorReason ?? "Unknown error",
            }
        }

        if (!online) {
            return { status: "Offline", color: "#6b7280", badges: [{ label: "Offline", tone: "neutral" }] }
        }

        return running
            ? { status: "Running", color: "#22c55e", badges: [{ label: "Running", tone: "positive" }] }
            : { status: "Idle", color: "#f59e0b", badges: [{ label: "Idle", tone: "warning" }] }
    }
}

/**
 * The compression press: `plc-a` — the molding cycle, what is being made and
 * where the platen is — plus `plc-b`, a second PLC on the same machine
 * carrying the heated tooling (four platen zones tracking their recipe
 * setpoints, plus the two mold thermocouples that dip when a cold charge is
 * laid on the open mold).
 */
export interface PressState extends MachineState {
    product?: string
    parts?: number
    pressure?: number
    targetPressure?: number
    platenPosition?: number
    platenState?: number
    platenSpeed?: number
    compressionTime?: number
    targetTime?: number
    totalTime?: number
    remainingTime?: number
    fixedPlaten1?: number
    fixedPlaten1Setpoint?: number
    fixedPlaten2?: number
    fixedPlaten2Setpoint?: number
    movablePlaten1?: number
    movablePlaten1Setpoint?: number
    movablePlaten2?: number
    movablePlaten2Setpoint?: number
    moldCavityTemp?: number
    moldMaleTemp?: number
    cycleTime?: number
}

class PressEntity extends Machine<PressState> {
    constructor(id: string, name: string, node: TransformNode, floor: Floor, world: World) {
        super(id, name, node, floor, world, {})
    }

    buildUiSchema(): UiSchema {
        const s = this.state
        const stats = new StatSet()

        if (s.product !== undefined) {
            stats.push("Production", statValue("Product", "tag", s.product, s.product))
        }
        if (s.parts !== undefined) {
            stats.push("Production", statValue("Parts", "hash", `${round(s.parts)}`, s.parts))
        }
        // stats.push("Production", statValue("Pressure", "gauge", setpointText(s.pressure, s.targetPressure, "bar"), s.pressure ?? 0))
        // stats.push("Production", statValue("Platen", "ruler", `${num(s.platenPosition, 0)} mm`, s.platenPosition ?? 0))
        // stats.push("Production", statValue("Platen State", "settings", PLATEN_STATES[round(s.platenState)] ?? NO_VALUE, PLATEN_STATES[round(s.platenState)] ?? NO_VALUE))
        // stats.push("Production", statValue("Platen Speed", "move", `${num(s.platenSpeed, 1)} mm/s`, s.platenSpeed ?? 0))
        // stats.push("Production", statValue("Compression", "timer", setpointText(s.compressionTime, s.targetTime, "s"), s.compressionTime ?? 0))
        // stats.push("Production", statValue("Elapsed", "clock", `${num(s.totalTime, 1)} s`, s.totalTime ?? 0))
        if (s.remainingTime !== undefined) {
            stats.push("Production", statValue("Remaining", "hourglass", `${num(s.remainingTime, 1)} s`, s.remainingTime))
        }
        // stats.push("Production", statValue("Fixed Platen 1", "thermometer", setpointText(s.fixedPlaten1, s.fixedPlaten1Setpoint, "°C"), s.fixedPlaten1 ?? 0))
        // stats.push("Production", statValue("Fixed Platen 2", "thermometer", setpointText(s.fixedPlaten2, s.fixedPlaten2Setpoint, "°C"), s.fixedPlaten2 ?? 0))
        // stats.push("Production", statValue("Movable Platen 1", "thermometer", setpointText(s.movablePlaten1, s.movablePlaten1Setpoint, "°C"), s.movablePlaten1 ?? 0))
        // stats.push("Production", statValue("Movable Platen 2", "thermometer", setpointText(s.movablePlaten2, s.movablePlaten2Setpoint, "°C"), s.movablePlaten2 ?? 0))
        // stats.push("Production", statValue("Mold Cavity", "thermometer", `${num(s.moldCavityTemp, 1)} °C`, s.moldCavityTemp ?? 0))
        // stats.push("Production", statValue("Mold Male", "thermometer", `${num(s.moldMaleTemp, 1)} °C`, s.moldMaleTemp ?? 0))
        if (s.cycleTime !== undefined) {
            stats.push("Production", statValue("Cycle Time", "timer", `${num(s.cycleTime, 0)} s`, s.cycleTime))
        }

        return { name: this.name, ...this.header(), statGroups: stats.build() }
    }
}

/**
 * The painting line's own signals — the hanger conveyor's speed, the downtime
 * flag and the three alarm words. Anchored to the conveyor, since the baths,
 * tunnel and booths it runs through are equipment in their own right.
 */
export interface PaintingLineState extends MachineState {
    lineSpeed?: number
    downtime?: boolean
    alarm1?: number
    alarm2?: number
    alarm3?: number
}

class PaintingLineEntity extends Machine<PaintingLineState> {
    constructor(id: string, name: string, node: TransformNode, floor: Floor, world: World) {
        super(id, name, node, floor, world, {})
    }

    buildUiSchema(): UiSchema {
        const s = this.state
        const stats = new StatSet()

        if (s.lineSpeed !== undefined) {
            stats.push("Production", statValue("Line Speed", "move", `${num(s.lineSpeed, 2)} m/min`, s.lineSpeed))
        }
        if (s.downtime !== undefined) {
            stats.push("Production", statValue("Downtime", "ban", yesNo(s.downtime), yesNo(s.downtime)))
        }
        if (s.alarm1 !== undefined) {
            stats.push("Production", statValue("Alarm 1", "siren", alarm(s.alarm1), alarm(s.alarm1)))
        }
        if (s.alarm2 !== undefined) {
            stats.push("Production", statValue("Alarm 2", "siren", alarm(s.alarm2), alarm(s.alarm2)))
        }
        if (s.alarm3 !== undefined) {
            stats.push("Production", statValue("Alarm 3", "siren", alarm(s.alarm3), alarm(s.alarm3)))
        }

        return { name: this.name, ...this.header(), statGroups: stats.build() }
    }
}

/**
 * A pre-treatment bath: temperature and pressure. Bath 1 is the alkaline
 * degrease, so it also carries the pH probe (`hasPh`).
 */
export interface BathState extends MachineState {
    temperature?: number
    pressure?: number
    ph?: number
}

class BathEntity extends Machine<BathState> {
    readonly hasPh: boolean

    constructor(id: string, name: string, node: TransformNode, floor: Floor, world: World, hasPh: boolean) {
        super(id, name, node, floor, world, {})
        this.hasPh = hasPh
    }

    buildUiSchema(): UiSchema {
        const s = this.state
        const stats = new StatSet()

        if (s.temperature !== undefined) {
            stats.push("Environment", statValue("Temperature", "thermometer", `${num(s.temperature, 1)} °C`, s.temperature))
        }
        if (s.pressure !== undefined) {
            stats.push("Environment", statValue("Pressure", "gauge", `${num(s.pressure, 2)} bar`, s.pressure))
        }
        if (this.hasPh && s.ph !== undefined) {
            stats.push("Environment", statValue("pH", "test-tube", num(s.ph, 2), s.ph))
        }

        return { name: this.name, ...this.header(), statGroups: stats.build() }
    }
}

/** A paint booth (`Cabin N` in the model, `Cabin_N_*` on the PLC): climate controlled. */
export interface BoothState extends MachineState {
    temperature?: number
    humidity?: number
}

class BoothEntity extends Machine<BoothState> {
    constructor(id: string, name: string, node: TransformNode, floor: Floor, world: World) {
        super(id, name, node, floor, world, {})
    }

    buildUiSchema(): UiSchema {
        const s = this.state
        const stats = new StatSet()

        if (s.temperature !== undefined) {
            stats.push("Environment", statValue("Temperature", "thermometer", `${num(s.temperature, 1)} °C`, s.temperature))
        }
        if (s.humidity !== undefined) {
            stats.push("Environment", statValue("Humidity", "droplet", `${num(s.humidity, 1)} %`, s.humidity))
        }

        return { name: this.name, ...this.header(), statGroups: stats.build() }
    }
}

/** The drying tunnel between the baths and the paint booths. */
export interface DryerState extends MachineState {
    temperature?: number
}

class DryerEntity extends Machine<DryerState> {
    constructor(id: string, name: string, node: TransformNode, floor: Floor, world: World) {
        super(id, name, node, floor, world, {})
    }

    buildUiSchema(): UiSchema {
        const s = this.state
        const stats = new StatSet()

        if (s.temperature !== undefined) {
            stats.push("Environment", statValue("Temperature", "flame", `${num(s.temperature, 1)} °C`, s.temperature))
        }

        return { name: this.name, ...this.header(), statGroups: stats.build() }
    }
}

/**
 * A building area. Neither Shelly 3EM meter is modelled, so each machine's
 * power reading sits on the area it stands in; the paint room's climate has
 * nowhere better to live either.
 */
export interface AreaState extends EntityState {
    totalPower?: number
    parts?: number
    roomTemperature?: number
    roomHumidity?: number
}

class AreaEntity extends Area<AreaState> {
    readonly floor: Floor

    constructor(id: string, name: string, node: AbstractMesh, floor: Floor, world: World, color: Color3) {
        super(id, name, node, world, color, {})
        this.floor = floor
    }

    get building(): Building {
        return this.floor.building
    }

    buildUiSchema(): UiSchema {
        const s = this.state
        const stats = new StatSet()

        if (s.totalPower !== undefined) {
            stats.push("Power", statValue("Total Power", "zap", `${num(s.totalPower, 1)} kW`, s.totalPower))
        }
        if (s.parts !== undefined) {
            stats.push("Production", statValue("Parts", "hash", `${round(s.parts)}`, s.parts))
        }
        if (s.roomTemperature !== undefined) {
            stats.push("Environment", statValue("Room Temperature", "thermometer", `${num(s.roomTemperature, 1)} °C`, s.roomTemperature))
        }
        if (s.roomHumidity !== undefined) {
            stats.push("Environment", statValue("Room Humidity", "droplet", `${num(s.roomHumidity, 1)} %`, s.roomHumidity))
        }

        return {
            name: this.name,
            status: "Ok",
            color: this.color.toHexString(),
            badges: [],
            statGroups: stats.build(),
        }
    }
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
    Telemetry wiring
    */

    /**
     * Mirror a machine's retained `<machine>/status` message onto an entity. Raw
     * messages are interpreted into structured state and recorded on the timeline;
     * the world projects that state back onto the entity, so live and scrubbed
     * views go through the exact same path.
     */
    private bindMachineStatus(entity: Entity, statusTopic: string) {
        const world = entity.world

        world.mqtt.register(statusTopic, (data) => {
            if (typeof data !== "object" || !data) {
                return
            }

            const online = "online" in data && data.online === true
            const running = "running" in data && data.running === true
            const errored = "errored" in data && data.errored === true
            const errorReason =
                errored && "errorReason" in data ? (data["errorReason"] as string) : undefined

            world.recordState(entity.id, { online, running, errored, errorReason })
        })
    }

    /** Mirror a single topic's raw value onto one field of an entity's state. */
    private bindField(world: World, id: string, topic: string, field: string) {
        world.mqtt.register(topic, (data) => {
            world.recordState(id, { [field]: unwrap(data) })
        })
    }

    /** Of the Shelly 3EM's 20 signals, only the total active power is of interest here. */
    private bindEnergy(world: World, id: string, base: string) {
        this.bindField(world, id, `${base}/Total_Active_Power`, "totalPower")
    }

    /*
    Equipment
    */

    private buildPress(floor: Floor, world: World): PressEntity {
        const press = new PressEntity("equipment:php-1250", "PHP 1250", this.findNode("Press 1"), floor, world)

        this.bindMachineStatus(press, `${PHP}/status`)

        this.bindField(world, press.id, `${PHP_A}/Product_Description`, "product")
        this.bindField(world, press.id, `${PHP_A}/Part_Counter`, "parts")
        this.bindField(world, press.id, `${PHP_A}/Pressure`, "pressure")
        this.bindField(world, press.id, `${PHP_A}/Target_Pressure`, "targetPressure")
        this.bindField(world, press.id, `${PHP_A}/Movable_Platen_Position`, "platenPosition")
        this.bindField(world, press.id, `${PHP_A}/Movable_Platen_State`, "platenState")
        this.bindField(world, press.id, `${PHP_A}/Speed`, "platenSpeed")
        this.bindField(world, press.id, `${PHP_A}/Compression_Time`, "compressionTime")
        this.bindField(world, press.id, `${PHP_A}/Target_Time`, "targetTime")
        this.bindField(world, press.id, `${PHP_A}/Total_Time`, "totalTime")
        this.bindField(world, press.id, `${PHP_A}/Remaining_Time`, "remainingTime")

        this.bindField(world, press.id, `${PHP_B}/Fixed_Platen_Temperature_1`, "fixedPlaten1")
        this.bindField(world, press.id, `${PHP_B}/Fixed_Platen_Temperature_1_Setpoint`, "fixedPlaten1Setpoint")
        this.bindField(world, press.id, `${PHP_B}/Fixed_Platen_Temperature_2`, "fixedPlaten2")
        this.bindField(world, press.id, `${PHP_B}/Fixed_Platen_Temperature_2_Setpoint`, "fixedPlaten2Setpoint")
        this.bindField(world, press.id, `${PHP_B}/Movable_Platen_Temperature_1`, "movablePlaten1")
        this.bindField(world, press.id, `${PHP_B}/Movable_Platen_Temperature_1_Setpoint`, "movablePlaten1Setpoint")
        this.bindField(world, press.id, `${PHP_B}/Movable_Platen_Temperature_2`, "movablePlaten2")
        this.bindField(world, press.id, `${PHP_B}/Movable_Platen_Temperature_2_Setpoint`, "movablePlaten2Setpoint")
        this.bindField(world, press.id, `${PHP_B}/Mold_Cavity_Temperature`, "moldCavityTemp")
        this.bindField(world, press.id, `${PHP_B}/Mold_Male_Temperature`, "moldMaleTemp")
        this.bindField(world, press.id, `${PHP_B}/Theoretical_Cycle_Time`, "cycleTime")

        return press
    }

    private buildPaintingLine(floor: Floor, world: World): PaintingLineEntity {
        const line = new PaintingLineEntity(
            "equipment:pintura-classica",
            "Pintura Clássica",
            this.findNode("Painting Hooks"),
            floor,
            world,
        )

        this.bindMachineStatus(line, `${PINTURA}/status`)

        // `Machine_State` and `Downtime` are the two sides of the line running or
        // not, which the status message above already carries — so the signal
        // drives `running` rather than a stat of its own, and only the downtime
        // side is displayed.
        world.mqtt.register(`${PINTURA_PLC}/Machine_State`, (data) => {
            world.recordState(line.id, { running: unwrap(data) === true })
        })

        this.bindField(world, line.id, `${PINTURA_PLC}/Line_Speed`, "lineSpeed")
        this.bindField(world, line.id, `${PINTURA_PLC}/Downtime`, "downtime")
        this.bindField(world, line.id, `${PINTURA_PLC}/Alarm_1`, "alarm1")
        this.bindField(world, line.id, `${PINTURA_PLC}/Alarm_2`, "alarm2")
        this.bindField(world, line.id, `${PINTURA_PLC}/Alarm_3`, "alarm3")

        return line
    }

    private buildBath(floor: Floor, world: World, index: number, role: string, hasPh: boolean): BathEntity {
        const bath = new BathEntity(
            `equipment:bath-${index}`,
            `Bath ${index} (${role})`,
            this.findNode(`Bath ${index}`),
            floor,
            world,
            hasPh,
        )

        this.bindMachineStatus(bath, `${PINTURA}/status`)

        this.bindField(world, bath.id, `${PINTURA_PLC}/Bath_${index}_Temperature`, "temperature")
        this.bindField(world, bath.id, `${PINTURA_PLC}/Bath_${index}_Pressure`, "pressure")
        if (hasPh) {
            this.bindField(world, bath.id, `${PINTURA_PLC}/Bath_${index}_Ph`, "ph")
        }

        return bath
    }

    private buildBooth(floor: Floor, world: World, index: number): BoothEntity {
        const booth = new BoothEntity(
            `equipment:booth-${index}`,
            `Paint Booth ${index}`,
            this.findNode(`Cabin ${index}`),
            floor,
            world,
        )

        this.bindMachineStatus(booth, `${PINTURA}/status`)

        this.bindField(world, booth.id, `${PINTURA_PLC}/Cabin_${index}_Temperature`, "temperature")
        this.bindField(world, booth.id, `${PINTURA_PLC}/Cabin_${index}_Humidity`, "humidity")

        return booth
    }

    private buildDryer(floor: Floor, world: World): DryerEntity {
        const dryer = new DryerEntity("equipment:dryer", "Drying Tunnel", this.findNode("Drying Tunel"), floor, world)

        this.bindMachineStatus(dryer, `${PINTURA}/status`)
        this.bindField(world, dryer.id, `${PINTURA_PLC}/Dryer_Temperature`, "temperature")

        return dryer
    }

    /*

    */

    build(world: World): Building {
        const buildingRootNode = this.result.meshes[0]!

        //

        const building = new Building(world, 'Teijin Leça', buildingRootNode)

        const floor = building.addFloor("Floor 0", this.findNode('Floor'))

        const areaPainting = new AreaEntity('area:painting', 'Painting', this.findMesh('Area 1 - Painting'), floor, world, new Color3(0.96, 0.55, 0.19))
        const areaFactory1 = new AreaEntity('area:factory-1', 'Factory 1', this.findMesh('Area 2 - Factory 1'), floor, world, new Color3(0.23, 0.51, 0.96))
        const areaFactory2 = new AreaEntity('area:factory-2', 'Factory 2', this.findMesh('Area 3 - Factory 2'), floor, world, new Color3(0.34, 0.40, 0.95))
        const areaFactory3 = new AreaEntity('area:factory-3', 'Factory 3', this.findMesh('Area 4 - Factory 3'), floor, world, new Color3(0.55, 0.36, 0.96))
        const areaFactory4 = new AreaEntity('area:factory-4', 'Factory 4', this.findMesh('Area 5 - Factory 4'), floor, world, new Color3(0.06, 0.65, 0.91))
        const areaFactory5 = new AreaEntity('area:factory-5', 'Factory 5', this.findMesh('Area 6 - Factory 5'), floor, world, new Color3(0.02, 0.71, 0.83))
        const areaFacilities = new AreaEntity('area:facilities', 'Facilities', this.findMesh('Area 7 - Facilities'), floor, world, new Color3(0.13, 0.70, 0.47))

        /*
        PHP 1250 — compression molding press, `Press 1` in the Factory 5 hall.
        */

        const press = this.buildPress(floor, world)

        /*
        Pintura Clássica — the hanger conveyor through the pre-treatment baths,
        the drying tunnel and the two paint booths, all in the Painting hall.
        */

        const line = this.buildPaintingLine(floor, world)
        const bath1 = this.buildBath(floor, world, 1, "Degrease", true)
        const bath2 = this.buildBath(floor, world, 2, "Rinse", false)
        const bath3 = this.buildBath(floor, world, 3, "Conversion", false)
        const dryer = this.buildDryer(floor, world)
        const booth1 = this.buildBooth(floor, world, 1)
        const booth2 = this.buildBooth(floor, world, 2)

        /*
        Area state. Neither energy meter is modelled, so each machine's readings
        sit on the area it stands in; the paint room's climate has nowhere better
        to live either.
        */

        this.bindEnergy(world, areaFactory5.id, PHP_ENERGY)
        this.bindField(world, areaFactory5.id, `${PHP_A}/Part_Counter`, "parts")

        this.bindEnergy(world, areaPainting.id, PINTURA_ENERGY)
        this.bindField(world, areaPainting.id, `${PINTURA_PLC}/Paint_Room_Temperature`, "roomTemperature")
        this.bindField(world, areaPainting.id, `${PINTURA_PLC}/Paint_Room_Humidity`, "roomHumidity")

        /*

        */

        world.entityGroups.push(new EntityGroup(world, 'Areas', [
            areaPainting,
            areaFactory1,
            areaFactory2,
            areaFactory3,
            areaFactory4,
            areaFactory5,
            areaFacilities,
        ]))

        world.entityGroups.push(new EntityGroup(world, 'Molding', [
            press,
        ]))

        world.entityGroups.push(new EntityGroup(world, 'Painting', [
            line,
            bath1,
            bath2,
            bath3,
            dryer,
            booth1,
            booth2,
        ]))

        return building
    }

}
