#!/usr/bin/env python3
"""
Blender Mesh Converter for qgis2threejs Terrain

Converts between qgis2threejs JSON format and OBJ format for editing in Blender.

IMPORTANT: When editing in Blender:
  - DO NOT move, rotate, or scale the mesh
  - Only edit vertex Z positions (elevation)
  - Keep the mesh origin at (0, 0, 0)
  - Export as OBJ with the same settings

Usage:
  python blender_mesh_converter.py to-obj <input.json> [output.obj]
  python blender_mesh_converter.py to-json <input.obj> <original.json> [output.json]

Examples:
  # Convert to OBJ for Blender editing
  python blender_mesh_converter.py to-obj ../public/3d-map/data/index/a0.json terrain.obj

  # Convert back to JSON after editing (needs original for faces data)
  python blender_mesh_converter.py to-json terrain_edited.obj ../public/3d-map/data/index/a0.json a0_edited.json
"""

import json
import sys
import os
from pathlib import Path


def json_to_obj(json_path: str, obj_path: str = None) -> str:
    """
    Convert qgis2threejs JSON terrain to OBJ format.
    
    Args:
        json_path: Path to the qgis2threejs JSON file (e.g., a0.json)
        obj_path: Output OBJ file path (optional, defaults to same name with .obj extension)
    
    Returns:
        Path to the created OBJ file
    """
    json_path = Path(json_path)
    
    if obj_path is None:
        obj_path = json_path.with_suffix('.obj')
    else:
        obj_path = Path(obj_path)
    
    print(f"Loading JSON from: {json_path}")
    
    with open(json_path, 'r') as f:
        data = json.load(f)
    
    if 'triangles' not in data:
        raise ValueError("Invalid qgis2threejs JSON: missing 'triangles' key")
    
    vertices = data['triangles'].get('v', [])
    faces = data['triangles'].get('f', [])
    
    if not vertices:
        raise ValueError("Invalid qgis2threejs JSON: no vertices found")
    
    num_vertices = len(vertices) // 3
    num_faces = len(faces) // 3
    
    print(f"Found {num_vertices} vertices and {num_faces} faces")
    
    # Calculate bounds for info
    min_x, max_x = float('inf'), float('-inf')
    min_y, max_y = float('inf'), float('-inf')
    min_z, max_z = float('inf'), float('-inf')
    
    for i in range(0, len(vertices), 3):
        x, y, z = vertices[i], vertices[i + 1], vertices[i + 2]
        min_x, max_x = min(min_x, x), max(max_x, x)
        min_y, max_y = min(min_y, y), max(max_y, y)
        min_z, max_z = min(min_z, z), max(max_z, z)
    
    print(f"Bounds:")
    print(f"  X: {min_x:.2f} to {max_x:.2f} (width: {max_x - min_x:.2f})")
    print(f"  Y: {min_y:.2f} to {max_y:.2f} (depth: {max_y - min_y:.2f})")
    print(f"  Z: {min_z:.2f} to {max_z:.2f} (height: {max_z - min_z:.2f})")
    
    # Write OBJ file
    print(f"Writing OBJ to: {obj_path}")
    
    with open(obj_path, 'w') as f:
        f.write("# Exported from qgis2threejs JSON by blender_mesh_converter.py\n")
        f.write(f"# Original file: {json_path.name}\n")
        f.write(f"# Vertices: {num_vertices}, Faces: {num_faces}\n")
        f.write("#\n")
        f.write("# IMPORTANT: Only edit Z values (elevation) in Blender!\n")
        f.write("# Do not move, rotate, or scale the mesh.\n")
        f.write("#\n\n")
        
        # Write vertices
        for i in range(0, len(vertices), 3):
            x, y, z = vertices[i], vertices[i + 1], vertices[i + 2]
            f.write(f"v {x} {y} {z}\n")
        
        f.write("\n")
        
        # Write faces (OBJ uses 1-based indexing)
        for i in range(0, len(faces), 3):
            v1, v2, v3 = faces[i] + 1, faces[i + 1] + 1, faces[i + 2] + 1
            f.write(f"f {v1} {v2} {v3}\n")
    
    print(f"✓ Successfully exported to {obj_path}")
    print("\n" + "=" * 60)
    print("BLENDER IMPORT INSTRUCTIONS:")
    print("=" * 60)
    print("1. Open Blender and go to File > Import > Wavefront (.obj)")
    print(f"2. Navigate to and select: {obj_path.absolute()}")
    print("3. In import settings, ensure:")
    print("   - Forward Axis: -Z")
    print("   - Up Axis: Y")
    print("4. Edit the mesh (only Z values for elevation!)")
    print("5. Export: File > Export > Wavefront (.obj)")
    print("   - Use the same axis settings")
    print("   - Uncheck 'Write Materials'")
    print("=" * 60)
    
    return str(obj_path)


