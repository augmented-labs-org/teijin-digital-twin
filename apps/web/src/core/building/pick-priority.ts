import { AbstractMesh, Matrix, Nullable, PickingCustomization, PickingInfo, Ray, TrianglePickingPredicate } from "@babylonjs/core"

/**
 * Pointer-pick priority, stored on `mesh.metadata.pickPriority`.
 *
 * Babylon normally resolves a pointer to the *closest* mesh under the cursor.
 * That is wrong here: an equipment sits inside a room whose (transparent)
 * bounds mesh is nearer the camera, so the room would always win. Priority lets
 * a higher-ranked mesh win regardless of depth — think of it as a pick z-index.
 */
export const PICK_PRIORITY = {
    /** Anything without an explicit priority (walls, floor, ground). */
    NONE: 0,
    ROOM: 1,
    EQUIPMENT: 2,
} as const

/** Priority a mesh participates in picking with; unmarked meshes are {@link PICK_PRIORITY.NONE}. */
export function pickPriorityOf(mesh: Nullable<AbstractMesh>): number {
    return mesh?.metadata?.pickPriority ?? PICK_PRIORITY.NONE
}

/** Tag meshes with a pick priority. */
export function setPickPriority(meshes: Iterable<AbstractMesh>, priority: number) {
    for (const mesh of meshes) {
        mesh.metadata = { ...mesh.metadata, pickPriority: priority }
    }
}

/**
 * Make Babylon resolve picks by priority instead of raw depth, process-wide.
 *
 * This swaps the per-mesh picker Babylon runs inside its single pick pass (used
 * by every pointer down/up/move and by scene.pick), so it costs no extra
 * raycast — it only changes the "is this hit better than the best so far?"
 * test: a higher {@link pickPriorityOf} wins outright, and equal priorities
 * fall back to nearest, i.e. Babylon's original behaviour. Meshes without a
 * priority are all {@link PICK_PRIORITY.NONE}, so unmarked scenes are unchanged.
 *
 * Idempotent; safe to call once at startup.
 */
export function installPriorityPicking() {
    const priorityPicker = (
        best: Nullable<PickingInfo>,
        rayFor: (world: Matrix, enableDistantPicking: boolean) => Ray,
        mesh: AbstractMesh,
        world: Matrix,
        fastCheck?: boolean,
        onlyBoundingInfo?: boolean,
        trianglePredicate?: TrianglePickingPredicate,
        skipBoundingInfo?: boolean,
    ): Nullable<PickingInfo> => {
        const ray = rayFor(world, mesh.enableDistantPicking)
        const hit = mesh.intersects(ray, fastCheck, trianglePredicate, onlyBoundingInfo, world, skipBoundingInfo)
        if (!hit.hit) {
            return null
        }

        // fastCheck / bounding pre-pass: no accumulated best to compare against.
        if (fastCheck || !best) {
            return hit
        }

        const bestPriority = pickPriorityOf(best.pickedMesh)
        const hitPriority = pickPriorityOf(mesh)
        if (hitPriority < bestPriority) {
            return null
        }
        if (hitPriority === bestPriority && hit.distance >= best.distance) {
            return null
        }
        return hit
    }

    PickingCustomization.internalPickerForMesh = priorityPicker as typeof PickingCustomization.internalPickerForMesh
}
