import { AbstractMesh, Node, Vector3 } from "@babylonjs/core"
import { World } from "../world"

/*

*/

export class Floor {
    readonly building: Building
    readonly floor: number
    readonly name: string
    readonly node: Node

    constructor(building: Building, floor: number, name: string, node: Node) {
        this.building = building
        this.floor = floor
        this.name = name
        this.node = node
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

    public readonly boundsMin: Vector3
    public readonly boundsMax: Vector3

    constructor(world: World, name: string, rootNode: AbstractMesh) {
        this.world = world
        this.name = name
        
        this.rootNode = rootNode
        
        const bounds = this.rootNode.getHierarchyBoundingVectors(true)
        this.boundsMin = bounds.min
        this.boundsMax = bounds.max
    }

    addFloor(name: string, node: Node): Floor {
        const floor = new Floor(this, this.floors.length, name, node)
        this.floors.push(floor)
        return floor
    }
}