def obj_to_json(obj_path: str, original_json_path: str, output_json_path: str = None) -> str:
    """
    Convert OBJ back to qgis2threejs JSON format.
    
    Uses the original JSON for face indices (in case vertex count changed,
    this will fail safely rather than produce corrupt data).
    
    Args:
        obj_path: Path to the edited OBJ file
        original_json_path: Path to the original qgis2threejs JSON (for reference)
        output_json_path: Output JSON file path (optional)
    
    Returns:
        Path to the created JSON file
    """
    obj_path = Path(obj_path)
    original_json_path = Path(original_json_path)
    
    if output_json_path is None:
        output_json_path = obj_path.with_suffix('.json')
    else:
        output_json_path = Path(output_json_path)
    
    print(f"Loading OBJ from: {obj_path}")
    print(f"Loading original JSON from: {original_json_path}")
    
    # Load original JSON for faces
    with open(original_json_path, 'r') as f:
        original_data = json.load(f)
    
    original_vertices = original_data['triangles']['v']
    original_faces = original_data['triangles']['f']
    original_vertex_count = len(original_vertices) // 3
    
    # Parse OBJ file
    vertices = []
    faces_from_obj = []
    
    with open(obj_path, 'r') as f:
        for line in f:
            line = line.strip()
            if line.startswith('v '):
                parts = line.split()
                if len(parts) >= 4:
                    x, y, z = float(parts[1]), float(parts[2]), float(parts[3])
                    vertices.extend([x, y, z])
            elif line.startswith('f '):
                parts = line.split()
                if len(parts) >= 4:
                    # OBJ faces can have formats like "1" or "1/2/3"
                    v1 = int(parts[1].split('/')[0]) - 1
                    v2 = int(parts[2].split('/')[0]) - 1
                    v3 = int(parts[3].split('/')[0]) - 1
                    faces_from_obj.extend([v1, v2, v3])
    
    new_vertex_count = len(vertices) // 3
    print(f"OBJ has {new_vertex_count} vertices, original had {original_vertex_count}")
    
    if new_vertex_count != original_vertex_count:
        print("\n⚠️  WARNING: Vertex count mismatch!")
        print("    This may indicate mesh topology was modified.")
        print("    Using faces from OBJ file instead of original.")
        
        if len(faces_from_obj) != len(original_faces):
            print(f"\n❌ ERROR: Face count also differs!")
            print(f"    OBJ faces: {len(faces_from_obj) // 3}")
            print(f"    Original faces: {len(original_faces) // 3}")
            print("\n    The mesh topology has changed. Geo-mapping may not work correctly!")
            
            response = input("    Continue anyway? (y/N): ")
            if response.lower() != 'y':
                print("Aborted.")
                sys.exit(1)
        
        faces = faces_from_obj
    else:
        # Vertex count matches, use original faces for safety
        faces = original_faces
        print("✓ Vertex count matches - using original face indices")
    
    # Validate vertex positions (X, Y should match original)
    max_xy_diff = 0
    max_z_diff = 0
    
    for i in range(0, min(len(vertices), len(original_vertices)), 3):
        x_diff = abs(vertices[i] - original_vertices[i])
        y_diff = abs(vertices[i + 1] - original_vertices[i + 1])
        z_diff = abs(vertices[i + 2] - original_vertices[i + 2])
        
        max_xy_diff = max(max_xy_diff, x_diff, y_diff)
        max_z_diff = max(max_z_diff, z_diff)
    
    if max_xy_diff > 0.001:
        print(f"\n⚠️  WARNING: X/Y positions changed (max diff: {max_xy_diff:.6f})")
        print("    This may break geo-mapping! Only Z values should change.")
        
        response = input("    Continue anyway? (y/N): ")
        if response.lower() != 'y':
            print("Aborted.")
            sys.exit(1)
    else:
        print(f"✓ X/Y positions preserved (max diff: {max_xy_diff:.6f})")
    
    print(f"  Max Z (elevation) change: {max_z_diff:.2f}")
    
    # Create output JSON
    output_data = {
        "triangles": {
            "v": vertices,
            "f": faces
        }
    }
    
    print(f"\nWriting JSON to: {output_json_path}")
    
    with open(output_json_path, 'w') as f:
        json.dump(output_data, f, separators=(',', ':'))
    
    # Get file sizes
    original_size = original_json_path.stat().st_size
    new_size = output_json_path.stat().st_size
    
    print(f"✓ Successfully exported to {output_json_path}")
    print(f"  Original size: {original_size / 1024:.1f} KB")
    print(f"  New size: {new_size / 1024:.1f} KB")
    
    return str(output_json_path)


