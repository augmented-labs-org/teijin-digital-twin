import { AbstractMesh, Node, TransformNode } from "@babylonjs/core"

interface BuildingEquipmentInit {
    name: string
    node: TransformNode
    online?: boolean
    running?: boolean
    errored?: boolean
    errorReason?: string
}

export class BuildingEquipment {
    readonly room: BuildingRoom
    name: string
    node: TransformNode
    online: boolean
    running: boolean
    errored: boolean
    errorReason?: string

    constructor(room: BuildingRoom, params: BuildingEquipmentInit) {
        this.room = room
        this.name = params.name
        this.node = params.node
        this.online = params.online ?? false
        this.running = params.running ?? false
        this.errored = params.errored ?? false
        this.errorReason = params.errorReason
    }

    get floor(): BuildingFloor {
        return this.room.floor
    }

    get building(): Building {
        return this.room.building
    }

    get active() {
        return this.room.active
    }
}

/*

*/

export class BuildingRoom {

    readonly floor: BuildingFloor
    readonly equipments: BuildingEquipment[] = []

    name: string
    node: AbstractMesh

    constructor(floor: BuildingFloor, name: string, node: AbstractMesh) {
        this.floor = floor
        this.name = name
        this.node = node
    }

    get building(): Building {
        return this.floor.building
    }

    addEquipment(params: BuildingEquipmentInit): BuildingEquipment {
        const equipment = new BuildingEquipment(this, params)
        this.equipments.push(equipment)
        return equipment
    }

    /*

    */

    get active() {
        return this.floor.active
    }
}

/*

*/


export class BuildingFloor {
    readonly building: Building
    readonly floor: number
    readonly name: string
    readonly node: Node
    readonly rooms: BuildingRoom[] = []

    constructor(building: Building, floor: number, name: string, node: Node) {
        this.building = building
        this.floor = floor
        this.name = name
        this.node = node
    }

    addRoom(name: string, node: AbstractMesh): BuildingRoom {
        const room = new BuildingRoom(this, name, node)
        this.rooms.push(room)
        return room
    }

    /*
    
    */

    get active() {
        return this.building.active && this.floor <= this.building.activeFloor
    }
}

/*

*/

export class Building {
    readonly floors: BuildingFloor[] = []
    readonly name: string
    readonly rootNode: AbstractMesh

    /// Indicates if the building is currently active in the user-interface
    active: boolean = false

    /// Indicates which floor is currently active in the user-interface. Floors below are also considered active
    activeFloor: number = 0

    constructor(name: string, rootNode: AbstractMesh) {
        this.name = name
        this.rootNode = rootNode
    }

    addFloor(name: string, node: Node): BuildingFloor {
        const floor = new BuildingFloor(this, this.floors.length, name, node)
        this.floors.push(floor)
        return floor
    }
}