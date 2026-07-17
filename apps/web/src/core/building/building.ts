import { AbstractMesh, Node } from "@babylonjs/core"

export type BuildingFloor = {
    name: string,
    node: Node
}

export type Building = {
    name: string
    floors: BuildingFloor[],
    rootNode: AbstractMesh
}