def trim_edges(json_path: str, output_path: str = None, trim_percent: float = 0.02) -> str:
    """
    Trim edge vertices by removing triangles at the mesh boundary.
    This can help remove edge artifacts without manual editing.
    
    Args:
        json_path: Path to the qgis2threejs JSON file
        output_path: Output JSON file path (optional)
        trim_percent: Percentage of width/height to trim from edges (default 2%)
    
    Returns:
        Path to the created JSON file
    """
    json_path = Path(json_path)
    
    if output_path is None:
        output_path = json_path.with_stem(json_path.stem + '_trimmed')
    else:
        output_path = Path(output_path)
    
    print(f"Loading JSON from: {json_path}")
    print(f"Trim percentage: {trim_percent * 100:.1f}%")
    
    with open(json_path, 'r') as f:
        data = json.load(f)
    
    vertices = data['triangles']['v']
    faces = data['triangles']['f']
    
    num_vertices = len(vertices) // 3
    num_faces_original = len(faces) // 3
    
    # Find bounds
    min_x, max_x = float('inf'), float('-inf')
    min_y, max_y = float('inf'), float('-inf')
    
    for i in range(0, len(vertices), 3):
        x, y = vertices[i], vertices[i + 1]
        min_x, max_x = min(min_x, x), max(max_x, x)
        min_y, max_y = min(min_y, y), max(max_y, y)
    
    # Calculate trim bounds
    trim_x = (max_x - min_x) * trim_percent
    trim_y = (max_y - min_y) * trim_percent
    
    new_min_x = min_x + trim_x
    new_max_x = max_x - trim_x
    new_min_y = min_y + trim_y
    new_max_y = max_y - trim_y
    
    print(f"Original bounds: X[{min_x:.2f}, {max_x:.2f}] Y[{min_y:.2f}, {max_y:.2f}]")
    print(f"Trimmed bounds:  X[{new_min_x:.2f}, {new_max_x:.2f}] Y[{new_min_y:.2f}, {new_max_y:.2f}]")
    
    # Mark vertices that are inside the trimmed bounds
    vertex_inside = []
    for i in range(0, len(vertices), 3):
        x, y = vertices[i], vertices[i + 1]
        inside = new_min_x <= x <= new_max_x and new_min_y <= y <= new_max_y
        vertex_inside.append(inside)
    
    # Filter faces: keep only faces where ALL vertices are inside
    new_faces = []
    for i in range(0, len(faces), 3):
        v1, v2, v3 = faces[i], faces[i + 1], faces[i + 2]
        if vertex_inside[v1] and vertex_inside[v2] and vertex_inside[v3]:
            new_faces.extend([v1, v2, v3])
    
    num_faces_new = len(new_faces) // 3
    faces_removed = num_faces_original - num_faces_new
    
    print(f"Faces: {num_faces_original} → {num_faces_new} ({faces_removed} removed, {faces_removed / num_faces_original * 100:.1f}%)")
    
    # Create output (keep all vertices to preserve indices)
    output_data = {
        "triangles": {
            "v": vertices,
            "f": new_faces
        }
    }
    
    print(f"Writing JSON to: {output_path}")
    
    with open(output_path, 'w') as f:
        json.dump(output_data, f, separators=(',', ':'))
    
    print(f"✓ Successfully exported to {output_path}")
    
    return str(output_path)


