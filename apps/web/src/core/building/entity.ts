import { Node } from "@babylonjs/core";

export abstract class Entity<N extends Node> {

    // The name of the entity
    readonly name: string;

    // The node that this entity represents
    readonly node: N;

    /*

    */

    constructor(name: string, node: N) {
        this.name = name;
        this.node = node
    }

    /*

    */

    buildTag() {

    }

}