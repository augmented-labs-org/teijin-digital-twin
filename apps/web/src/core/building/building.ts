import { AbstractMesh, Color3, Node } from "@babylonjs/core"
import { World } from "../world"
import { Area } from "./area"

/*

*/

export class Floor {
    readonly building: Building
    readonly floor: number
    readonly name: string
    readonly node: Node
    readonly areas: Area[] = []

    constructor(building: Building, floor: number, name: string, node: Node) {
        this.building = building
        this.floor = floor
        this.name = name
        this.node = node
    }

    addArea(id: string, name: string, node: AbstractMesh, color?: Color3): Area {
        const area = new Area(id, this, name, node, color ?? Color3.Red())
        this.areas.push(area)
        return area
    }
}

/*

*/

export class Building {
    readonly world: World
    readonly floors: Floor[] = []
    readonly name: string
    readonly rootNode: AbstractMesh

    /// Indicates if the building is currently focused in the user-interface
    focused: boolean = false

    /// Indicates which floor is currently active in the user-interface. Floors below are also considered active
    activeFloor: number = 0

    constructor(world: World, name: string, rootNode: AbstractMesh) {
        this.world = world
        this.name = name
        this.rootNode = rootNode
    }

    addFloor(name: string, node: Node): Floor {
        const floor = new Floor(this, this.floors.length, name, node)
        this.floors.push(floor)
        return floor
    }
}
