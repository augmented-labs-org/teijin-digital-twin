import { Area } from "@/core/building/area";
import { AbstractMesh, AnimationGroup, Color3, ISceneLoaderAsyncResult, Node, TransformNode } from "@babylonjs/core";
import { Building } from "./core/building/building";
import { EntityGroup, World } from "./core/world";

class SemaphoreLight {

    private nodeOff: Node

    private nodeOn: Node

    private _on = false

    constructor(nodeOff: Node, nodeOn: Node) {
        this.nodeOff = nodeOff
        this.nodeOn = nodeOn

        this.nodeOff.setEnabled(true)
        this.nodeOn.setEnabled(false)
    }

    get on() {
        return this._on
    }

    set on(val: boolean) {
        if (this._on === val) {
            return
        }

        this._on = val

        this.nodeOff.setEnabled(!val)
        this.nodeOn.setEnabled(val)
    }
}

/*

*/

export class ImplBuilder {

    private result: ISceneLoaderAsyncResult

    private nodesByName: Map<string, TransformNode>

    private animationsByName: Map<string, AnimationGroup>

    constructor(result: ISceneLoaderAsyncResult) {
        this.result = result

        this.nodesByName = new Map()

        for (const node of result.transformNodes) {
            this.nodesByName.set(node.name, node)
        }

        for (const node of result.meshes) {
            this.nodesByName.set(node.name, node)
        }

        this.animationsByName = new Map()
        for (const group of result.animationGroups) {
            this.animationsByName.set(group.name, group)
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

    findAnimation(name: string) {
        const group = this.animationsByName.get(name)
        if (!group) {
            throw new Error(`Could not find animation of name '${name}'`)
        }

        return group
    }

    /*

    */


    buildPress({
        area, name, nodeName, greenLightOffNodeName, greenLightOnNodeName, redLightOffNodeName, redLightOnNodeName, animationPressDownName, animationPressUpName, topicPrefix
    }: {
        area: Area,
        name: string,
        nodeName: string,
        greenLightOffNodeName: string,
        greenLightOnNodeName: string,
        redLightOffNodeName: string,
        redLightOnNodeName: string,
        animationPressUpName: string,
        animationPressDownName: string,
        topicPrefix: string
    }) {
        const world = area.world

        const node = this.findNode(nodeName)

        const animationPressDown = this.findAnimation(animationPressDownName)
        animationPressDown.speedRatio = 10.0
        const animationPressUp = this.findAnimation(animationPressUpName)
        animationPressDown.speedRatio = 8.0

        const press = area.addEquipment(name, node);

        const lightGreen = new SemaphoreLight(this.findNode(greenLightOffNodeName), this.findNode(greenLightOnNodeName))
        const lightRed = new SemaphoreLight(this.findNode(redLightOffNodeName), this.findNode(redLightOnNodeName))

        press.stats.push(
            { name: 'Actuation', value: "OFF", icon: "⚙️", topic: `${topicPrefix}/actuation`, format: v => v === true ? 'ON' : 'OFF' },
            { name: 'Force', value: "0 N", icon: "💪", topic: `${topicPrefix}/force`, format: v => `${Math.round(Number(v))} N` }
        )

        // Play an animation from the start, or snap straight to its final pose.
        // Snapping is used when scrubbing/seeking so the press jumps to the sought
        // state instantly instead of animating through the transition.
        const playOrSnap = (group: AnimationGroup, snap: boolean) => {
            group.play(false)
            if (snap) {
                group.goToFrame(group.to)
                group.pause()
            }
        }

        // View side-effects (lights + press animation) react to the equipment's
        // `running` state rather than to raw messages, so they are reproduced
        // identically whether the state changed from live data or from scrubbing
        // history back onto the press. The animation only plays on an actual
        // running transition; other state changes (online/errored) don't retrigger it.
        const setRunningView = (running: boolean, snap: boolean) => {
            if (running) {
                animationPressUp.stop()
                playOrSnap(animationPressDown, snap)
                lightRed.on = false
                lightGreen.on = true
            } else {
                animationPressDown.stop()
                playOrSnap(animationPressUp, snap)
                lightRed.on = true
                lightGreen.on = false
            }
        }

        let lastRunning = press.running
        setRunningView(lastRunning, true)
        press.onStateChanged.add(() => {
            if (press.running === lastRunning) {
                return
            }
            lastRunning = press.running
            setRunningView(press.running, !world.projectionAnimates)
        })

        // Raw broker messages are interpreted into structured state and recorded
        // on the timeline; the world projects the recorded state back onto the
        // press (setting the fields above) for both live and scrubbed views.
        world.mqtt.register(`${topicPrefix}/status`, (data) => {
            if (typeof data !== 'object' || !data) {
                return
            }

            const online = 'online' in data && typeof data.online === 'boolean' && data.online
            const running = 'running' in data && typeof data.running === 'boolean' && data.running
            const errored = 'errored' in data && typeof data.errored === 'boolean' && data.errored
            const errorReason = errored && 'errorReason' in data ? (data['errorReason'] as string) : undefined

            world.recordState(press.key, { online, running, errored, errorReason })
        })

        return press
    }

    /*
    
    */

    build(world: World): Building {
        const buildingRootNode = this.result.meshes[0]!

        //

        const building = new Building(world, 'Factory', buildingRootNode)

        const floor = building.addFloor("Floor 0", this.findNode('Floor 0'))

        const areaEntrance = floor.addArea('Entrance', this.findMesh('Area 1 - Entrance'), Color3.Random());
        const areaWarehouse1 = floor.addArea('Warehouse 1', this.findMesh('Area 2 - Warehouse 1'), Color3.Random());
        const areaWarehouse2 = floor.addArea('Warehouse 2', this.findMesh('Area 3 - Warehouse 2'), Color3.Random());
        const areaFactory = floor.addArea('Factory', this.findMesh('Area 4 - Factory'), Color3.Random());
        const areaLab1 = floor.addArea('Lab 1', this.findMesh('Area 5 - Lab 1'), Color3.Random());
        const areaLab2 = floor.addArea('Lab 2', this.findMesh('Area 6 - Lab 2'), Color3.Random());
        const areaLab3 = floor.addArea('Lab 3', this.findMesh('Area 7 - Lab 3'), Color3.Random());
        const areaDressingRoom = floor.addArea('dressing room', this.findMesh('Area 8 - dressing room'), Color3.Random());
        const areaPantry = floor.addArea('Pantry', this.findMesh('Area 9 - Pantry'), Color3.Random());
        const areaWc1 = floor.addArea('WC 1', this.findMesh('Area 10 - WC 1'), Color3.Random());
        const areaWc2 = floor.addArea('WC 2', this.findMesh('Area 11 - WC 2'), Color3.Random());
        const areaOffice1 = floor.addArea('Office 1', this.findMesh('Area 12 - Office 1'), Color3.Random());
        const areaOffice2 = floor.addArea('Office 2', this.findMesh('Area 13 - Office 2'), Color3.Random());
        const areaOffice3 = floor.addArea('Office 3', this.findMesh('Area 14 - Office 3'), Color3.Random());
        const areaOffice4 = floor.addArea('Office 4', this.findMesh('Area 15 - Office 4'), Color3.Random());

        const equipmentPaintingMachine = areaFactory.addEquipment('Paining Machine', this.findNode('Painting machine'))
        equipmentPaintingMachine.stats.push(
            { name: 'Color', value: "Red", icon: "🖌️", topic: `factory/floor-0/factory/equipments/painter/color` },
            { name: "Temperature (Bath 1)", value: "24°C", icon: "🌡️", topic: "factory/floor-0/factory/equipments/painter/temperature0", format: v => `${round(v)}°C` },
            { name: "Temperature (Bath 2)", value: "24°C", icon: "🌡️", topic: "factory/floor-0/factory/equipments/painter/temperature1", format: v => `${round(v)}°C` },
            { name: "Temperature (Bath 3)", value: "24°C", icon: "🌡️", topic: "factory/floor-0/factory/equipments/painter/temperature2", format: v => `${round(v)}°C` },
        )

        const equipmentPresses = [0, 1, 2, 3, 4].map(i => {
            const suffix = i === 0 ? '' : `.00${i}`
            
            return this.buildPress({
                area: areaFactory,
                name: `Press 0${i + 1}`,
                nodeName: `Press${suffix}`,
                greenLightOffNodeName: `Green light Off${suffix}`,
                greenLightOnNodeName: `Green light On${suffix}`,
                redLightOffNodeName: `Red light Off${suffix}`,
                redLightOnNodeName: `Red light On${suffix}`,
                animationPressUpName: `Press up${suffix}`,
                animationPressDownName: `Press Down${suffix}`,
                topicPrefix: `factory/floor-0/factory/equipments/press${i}`,
            })
        })

        // Stats shown in each area's detail card, driven live from the Coreflux
        // broker. `topic` matches what tools/factory.py publishes; `format` maps
        // the raw sensor value to the displayed string.
        const round = (v: unknown) => Math.round(Number(v))
        const oneDp = (v: unknown) => Number(v).toFixed(1)
        const airQuality = (v: unknown) => {
            const pm25 = Number(v)
            return pm25 < 12 ? "Good" : pm25 < 35 ? "Moderate" : "Poor"
        }

        areaFactory.stats.push(
            { name: "Temperature", value: "24°C", icon: "🌡️", topic: "factory/floor-0/factory/temperature", format: v => `${round(v)}°C` },
            { name: "Power", value: "12 kW", icon: "⚡", topic: "factory/floor-0/factory/power", format: v => `${oneDp(v)} kW` },
            { name: "Output", value: "320/h", icon: "📦", topic: "factory/floor-0/factory/output", format: v => `${round(v)}/h` },
        )
        areaWarehouse1.stats.push(
            { name: "Capacity", value: "78%", icon: "📦", topic: "factory/floor-0/warehouse-1/capacity", format: v => `${round(v)}%` },
            { name: "Humidity", value: "45%", icon: "💧", topic: "factory/floor-0/warehouse-1/humidity", format: v => `${round(v)}%` },
        )
        areaLab1.stats.push(
            { name: "Temperature", value: "21°C", icon: "🌡️", topic: "factory/floor-0/lab-1/temperature", format: v => `${round(v)}°C` },
            { name: "Air Quality", value: "Good", icon: "🧪", topic: "factory/floor-0/lab-1/air_quality_pm25", format: airQuality },
        )

        /*
     
        */

        world.entityGroups.push(new EntityGroup(world, 'Areas', [
            areaEntrance,
            areaWarehouse1,
            areaWarehouse2,
            areaFactory,
            areaLab1,
            areaLab2,
            areaLab3,
            areaDressingRoom,
            areaPantry,
            areaWc1,
            areaWc2,
            areaOffice1,
            areaOffice2,
            areaOffice3,
            areaOffice4
        ]))

        world.entityGroups.push(new EntityGroup(world, 'Factory', [
            ...equipmentPresses,
            equipmentPaintingMachine
        ]))

        return building
    }

}