def smooth_edges(json_path: str, output_path: str = None, edge_distance: float = 0.05, smooth_strength: float = 0.5) -> str:
    """
    Smooth edge vertices by blending their elevation with nearby interior vertices.
    
    Args:
        json_path: Path to the qgis2threejs JSON file
        output_path: Output JSON file path (optional)
        edge_distance: Distance from edge (as fraction of size) to consider as edge (default 5%)
        smooth_strength: How much to blend toward average (0 = no change, 1 = full blend)
    
    Returns:
        Path to the created JSON file
    """
    json_path = Path(json_path)
    
    if output_path is None:
        output_path = json_path.with_stem(json_path.stem + '_smoothed')
    else:
        output_path = Path(output_path)
    
    print(f"Loading JSON from: {json_path}")
    print(f"Edge distance: {edge_distance * 100:.1f}%, Smooth strength: {smooth_strength}")
    
    with open(json_path, 'r') as f:
        data = json.load(f)
    
    vertices = list(data['triangles']['v'])  # Make a copy
    faces = data['triangles']['f']
    
    # Find bounds
    min_x, max_x = float('inf'), float('-inf')
    min_y, max_y = float('inf'), float('-inf')
    
    for i in range(0, len(vertices), 3):
        x, y = vertices[i], vertices[i + 1]
        min_x, max_x = min(min_x, x), max(max_x, x)
        min_y, max_y = min(min_y, y), max(max_y, y)
    
    # Calculate edge zone
    edge_x = (max_x - min_x) * edge_distance
    edge_y = (max_y - min_y) * edge_distance
    
    # Calculate average elevation of interior vertices
    interior_elevations = []
    for i in range(0, len(vertices), 3):
        x, y, z = vertices[i], vertices[i + 1], vertices[i + 2]
        
        # Check if interior
        if (min_x + edge_x < x < max_x - edge_x and 
            min_y + edge_y < y < max_y - edge_y and 
            z > 0):  # Valid elevation
            interior_elevations.append(z)
    
    if not interior_elevations:
        print("No interior vertices found!")
        return str(json_path)
    
    avg_elevation = sum(interior_elevations) / len(interior_elevations)
    min_interior = min(interior_elevations)
    max_interior = max(interior_elevations)
    
    print(f"Interior elevation stats: min={min_interior:.2f}, avg={avg_elevation:.2f}, max={max_interior:.2f}")
    
    # Smooth edge vertices
    edge_count = 0
    for i in range(0, len(vertices), 3):
        x, y, z = vertices[i], vertices[i + 1], vertices[i + 2]
        
        # Calculate distance from edge (normalized 0-1)
        dist_from_left = (x - min_x) / edge_x if edge_x > 0 else 1
        dist_from_right = (max_x - x) / edge_x if edge_x > 0 else 1
        dist_from_bottom = (y - min_y) / edge_y if edge_y > 0 else 1
        dist_from_top = (max_y - y) / edge_y if edge_y > 0 else 1
        
        min_dist = min(dist_from_left, dist_from_right, dist_from_bottom, dist_from_top)
        
        if min_dist < 1:  # Within edge zone
            edge_count += 1
            
            # Blend factor: 0 at edge, 1 at edge zone boundary
            blend = min_dist
            
            # Clamp elevation toward average
            if z <= 0 or z < min_interior * 0.8 or z > max_interior * 1.2:
                # Invalid elevation - replace entirely
                vertices[i + 2] = avg_elevation
            else:
                # Blend toward average based on distance from edge
                target = avg_elevation
                vertices[i + 2] = z + (target - z) * smooth_strength * (1 - blend)
    
    print(f"Smoothed {edge_count} edge vertices")
    
    # Create output
    output_data = {
        "triangles": {
            "v": vertices,
            "f": faces
        }
    }
    
    print(f"Writing JSON to: {output_path}")
    
    with open(output_path, 'w') as f:
        json.dump(output_data, f, separators=(',', ':'))
    
    print(f"✓ Successfully exported to {output_path}")
    
    return str(output_path)


