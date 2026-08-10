
import { Injectable, inject, OnDestroy } from '@angular/core';
import * as THREE from 'three';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { MapData, BspNode } from './doom-map.service';
import { MapResourcesService } from './map/map-resources.service';
import { MapGeometryBuilder } from './map/map-geometry-builder';
import { MapEntityBuilder } from './map/map-entity-builder';
import { MapControlsService } from './map/map-controls.service';
import { Subject } from 'rxjs';

export interface GeometryPickResult {
    polyIndex: number;
    textureId: number;
    point: THREE.Vector3;
    faceNormal: THREE.Vector3;
    object: THREE.Object3D;
}

export interface GeometryVertexMovedEvent {
    polyIndex: number;
    vertexIndex: number;
    position: THREE.Vector3;
    dragSession: number;
}

@Injectable({
  providedIn: 'root'
})
export class MapRendererService implements OnDestroy {
  resources = inject(MapResourcesService);
  geometry = inject(MapGeometryBuilder);
  entities = inject(MapEntityBuilder);
  controls = inject(MapControlsService);

  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private renderer!: THREE.WebGLRenderer;
  private animationFrameId: number | null = null;
  private resizeObserver: ResizeObserver | null = null;
  
  private boundsHelper: THREE.Box3Helper | null = null;
  private selectionHelper: THREE.Box3Helper | null = null;
  // Helper for highlighting selected faces/polygons
  private faceHelper: THREE.LineSegments | null = null;
  private geometryPreview: THREE.Line | null = null;
  private vertexHandles = new THREE.Group();
  private selectedVertexHandle: THREE.Mesh | null = null;
  private vertexDragSession = 0;
  private vertexDragging = false;
  private restoringVertex = false;
  
  private transformControls!: TransformControls;
  
  private raycaster = new THREE.Raycaster();
  private mouse = new THREE.Vector2();
  
  private lastFrameTime = 0;
  
  public entityMoved = new Subject<{id: number, position: THREE.Vector3}>();
  public geometryVertexMoved = new Subject<GeometryVertexMovedEvent>();

  constructor() {}

  init(canvas: HTMLCanvasElement) {
    if (this.renderer) this.dispose();
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x111111);

    this.camera = new THREE.PerspectiveCamera(60, w / h, 10, 200000); 
    this.camera.position.set(16384, 12000, 24000);
    this.camera.up.set(0, 1, 0);

    this.renderer = new THREE.WebGLRenderer({ 
        canvas, 
        antialias: false, 
        alpha: false, 
        logarithmicDepthBuffer: true
    });
    this.renderer.setSize(w, h, false);
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.sortObjects = true;

    this.controls.init(this.camera, canvas);
    this.controls.orbitControls.target.set(16384, 0, 16384);
    this.controls.orbitControls.update();
    
    this.transformControls = new TransformControls(this.camera, this.renderer.domElement);
    this.transformControls.setTranslationSnap(128); // Snap to 8 game units (128 world units)
    this.transformControls.addEventListener('dragging-changed', (event) => {
        this.controls.orbitControls.enabled = !event.value;
        this.vertexDragging = !!event.value && this.transformControls.object?.userData['vertexIndex'] !== undefined;
        if (this.vertexDragging) this.vertexDragSession++;
    });
    this.transformControls.addEventListener('change', () => {
        if (this.transformControls.object) {
            const obj = this.transformControls.object;
            
            // Force snapping to 128 world units (8 game units)
            obj.position.x = Math.round(obj.position.x / 128) * 128;
            obj.position.z = Math.round(obj.position.z / 128) * 128;

            const vertexIndex = obj.userData['vertexIndex'];
            if (vertexIndex !== undefined && this.vertexDragging && !this.restoringVertex) {
                this.geometryVertexMoved.next({
                    polyIndex: obj.userData['polyIndex'], vertexIndex,
                    position: obj.position.clone(), dragSession: this.vertexDragSession
                });
            }
            
            // Update selection helper box
            if (this.selectionHelper) {
                this.selectionHelper.box.setFromObject(obj);
            }
        }
    });
    this.scene.add(this.transformControls.getHelper());
    this.vertexHandles.name = 'geometry-vertex-handles';
    this.scene.add(this.vertexHandles);

    this.animate();

