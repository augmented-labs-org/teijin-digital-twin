import { AbstractMesh, Node } from "@babylonjs/core"

export type BuildingEquipment = {
    name: string,
    node: Node,

    online: boolean,

    running: boolean,

    errored: boolean,
    errorReason?: string
}

export type BuildingRoom = {
    name: string,
    node: AbstractMesh,
    equipments: BuildingEquipment[]
}

export type BuildingFloor = {
    name: string,
    node: Node,
    rooms: BuildingRoom[]
}

export type Building = {
    name: string
    floors: BuildingFloor[],
    rootNode: AbstractMesh
    /** Index of the topmost visible floor; floors above it are hidden. */
    visibleFloor: number
}