import argparse
import os
import sys
from pygltflib import GLTF2

def format_bytes(size_in_bytes: int) -> str:
    """Helper to convert bytes into human-readable format."""
    for unit in ['B', 'KB', 'MB', 'GB']:
        if size_in_bytes < 1024.0:
            return f"{size_in_bytes:.2f} {unit}"
        size_in_bytes /= 1024.0
    return f"{size_in_bytes:.2f} TB"

def analyze_gltf(file_path: str, top_n: int = 10, sort_by: str = "vertices"):
    if not os.path.exists(file_path):
        print(f"Error: File '{file_path}' not found.", file=sys.stderr)
        sys.exit(1)

    print(f"Loading '{file_path}'...")
    gltf = GLTF2.load(file_path)

    if not gltf.meshes:
        print("No meshes found in this glTF file.")
        return

    mesh_stats = []

    for idx, mesh in enumerate(gltf.meshes):
        mesh_name = mesh.name if mesh.name else f"Mesh_{idx}"
        total_vertices = 0
        used_buffer_views = set()

        for primitive in mesh.primitives:
            # 1. Count Vertices (via POSITION attribute accessor)
            # Attributes can be accessed via dict or object properties
            pos_accessor_idx = getattr(primitive.attributes, "POSITION", None)
            if pos_accessor_idx is not None:
                pos_accessor = gltf.accessors[pos_accessor_idx]
                total_vertices += pos_accessor.count

            # 2. Collect BufferViews used by attributes (Positions, Normals, UVs, etc.)
            attr_dict = primitive.attributes.__dict__
            for attr_name, accessor_idx in attr_dict.items():
                if accessor_idx is not None and not attr_name.startswith("_"):
                    accessor = gltf.accessors[accessor_idx]
                    if accessor.bufferView is not None:
                        used_buffer_views.add(accessor.bufferView)

            # 3. Collect BufferViews used by indices
            if primitive.indices is not None:
                idx_accessor = gltf.accessors[primitive.indices]
                if idx_accessor.bufferView is not None:
                    used_buffer_views.add(idx_accessor.bufferView)

        # Sum total byte lengths for all unique bufferViews used by this mesh
        total_bytes = sum(gltf.bufferViews[bv_idx].byteLength for bv_idx in used_buffer_views)

        mesh_stats.append({
            "index": idx,
            "name": mesh_name,
            "vertices": total_vertices,
            "bytes": total_bytes,
            "primitives": len(mesh.primitives)
        })

    # Sort results
    sort_key = "vertices" if sort_by == "vertices" else "bytes"
    sorted_meshes = sorted(mesh_stats, key=lambda x: x[sort_key], reverse=True)

    # Print Summary Table
    print(f"\n{'='*75}")
    print(f" Top {min(top_n, len(sorted_meshes))} Biggest Meshes (Sorted by {sort_key.capitalize()})")
    print(f"{'='*75}")
    print(f"{'Rank':<5} {'Index':<6} {'Name':<28} {'Vertices':<12} {'Buffer Size':<12} {'Prims':<5}")
    print(f"{'-'*75}")

    for rank, stats in enumerate(sorted_meshes[:top_n], 1):
        name_str = (stats['name'][:25] + '...') if len(stats['name']) > 28 else stats['name']
        print(
            f"{rank:<5} "
            f"{stats['index']:<6} "
            f"{name_str:<28} "
            f"{stats['vertices']:<12,} "
            f"{format_bytes(stats['bytes']):<12} "
            f"{stats['primitives']:<5}"
        )
    print(f"{'='*75}\n")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Analyze glTF/GLB mesh sizes and vertex counts.")
    parser.add_argument("file", type=str, help="Path to .gltf or .glb file")
    parser.add_argument("-n", "--top", type=int, default=10, help="Number of top meshes to display (default: 10)")
    parser.add_argument(
        "-s", "--sort", 
        type=str, 
        choices=["vertices", "bytes"], 
        default="vertices", 
        help="Field to sort by: 'vertices' or 'bytes' (default: vertices)"
    )

    args = parser.parse_args()
    analyze_gltf(args.file, top_n=args.top, sort_by=args.sort)