    this.resizeObserver = new ResizeObserver(() => {
        if (!canvas.parentElement) return;
        const nw = canvas.parentElement.clientWidth;
        const nh = canvas.parentElement.clientHeight;
        this.camera.aspect = nw / nh;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(nw, nh, false);
    });
    this.resizeObserver.observe(canvas.parentElement!);
  }

  getCameraPosition(): THREE.Vector3 {
      return this.camera.position.clone();
  }
  
  getCameraDirection(): THREE.Vector3 {
      const dir = new THREE.Vector3(0, 0, -1);
      dir.applyQuaternion(this.camera.quaternion);
      return dir;
  }

  loadMapData(data: MapData) {
    this.clearScene();
    this.geometry.build(this.scene, data);
    this.entities.build(this.scene, data);
  }

  refreshGeometry(data: MapData) {
      this.geometry.clear(this.scene);
      this.geometry.build(this.scene, data);
  }

  showVertexHandles(data: MapData | null, polyIndex: number | null) {
      this.clearVertexHandles();
      if (!data || polyIndex === null) return;
      const poly = data.geometry.polygons[polyIndex];
      if (!poly) return;
      const handleGeometry = new THREE.SphereGeometry(72, 12, 8);
      const handleMaterial = new THREE.MeshBasicMaterial({ color: 0x00ffff, depthTest: false });
      data.geometry.sourceVertices.slice(poly.vertexStart, poly.vertexStart + poly.vertexCount).forEach((vertex, vertexIndex) => {
          const handle = new THREE.Mesh(handleGeometry, handleMaterial);
          handle.position.set(vertex.x * 128, vertex.z * 128, vertex.y * 128);
          handle.renderOrder = 10001;
          handle.userData = { isVertexHandle: true, polyIndex, vertexIndex };
          this.vertexHandles.add(handle);
      });
  }

  pickVertexHandle(clientX: number, clientY: number, rect: DOMRect): boolean {
      this.updateRaycaster(clientX, clientY, rect);
      const hit = this.raycaster.intersectObjects(this.vertexHandles.children, false)[0];
      if (!hit) return false;
      this.selectedVertexHandle = hit.object as THREE.Mesh;
      this.transformControls.attach(this.selectedVertexHandle);
      return true;
  }

  restoreSelectedVertex(position: THREE.Vector3) {
      if (!this.selectedVertexHandle) return;
      this.restoringVertex = true;
      this.selectedVertexHandle.position.copy(position);
      this.restoringVertex = false;
  }

  clearVertexHandles() {
      if (this.selectedVertexHandle && this.transformControls?.object === this.selectedVertexHandle) this.transformControls.detach();
      this.selectedVertexHandle = null;
      const first = this.vertexHandles.children[0] as THREE.Mesh | undefined;
      first?.geometry.dispose();
      (first?.material as THREE.Material | undefined)?.dispose();
      for (const child of [...this.vertexHandles.children]) this.vertexHandles.remove(child);
  }

  showGeometryPreview(points: THREE.Vector3[], closed: boolean) {
      this.clearGeometryPreview();
      if (points.length < 2) return;
      const previewPoints = closed && points.length > 2 ? [...points, points[0]] : points;
      const geometry = new THREE.BufferGeometry().setFromPoints(previewPoints);
      this.geometryPreview = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: 0x00ffff, depthTest: false }));
      this.geometryPreview.renderOrder = 10000;
      this.scene.add(this.geometryPreview);
  }

  clearGeometryPreview() {
      if (!this.geometryPreview) return;
      this.scene.remove(this.geometryPreview);
      this.geometryPreview.geometry.dispose();
      (this.geometryPreview.material as THREE.Material).dispose();
      this.geometryPreview = null;
  }

  /**
   * Casts a ray and returns the Entity ID (sprite index).
   */
  pickObject(clientX: number, clientY: number, rect: DOMRect): number {
      this.updateRaycaster(clientX, clientY, rect);
      const intersects = this.raycaster.intersectObjects(this.scene.children, true);

      for (const hit of intersects) {
          let obj: THREE.Object3D | null = hit.object;
          while(obj) {
              if (obj.userData && obj.userData['entityId'] !== undefined) {
                  return obj.userData['entityId'];
              }
              obj = obj.parent;
          }
      }
      return -1;
  }

  /**
   * Casts a ray and returns geometry details (polygon index, intersection point).
   */
  pickGeometry(clientX: number, clientY: number, rect: DOMRect): GeometryPickResult | null {
      this.updateRaycaster(clientX, clientY, rect);
      
      // Filter objects that are marked as geometry
      const geometryMeshes = this.scene.children.filter(c => c.userData['isGeometry'] === true);
      const intersects = this.raycaster.intersectObjects(geometryMeshes, false);

      if (intersects.length > 0) {
          const hit = intersects[0];
          const mesh = hit.object as THREE.Mesh;
          const attr = mesh.geometry.getAttribute('polyIndex');
          
          if (attr && hit.faceIndex !== undefined) {
              // The 'polyIndex' attribute is per-vertex. 
              // A face has 3 vertices (a, b, c). We just check vertex 'a'.
              const vertIndex = hit.face!.a;
              const polyIndex = attr.getX(vertIndex);
              
              return {
                  polyIndex: polyIndex,
                  textureId: -1, // To be filled by service lookup
                  point: hit.point,
                  faceNormal: hit.face!.normal,
                  object: mesh
              };
          }
      }
      return null;
  }

  highlightBspNode(node: BspNode | null) {
      if (this.boundsHelper) {
          this.scene.remove(this.boundsHelper);
          this.boundsHelper = null;
      }

      if (node && node.bounds) {
          const min = new THREE.Vector3(node.bounds.minX, -2048, node.bounds.minY);
          const max = new THREE.Vector3(node.bounds.maxX, 8192, node.bounds.maxY);
          
          const box = new THREE.Box3(min, max);
          const helper = new THREE.Box3Helper(box, new THREE.Color(0xff0000));
          this.scene.add(helper);
          this.boundsHelper = helper;

          const cx = (node.bounds.minX + node.bounds.maxX) / 2;
          const cz = (node.bounds.minY + node.bounds.maxY) / 2;
          if (!this.controls.flyMode()) {
            this.controls.orbitControls.target.set(cx, 0, cz);
          }
      }
  }

  selectEntity(entityId: number, focus: boolean = true) {
      this.clearHighlights();

      if (entityId === -1) {
          this.transformControls.detach();
          return;
      }

      const obj = this.entities.getObjectByEntityId(entityId);
      if (obj) {
          const box = new THREE.Box3().setFromObject(obj);
          const helper = new THREE.Box3Helper(box, new THREE.Color(0xffff00));
          this.scene.add(helper);
          this.selectionHelper = helper;
          
          if (focus && !this.controls.flyMode()) {
            const center = new THREE.Vector3();
            box.getCenter(center);
            const size = new THREE.Vector3();
            box.getSize(size);
            const maxDim = Math.max(size.x, size.y, size.z);
            const dist = Math.max(maxDim * 3, 400); 
            this.controls.orbitControls.target.copy(center);
            const offset = new THREE.Vector3(1, 0.8, 1).normalize().multiplyScalar(dist);
            this.camera.position.copy(center).add(offset);
            this.controls.orbitControls.update();
          }
      } else {
          this.transformControls.detach();
      }
  }
  
  highlightPolygon(mesh: THREE.Mesh, polyIndex: number) {
      this.clearHighlights();
      
      const geo = mesh.geometry;
      const polyAttr = geo.getAttribute('polyIndex');
      const posAttr = geo.getAttribute('position');
      
      // Extract all vertices belonging to this poly index
      const vertices: number[] = [];
      const indices: number[] = [];
      let localIdx = 0;
      
      for (let i = 0; i < polyAttr.count; i++) {
          if (polyAttr.getX(i) === polyIndex) {
              vertices.push(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i));
              indices.push(localIdx++);
          }
      }
      
      // Assume triangles are sequential for the polygon in the buffer
      // We can just create wireframe for these vertices
      const highlightGeo = new THREE.BufferGeometry();
      highlightGeo.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
      
      // Create a wireframe geometry
      const wireframe = new THREE.WireframeGeometry(highlightGeo);
      this.faceHelper = new THREE.LineSegments(wireframe, new THREE.LineBasicMaterial({ color: 0x00ff00, depthTest: false }));
      this.faceHelper.renderOrder = 9999;
      
      this.scene.add(this.faceHelper);
  }

  clearHighlights() {
      if (this.transformControls) {
          this.transformControls.detach();
      }
      if (this.selectionHelper) {
          this.scene.remove(this.selectionHelper);
          this.selectionHelper = null;
      }
      if (this.faceHelper) {
          this.scene.remove(this.faceHelper);
          this.faceHelper = null;
      }
  }

  ngOnDestroy(): void {
    this.dispose();
  }

  dispose() {
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.controls.dispose();
    this.clearScene();
    if (this.transformControls) {
        this.transformControls.dispose();
    }
    if (this.renderer) {
        this.renderer.dispose();
    }
  }

  private updateRaycaster(x: number, y: number, rect: DOMRect) {
      this.mouse.x = ((x - rect.left) / rect.width) * 2 - 1;
      this.mouse.y = -((y - rect.top) / rect.height) * 2 + 1;
      this.raycaster.setFromCamera(this.mouse, this.camera);
  }

  private animate = (time: number = 0) => {
    this.animationFrameId = requestAnimationFrame(this.animate);
    const delta = (time - this.lastFrameTime) / 1000;
    this.lastFrameTime = time;
    this.controls.update(delta);
    const euler = new THREE.Euler().setFromQuaternion(this.camera.quaternion, 'YXZ');
    this.resources.updateSkyUniforms(euler.y);
    this.renderer.render(this.scene, this.camera);
  };

  private clearScene() {
    this.clearVertexHandles();
    this.clearGeometryPreview();
    this.geometry.clear(this.scene);
    this.entities.clear(this.scene);
    this.resources.dispose();

    if (this.boundsHelper) {
        this.scene.remove(this.boundsHelper);
        this.boundsHelper = null;
    }
    this.clearHighlights();
  }
}
