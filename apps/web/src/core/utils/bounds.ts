import { AbstractMesh, Matrix, TransformNode, Vector3, VertexBuffer } from "@babylonjs/core"

export interface LocalBounds {
    min: Vector3
    max: Vector3
}

/** `root` and, by default, its descendant meshes, expressed in `root`'s local space. */
function collectLocalMeshes(root: TransformNode, includeDescendants: boolean): AbstractMesh[] {
    const meshes: AbstractMesh[] = []

    if (root instanceof AbstractMesh) {
        meshes.push(root)
    }

    if (includeDescendants) {
        meshes.push(...root.getChildMeshes(false))
    }

    return meshes
}

/**
 * Computes the bounding box of `root` (and, by default, its descendant meshes) expressed in `root`'s
 * local space. Unlike transforming the corners of a world-space AABB, this handles rotated hierarchies
 * correctly by re-deriving the box from each mesh's own local geometry.
 */
export function getLocalBoundingBox(root: TransformNode, includeDescendants = true): LocalBounds {
    const meshes = collectLocalMeshes(root, includeDescendants)
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

/**
 * Computes the area-weighted centroid of `root`'s (and, by default, its descendant meshes')
 * triangles, expressed in `root`'s local space. Unlike a bounding-box center, this follows where
 * the geometry actually sits — an L-shaped or lopsided mesh gets a tag anchored over its mass
 * rather than over the empty middle of its box.
 */
export function getLocalCenterOfMass(root: TransformNode, includeDescendants = true): Vector3 {
    const meshes = collectLocalMeshes(root, includeDescendants)
    const rootWorldInv = Matrix.Invert(root.getWorldMatrix())

    const weightedSum = new Vector3(0, 0, 0)
    let totalArea = 0

    for (const mesh of meshes) {
        const positions = mesh.getVerticesData(VertexBuffer.PositionKind)
        const indices = mesh.getIndices()
        if (!positions || !indices) {
            continue
        }

        const relativeMatrix = mesh.getWorldMatrix().multiply(rootWorldInv)

        const a = new Vector3()
        const b = new Vector3()
        const c = new Vector3()

        for (let i = 0; i < indices.length; i += 3) {
            const i0 = indices[i]!
            const i1 = indices[i + 1]!
            const i2 = indices[i + 2]!
            Vector3.FromArrayToRef(positions, i0 * 3, a)
            Vector3.FromArrayToRef(positions, i1 * 3, b)
            Vector3.FromArrayToRef(positions, i2 * 3, c)
            Vector3.TransformCoordinatesToRef(a, relativeMatrix, a)
            Vector3.TransformCoordinatesToRef(b, relativeMatrix, b)
            Vector3.TransformCoordinatesToRef(c, relativeMatrix, c)

            const area = Vector3.Cross(b.subtract(a), c.subtract(a)).length() / 2
            const centroid = a.add(b).add(c).scaleInPlace(1 / 3)

            weightedSum.addInPlace(centroid.scaleInPlace(area))
            totalArea += area
        }
    }

    if (totalArea === 0) {
        const bounds = getLocalBoundingBox(root, includeDescendants)
        return bounds.min.add(bounds.max).scaleInPlace(0.5)
    }

    return weightedSum.scaleInPlace(1 / totalArea)
}
