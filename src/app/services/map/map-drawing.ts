import * as THREE from 'three';
import { PolyFlag } from '../../core/constants/geometry';
import { DoomGeometryService, MapGeometry } from '../doom-geometry.service';

export interface DraftLeafResult {
    valid: boolean;
    leafIndex: number;
    message?: string;
}

/** Keeps a picked point on the plane established by the first draft point. */
export function resolveDraftPoint(
    geometryPoint: THREE.Vector3 | null,
    planePoint: THREE.Vector3 | null,
    drawingPlane: THREE.Plane | null
): THREE.Vector3 | null {
    const point = geometryPoint ?? planePoint;
    if (!point) return null;
    return drawingPlane ? drawingPlane.projectPoint(point, new THREE.Vector3()) : point.clone();
}

/** Selects the encoded extrusion axis from the dominant endpoint delta. */
export function wallAxisFromEndpoints(a: THREE.Vector3, b: THREE.Vector3): PolyFlag {
    const dx = Math.abs(b.x - a.x);
    const dy = Math.abs(b.z - a.z); // Three.js Z is the map format's Y axis.
    const dz = Math.abs(b.y - a.y); // Three.js Y is the map format's Z axis.
    if (dx >= dy && dx >= dz) return PolyFlag.AxisX;
    if (dy >= dz) return PolyFlag.AxisY;
    return PolyFlag.AxisZ;
}

export function validateDraftLeaf(
    geometryService: DoomGeometryService,
    geometry: MapGeometry,
    point: THREE.Vector3,
    expectedLeaf: number | null
): DraftLeafResult {
    const leafIndex = geometryService.findLeafAt(geometry, Math.round(point.x / 128), Math.round(point.z / 128));
    if (leafIndex < 0) {
        return { valid: false, leafIndex, message: 'Cannot draw here: the point is outside every valid BSP leaf.' };
    }
    if (expectedLeaf !== null && leafIndex !== expectedLeaf) {
        return { valid: false, leafIndex, message: 'Cannot continue in another BSP leaf. Finish or cancel the current shape first.' };
    }
    return { valid: true, leafIndex };
}