def print_usage():
    print(__doc__)
    print("\nCommands:")
    print("  to-obj <input.json> [output.obj]")
    print("      Convert qgis2threejs JSON to OBJ for Blender editing")
    print()
    print("  to-json <input.obj> <original.json> [output.json]")
    print("      Convert edited OBJ back to qgis2threejs JSON")
    print()
    print("  trim <input.json> [output.json] [--percent=0.02]")
    print("      Remove triangles at mesh edges (default 2%)")
    print()
    print("  smooth <input.json> [output.json] [--distance=0.05] [--strength=0.5]")
    print("      Smooth edge vertex elevations")
    print()


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print_usage()
        sys.exit(1)
    
    command = sys.argv[1].lower()
    
    try:
        if command == 'to-obj':
            if len(sys.argv) < 3:
                print("Error: Missing input JSON path")
                print("Usage: python blender_mesh_converter.py to-obj <input.json> [output.obj]")
                sys.exit(1)
            
            json_path = sys.argv[2]
            obj_path = sys.argv[3] if len(sys.argv) > 3 else None
            json_to_obj(json_path, obj_path)
        
        elif command == 'to-json':
            if len(sys.argv) < 4:
                print("Error: Missing required arguments")
                print("Usage: python blender_mesh_converter.py to-json <input.obj> <original.json> [output.json]")
                sys.exit(1)
            
            obj_path = sys.argv[2]
            original_json = sys.argv[3]
            output_json = sys.argv[4] if len(sys.argv) > 4 else None
            obj_to_json(obj_path, original_json, output_json)
        
        elif command == 'trim':
            if len(sys.argv) < 3:
                print("Error: Missing input JSON path")
                print("Usage: python blender_mesh_converter.py trim <input.json> [output.json] [--percent=0.02]")
                sys.exit(1)
            
            json_path = sys.argv[2]
            output_path = None
            trim_percent = 0.02
            
            for arg in sys.argv[3:]:
                if arg.startswith('--percent='):
                    trim_percent = float(arg.split('=')[1])
                elif not arg.startswith('--'):
                    output_path = arg
            
            trim_edges(json_path, output_path, trim_percent)
        
        elif command == 'smooth':
            if len(sys.argv) < 3:
                print("Error: Missing input JSON path")
                print("Usage: python blender_mesh_converter.py smooth <input.json> [output.json] [--distance=0.05] [--strength=0.5]")
                sys.exit(1)
            
            json_path = sys.argv[2]
            output_path = None
            edge_distance = 0.05
            smooth_strength = 0.5
            
            for arg in sys.argv[3:]:
                if arg.startswith('--distance='):
                    edge_distance = float(arg.split('=')[1])
                elif arg.startswith('--strength='):
                    smooth_strength = float(arg.split('=')[1])
                elif not arg.startswith('--'):
                    output_path = arg
            
            smooth_edges(json_path, output_path, edge_distance, smooth_strength)
        
        elif command in ['help', '-h', '--help']:
            print_usage()
        
        else:
            print(f"Unknown command: {command}")
            print_usage()
            sys.exit(1)
    
    except FileNotFoundError as e:
        print(f"Error: File not found - {e.filename}")
        sys.exit(1)
    except json.JSONDecodeError as e:
        print(f"Error: Invalid JSON - {e}")
        sys.exit(1)
    except Exception as e:
        print(f"Error: {e}")
        sys.exit(1)


