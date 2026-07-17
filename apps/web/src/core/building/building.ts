import { AbstractMesh, Node } from "@babylonjs/core"

export type BuildingFloor = {
    name: string,
    node: Node
}

export type Building = {
    name: string
    floors: BuildingFloor[],
    rootNode: AbstractMesh
    /** Index of the topmost visible floor; floors above it are hidden. */
    visibleFloor: number
}