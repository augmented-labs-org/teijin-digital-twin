import { AbstractMesh, Color3, ISceneLoaderAsyncResult, TransformNode } from "@babylonjs/core"
import { Area } from "./core/building/area"
import { Building } from "./core/building/building"
import { Entity, EntityStat } from "./core/building/entity"
import { EntityGroup, World } from "./core/world"
import type { StatIcon } from "./core/utils/icons"

/*
Teijin Leça — the site simulated by `tools/teijin.py`.

Two machines publish under `teijin/leca/<machine>/<source>/<Signal_Name>`, one
sweep per second, 106 signals in total:

    php-1250          plc-a (11) · plc-b (11) · energy (20)
    pintura-classica  plc (44)  · energy (20)

Every one of those signals is wired below. Payloads are `{value, unit, ts}` — the
world unwraps `.value` before handing it to a stat's `format`, so only the raw
value is dealt with here.

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
    sit on the stats of the area their machine is in, as does the paint room
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

    /**
     * Push a stat whose displayed value is composed from several topics. `topics`
     * maps a key to a topic, and the **first** entry is the primary reading:
     * messages on it re-render the row and record it on the timeline, while the
     * others only refresh the values they contribute. That suits the shape of
     * this PLC's data — configuration limits and recipe setpoints are constants
     * republished every sweep, so they deserve neither a row of their own nor a
     * timeline sample of their own.
     *
     * The stat carries no `topic`, so the world doesn't subscribe it a second
     * time; the rendered string still reaches the scene through the normal
     * record → project path, exactly like a single-topic stat.
     */
    private addCompositeStat(
        entity: Entity,
        spec: {
            name: string
            icon: StatIcon
            group: string
            topics: Record<string, string>
            render: (values: Record<string, unknown>) => string
        },
    ) {
        const world = entity.world
        const values: Record<string, unknown> = {}

        const stat: EntityStat = { name: spec.name, icon: spec.icon, group: spec.group, value: NO_VALUE }
        entity.stats.push(stat)

        const [primary] = Object.keys(spec.topics)

        for (const [key, topic] of Object.entries(spec.topics)) {
            world.mqtt.register(topic, (data) => {
                values[key] = unwrap(data)

                if (key === primary) {
                    world.recordState(entity.id, { stats: { [spec.name]: spec.render(values) } })
                }
            })
        }
    }

    /** A simple single-topic reading, e.g. 🌡️ Temperature 23.4 °C. */
    private addGaugeStat(
        entity: Entity,
        spec: { name: string; icon: StatIcon; group: string; topic: string; unit: string; digits?: number },
    ) {
        entity.stats.push({
            name: spec.name,
            value: NO_VALUE,
            icon: spec.icon,
            group: spec.group,
            topic: spec.topic,
            format: (v) => `${num(v, spec.digits ?? 1)} ${spec.unit}`,
        })
    }

    /**
     * A reading published alongside the setpoint it is tracking, shown as
     * `147.2 °C → 148`.
     */
    private addSetpointStat(
        entity: Entity,
        spec: {
            name: string
            icon: StatIcon
            group: string
            topic: string
            setpointTopic: string
            unit: string
            digits?: number
        },
    ) {
        this.addCompositeStat(entity, {
            name: spec.name,
            icon: spec.icon,
            group: spec.group,
            topics: { value: spec.topic, setpoint: spec.setpointTopic },
            render: (v) => {
                const reading = `${num(v.value, spec.digits ?? 1)} ${spec.unit}`
                return v.setpoint === undefined ? reading : `${reading} → ${trim(v.setpoint)}`
            },
        })
    }

    /**
     * Of the Shelly 3EM's 20 signals, only the total active power is of
     * interest here. The meters aren't in the model, so it goes onto the area
     * whose machine it meters.
     */
    private addEnergyStats(entity: Entity, base: string) {
        entity.stats.push({
            name: "Total Power",
            value: NO_VALUE,
            icon: "zap",
            group: "Power",
            topic: `${base}/Total_Active_Power`,
            format: (v) => `${num(v, 1)} kW`,
        })
    }

    /*
    Equipment
    */

    /**
     * The compression press: `plc-a` — the molding cycle, what is being made and
     * where the platen is — followed by `plc-b`, a second PLC on the same machine
     * carrying the heated tooling (four platen zones tracking their recipe
     * setpoints, plus the two mold thermocouples that dip when a cold charge is
     * laid on the open mold).
     */
    private buildPress(area: Area) {
        const press = area.addEquipment("equipment:php-1250", "PHP 1250", this.findNode("Press 1"))

        this.bindMachineStatus(press, `${PHP}/status`)

        press.stats.push(
            { name: "Product", value: NO_VALUE, icon: "tag", group: "Production", topic: `${PHP_A}/Product_Description` },
            {
                name: "Parts",
                value: NO_VALUE,
                icon: "hash",
                group: "Production",
                topic: `${PHP_A}/Part_Counter`,
                format: (v) => `${round(v)}`,
            },
        )

        this.addSetpointStat(press, {
            name: "Pressure",
            icon: "gauge",
            group: "Production",
            topic: `${PHP_A}/Pressure`,
            setpointTopic: `${PHP_A}/Target_Pressure`,
            unit: "bar",
        })

        press.stats.push(
            {
                name: "Platen",
                value: NO_VALUE,
                icon: "ruler",
                group: "Production",
                topic: `${PHP_A}/Movable_Platen_Position`,
                format: (v) => `${num(v, 0)} mm`,
            },
            {
                name: "Platen State",
                value: NO_VALUE,
                icon: "settings",
                group: "Production",
                topic: `${PHP_A}/Movable_Platen_State`,
                format: (v) => PLATEN_STATES[round(v)] ?? NO_VALUE,
            },
            {
                name: "Platen Speed",
                value: NO_VALUE,
                icon: "move",
                group: "Production",
                topic: `${PHP_A}/Speed`,
                format: (v) => `${num(v, 1)} mm/s`,
            },
        )

        this.addSetpointStat(press, {
            name: "Compression",
            icon: "timer",
            group: "Production",
            topic: `${PHP_A}/Compression_Time`,
            setpointTopic: `${PHP_A}/Target_Time`,
            unit: "s",
        })

        press.stats.push(
            {
                name: "Elapsed",
                value: NO_VALUE,
                icon: "clock",
                group: "Production",
                topic: `${PHP_A}/Total_Time`,
                format: (v) => `${num(v, 1)} s`,
            },
            {
                name: "Remaining",
                value: NO_VALUE,
                icon: "hourglass",
                group: "Production",
                topic: `${PHP_A}/Remaining_Time`,
                format: (v) => `${num(v, 1)} s`,
            },
        )

        for (const platen of ["Fixed", "Movable"] as const) {
            for (const zone of [1, 2]) {
                this.addSetpointStat(press, {
                    name: `${platen} Platen ${zone}`,
                    icon: "thermometer",
                    group: "Production",
                    topic: `${PHP_B}/${platen}_Platen_Temperature_${zone}`,
                    setpointTopic: `${PHP_B}/${platen}_Platen_Temperature_${zone}_Setpoint`,
                    unit: "°C",
                })
            }
        }

        press.stats.push(
            {
                name: "Mold Cavity",
                value: NO_VALUE,
                icon: "thermometer",
                group: "Production",
                topic: `${PHP_B}/Mold_Cavity_Temperature`,
                format: (v) => `${num(v, 1)} °C`,
            },
            {
                name: "Mold Male",
                value: NO_VALUE,
                icon: "thermometer",
                group: "Production",
                topic: `${PHP_B}/Mold_Male_Temperature`,
                format: (v) => `${num(v, 1)} °C`,
            },
            {
                name: "Cycle Time",
                value: NO_VALUE,
                icon: "timer",
                group: "Production",
                topic: `${PHP_B}/Theoretical_Cycle_Time`,
                format: (v) => `${num(v, 0)} s`,
            },
        )

        return press
    }

    /**
     * The painting line's own signals — the hanger conveyor's speed, the downtime
     * flag and the three alarm words. Anchored to the conveyor, since the baths,
     * tunnel and booths it runs through are equipment in their own right.
     */
    private buildPaintingLine(area: Area) {
        const line = area.addEquipment(
            "equipment:pintura-classica",
            "Pintura Clássica",
            this.findNode("Painting Hooks"),
        )
        const world = line.world

        this.bindMachineStatus(line, `${PINTURA}/status`)

        // `Machine_State` and `Downtime` are the two sides of the line running or
        // not, which the status message above already carries — so the signal
        // drives `running` rather than a row of its own, and only the downtime
        // side is displayed.
        world.mqtt.register(`${PINTURA_PLC}/Machine_State`, (data) => {
            world.recordState(line.id, { running: unwrap(data) === true })
        })

        line.stats.push(
            {
                name: "Line Speed",
                value: NO_VALUE,
                icon: "move",
                group: "Production",
                topic: `${PINTURA_PLC}/Line_Speed`,
                format: (v) => `${num(v, 2)} m/min`,
            },
            {
                name: "Downtime",
                value: NO_VALUE,
                icon: "ban",
                group: "Production",
                topic: `${PINTURA_PLC}/Downtime`,
                format: yesNo,
            },
            {
                name: "Alarm 1",
                value: NO_VALUE,
                icon: "siren",
                group: "Production",
                topic: `${PINTURA_PLC}/Alarm_1`,
                format: alarm,
            },
            {
                name: "Alarm 2",
                value: NO_VALUE,
                icon: "siren",
                group: "Production",
                topic: `${PINTURA_PLC}/Alarm_2`,
                format: alarm,
            },
            {
                name: "Alarm 3",
                value: NO_VALUE,
                icon: "siren",
                group: "Production",
                topic: `${PINTURA_PLC}/Alarm_3`,
                format: alarm,
            },
        )

        return line
    }

    /**
     * A pre-treatment bath: temperature and pressure, each shown against the
     * Min/Max band the PLC publishes beside it — the same band `Alarm_2` on the
     * line is derived from. Bath 1 is the alkaline degrease, so it also carries
     * the pH probe.
     */
    private buildBath(area: Area, index: number, role: string, hasPh: boolean) {
        const bath = area.addEquipment(
            `equipment:bath-${index}`,
            `Bath ${index} (${role})`,
            this.findNode(`Bath ${index}`),
        )

        this.bindMachineStatus(bath, `${PINTURA}/status`)

        this.addGaugeStat(bath, {
            name: "Temperature",
            icon: "thermometer",
            group: "Environment",
            topic: `${PINTURA_PLC}/Bath_${index}_Temperature`,
            unit: "°C",
        })
        this.addGaugeStat(bath, {
            name: "Pressure",
            icon: "gauge",
            group: "Environment",
            topic: `${PINTURA_PLC}/Bath_${index}_Pressure`,
            unit: "bar",
            digits: 2,
        })

        if (hasPh) {
            bath.stats.push({
                name: "pH",
                value: NO_VALUE,
                icon: "test-tube",
                group: "Environment",
                topic: `${PINTURA_PLC}/Bath_${index}_Ph`,
                format: (v) => num(v, 2),
            })
        }

        return bath
    }

    /**
     * A paint booth (`Cabin N` in the model, `Cabin_N_*` on the PLC): climate
     * controlled, so both readings come with a band.
     */
    private buildBooth(area: Area, index: number) {
        const booth = area.addEquipment(
            `equipment:booth-${index}`,
            `Paint Booth ${index}`,
            this.findNode(`Cabin ${index}`),
        )

        this.bindMachineStatus(booth, `${PINTURA}/status`)

        this.addGaugeStat(booth, {
            name: "Temperature",
            icon: "thermometer",
            group: "Environment",
            topic: `${PINTURA_PLC}/Cabin_${index}_Temperature`,
            unit: "°C",
        })
        this.addGaugeStat(booth, {
            name: "Humidity",
            icon: "droplet",
            group: "Environment",
            topic: `${PINTURA_PLC}/Cabin_${index}_Humidity`,
            unit: "%",
        })

        return booth
    }

    /*

    */

    build(world: World): Building {
        const buildingRootNode = this.result.meshes[0]!

        //

        const building = new Building(world, 'Teijin Leça', buildingRootNode)

        const floor = building.addFloor("Floor 0", this.findNode('Floor'))

        const areaPainting = floor.addArea('area:painting', 'Painting', this.findMesh('Area 1 - Painting'), new Color3(0.96, 0.55, 0.19));
        const areaFactory1 = floor.addArea('area:factory-1', 'Factory 1', this.findMesh('Area 2 - Factory 1'), new Color3(0.23, 0.51, 0.96));
        const areaFactory2 = floor.addArea('area:factory-2', 'Factory 2', this.findMesh('Area 3 - Factory 2'), new Color3(0.34, 0.40, 0.95));
        const areaFactory3 = floor.addArea('area:factory-3', 'Factory 3', this.findMesh('Area 4 - Factory 3'), new Color3(0.55, 0.36, 0.96));
        const areaFactory4 = floor.addArea('area:factory-4', 'Factory 4', this.findMesh('Area 5 - Factory 4'), new Color3(0.06, 0.65, 0.91));
        const areaFactory5 = floor.addArea('area:factory-5', 'Factory 5', this.findMesh('Area 6 - Factory 5'), new Color3(0.02, 0.71, 0.83));
        const areaFacilities = floor.addArea('area:facilities', 'Facilities', this.findMesh('Area 7 - Facilities'), new Color3(0.13, 0.70, 0.47));

        /*
        PHP 1250 — compression molding press, `Press 1` in the Factory 5 hall.
        */

        const press = this.buildPress(areaFactory5)

        /*
        Pintura Clássica — the hanger conveyor through the pre-treatment baths,
        the drying tunnel and the two paint booths, all in the Painting hall.
        */

        const line = this.buildPaintingLine(areaPainting)
        const bath1 = this.buildBath(areaPainting, 1, "Degrease", true)
        const bath2 = this.buildBath(areaPainting, 2, "Rinse", false)
        const bath3 = this.buildBath(areaPainting, 3, "Conversion", false)

        const dryer = areaPainting.addEquipment(
            "equipment:dryer",
            "Drying Tunnel",
            this.findNode("Drying Tunel"),
        )
        this.bindMachineStatus(dryer, `${PINTURA}/status`)
        dryer.stats.push({
            name: "Temperature",
            value: NO_VALUE,
            icon: "flame",
            group: "Environment",
            topic: `${PINTURA_PLC}/Dryer_Temperature`,
            format: (v) => `${num(v, 1)} °C`,
        })

        const booth1 = this.buildBooth(areaPainting, 1)
        const booth2 = this.buildBooth(areaPainting, 2)

        /*
        Area stats. Neither energy meter is modelled, so each machine's readings
        sit on the area it stands in; the paint room's climate has nowhere better
        to live either.
        */

        this.addEnergyStats(areaFactory5, PHP_ENERGY)
        areaFactory5.stats.push({
            name: "Parts",
            value: NO_VALUE,
            icon: "hash",
            group: "Production",
            topic: `${PHP_A}/Part_Counter`,
            format: (v) => `${round(v)}`,
        })

        this.addEnergyStats(areaPainting, PINTURA_ENERGY)
        this.addGaugeStat(areaPainting, {
            name: "Room Temperature",
            icon: "thermometer",
            group: "Environment",
            topic: `${PINTURA_PLC}/Paint_Room_Temperature`,
            unit: "°C",
        })
        this.addGaugeStat(areaPainting, {
            name: "Room Humidity",
            icon: "droplet",
            group: "Environment",
            topic: `${PINTURA_PLC}/Paint_Room_Humidity`,
            unit: "%",
        })

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
