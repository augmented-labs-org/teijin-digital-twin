import { AbstractMesh, Matrix, Vector3 } from "@babylonjs/core"

export interface LocalBounds {
    min: Vector3
    max: Vector3
}

/**
 * Computes the bounding box of `root` (and, by default, its descendant meshes) expressed in `root`'s
 * local space. Unlike transforming the corners of a world-space AABB, this handles rotated hierarchies
 * correctly by re-deriving the box from each mesh's own local geometry.
 */
export function getLocalBoundingBox(root: AbstractMesh, includeDescendants = true): LocalBounds {
    const meshes = includeDescendants ? [root, ...root.getChildMeshes(false)] : [root]
    const rootWorldInv = Matrix.Invert(root.getWorldMatrix())

    const min = new Vector3(Infinity, Infinity, Infinity)
    const max = new Vector3(-Infinity, -Infinity, -Infinity)

    for (const mesh of meshes) {
        const relativeMatrix = mesh.getWorldMatrix().multiply(rootWorldInv)

        for (const corner of mesh.getBoundingInfo().boundingBox.vectors) {
            const transformed = Vector3.TransformCoordinates(corner, relativeMatrix)
            min.minimizeInPlace(transformed)
            max.maximizeInPlace(transformed)
        }
    }

    return { min, max }
}
