import { Component, ElementRef, ViewChild, AfterViewInit, OnDestroy, inject, signal, effect, computed, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DoomMapService, BspNode, MapSprite, MapData } from '../../services/doom-map.service';
import { MapCoordinateService } from '../../services/map/map-coordinate.service';
import { DoomTextureService, TextureInfo } from '../../services/doom-texture.service';
import { DoomFileService } from '../../services/doom-file.service';
import { DoomEntitiesService, EntityDef } from '../../services/doom-entities.service';
import { DoomScriptService, ScriptData } from '../../services/doom-script.service';
import { MapRendererService } from '../../services/map-renderer.service';
import { BspTreeComponent } from './bsp-tree/bsp-tree.component';
import { EntityListComponent } from './entity-list/entity-list.component';
import { EditorService, EntitySelection } from '../../services/editor.service';
import { TextureThumbnailComponent } from '../texture-viewer/texture-thumbnail/texture-thumbnail.component';
import { MapToolbarComponent, EditMode } from './map-toolbar/map-toolbar.component';
import { MapInspectorComponent, EntityDetails, GeometrySelection } from './map-inspector/map-inspector.component';
import * as THREE from 'three';

import { EntityTemplate } from './entity-picker/entity-picker.component';
import { MapValidationService } from '../../services/map/map-validation.service';
import { DoomGeometryService, MapGeometry, MapVertexRecord } from '../../services/doom-geometry.service';
import { PolyFlag } from '../../core/constants/geometry';
import { resolveDraftPoint, validateDraftLeaf, wallAxisFromEndpoints } from '../../services/map/map-drawing';

interface MapEditorSnapshot { geometry: MapGeometry; sprites: MapSprite[]; scripts: ScriptData | null; }

@Component({
  selector: 'app-map-3d',
  standalone: true,
  imports: [
    CommonModule, 
    FormsModule, 
    BspTreeComponent, 
    EntityListComponent, 
    MapToolbarComponent,
    MapInspectorComponent
  ],
  template: `
    <div class="flex w-full h-full bg-[#111]">
      <!-- 3D Viewport Area -->
      <div class="flex-1 flex flex-col min-w-0 min-h-0">
          
          <app-map-toolbar
            [selectedMapId]="selectedMapId()"
            [editMode]="editMode()"
            [canUndo]="undoStack().length > 0" [canRedo]="redoStack().length > 0"
            [operationActive]="draftPoints().length > 0"
            [hasSelection]="selectedEntityId() !== -1 || selectedGeometry() !== null"
            (loadMap)="loadMap($event)"
            (editModeChange)="editMode.set($event)"
            (undo)="undoGeometry()" (redo)="redoGeometry()"
            (confirmOperation)="confirmGeometryOperation()" (cancelOperation)="cancelGeometryOperation()"
            (saveMap)="saveMap()"
            (addEntity)="addEntity($event)"
            (confirmOperation)="confirmGeometryOperation()"
            (cancelOperation)="cancelGeometryOperation()"
            (undo)="undoGeometry()"
            (redo)="redoGeometry()"
            (focusSelected)="focusSelected()"
           />

          <!-- Canvas -->
          <div class="flex-1 relative overflow-hidden bg-black">
            <canvas #rendererCanvas 
                (mousedown)="onCanvasMouseDown($event)"
                (mouseup)="onCanvasMouseUp($event)"
                class="block w-full h-full outline-none"
                [class.cursor-crosshair]="editMode() === 'paint'"
                [class.cursor-default]="editMode() === 'select'"
            >
            </canvas>
            
            <!-- Quick instructions overlay -->
            <div class="absolute top-2 left-2 pointer-events-none text-[10px] text-white/50 bg-black/50 px-2 py-1 rounded">
                @if(editMode() === 'select') { Click to select objects/walls. Entity editing is DISABLED. }
                @if(editMode() === 'vertex') { Select a polygon, then drag one of its cyan vertex handles. }
                @if(editMode() === 'paint') { Click wall/flat to apply selected texture. }
                @if(editMode() === 'wall') { Click two snapped points, choose a material, then confirm. }
                @if(editMode() === 'polygon') { Click 3–9 snapped coplanar points, then confirm. }
            </div>
            @if(editMode() === 'wall' || editMode() === 'polygon') {
              <div class="absolute bottom-3 left-3 bg-neutral-900/95 border border-cyan-700 rounded px-3 py-2 text-xs text-white">
                Grid: 1 map unit (128 world) · Material group: {{ selectedMaterialGroup() }} · Points: {{ draftPoints().length }}
              </div>
            }

            @if(!fileService.isLoaded()) {
                <div class="absolute inset-0 flex items-center justify-center bg-black/80 text-neutral-500 pointer-events-none">
                    Load JAR to view maps
                </div>
            }
          </div>
      </div>

      <!-- Right Sidebar: Tabs for Inspector/Tree -->
      <div class="w-80 bg-neutral-900 border-l border-neutral-800 flex flex-col flex-none">
          <div class="flex border-b border-neutral-800">
              <button (click)="sidebarTab.set('inspector')" class="flex-1 py-2 text-xs font-bold uppercase tracking-wider hover:bg-neutral-800 transition-colors" [class.text-white]="sidebarTab() === 'inspector'" [class.text-neutral-500]="sidebarTab() !== 'inspector'" [class.border-b-2]="sidebarTab() === 'inspector'" [class.border-red-600]="sidebarTab() === 'inspector'">
                  Insp
              </button>
              <button (click)="sidebarTab.set('entities')" class="flex-1 py-2 text-xs font-bold uppercase tracking-wider hover:bg-neutral-800 transition-colors" [class.text-white]="sidebarTab() === 'entities'" [class.text-neutral-500]="sidebarTab() !== 'entities'" [class.border-b-2]="sidebarTab() === 'entities'" [class.border-red-600]="sidebarTab() === 'entities'">
                  Ents
              </button>
              <button (click)="sidebarTab.set('bsp')" class="flex-1 py-2 text-xs font-bold uppercase tracking-wider hover:bg-neutral-800 transition-colors" [class.text-white]="sidebarTab() === 'bsp'" [class.text-neutral-500]="sidebarTab() !== 'bsp'" [class.border-b-2]="sidebarTab() === 'bsp'" [class.border-red-600]="sidebarTab() === 'bsp'">
                  BSP
              </button>
          </div>

          <div class="flex-1 overflow-hidden relative">
              @if (sidebarTab() === 'bsp') {
                  <app-bsp-tree 
                    class="block h-full"
                    [bspTree]="bspTree()"
                    [selectedNode]="selectedNode()"
                    (nodeSelected)="onNodeSelected($event)"
                  />
              } @else if (sidebarTab() === 'entities') {
                  <app-entity-list 
                    class="block h-full"
                    [sprites]="spritesList()"
                    [selectedId]="selectedEntityId()"
                    (selectEntity)="selectEntity($event, true)" 
                  />
              } @else {
                  <app-map-inspector 
                    [editMode]="editMode()"
                    [entityDetails]="selectedEntityDetails()"
                    [geometryDetails]="selectedGeometry()"
                    [scriptData]="currentScriptData()"
                    (setTextureForPoly)="setTextureForSelectedPoly($event.texId)"
                    (jumpToScript)="onJumpToScript($event)"
                    (eventsChanged)="onTileEventsChanged($event)"
                    (entityChanging)="pushUndo()" (entityUpdated)="onEntityUpdated()"
                    (deleteEntity)="deleteSelectedEntity()"
                    (swapEntityId)="swapSelectedEntity()"
                  />
              }
          </div>
      </div>
    </div>
  `
})
export class Map3DComponent implements AfterViewInit, OnDestroy {
  @ViewChild('rendererCanvas') canvasRef!: ElementRef<HTMLCanvasElement>;

  mapService = inject(DoomMapService);
  coordinateService = inject(MapCoordinateService);
  textureService = inject(DoomTextureService);
  entitiesService = inject(DoomEntitiesService);
  scriptService = inject(DoomScriptService);
  fileService = inject(DoomFileService);
  renderer = inject(MapRendererService);
  geometryService = inject(DoomGeometryService);
  editorService = inject(EditorService);
  mapValidation = inject(MapValidationService);

  currentTextureId = this.editorService.currentTextureId; 

  selectedMapId = signal(1);
  isLoading = signal(false);
  bspTree = signal<BspNode | null>(null);
  selectedNode = signal<BspNode | null>(null);
  
  sidebarTab = signal<'inspector' | 'bsp' | 'entities'>('inspector');
  editMode = signal<EditMode>('select');
  draftPoints = signal<THREE.Vector3[]>([]);
  undoStack = signal<MapEditorSnapshot[]>([]);
  redoStack = signal<MapEditorSnapshot[]>([]);
  
  selectedEntityId = signal<number>(-1);
  selectedGeometry = signal<GeometrySelection | null>(null);
  
  mapData: MapData | null = null;
  spritesList = signal<MapSprite[]>([]);
  
  currentScriptData = signal<ScriptData | null>(null);
  selectedMaterialGroup = computed(() => this.textureService.textureList().find(t => t.id === this.currentTextureId())?.groupId ?? 1);

  private mouseDownPos = { x: 0, y: 0 };
  private pendingSelection: EntitySelection | null = null;
  private drawingPlane: THREE.Plane | null = null;
  private draftLeafIndex: number | null = null;
  private vertexUndoSession = -1;


  selectedEntityDetails = computed<EntityDetails | null>(() => {
      const id = this.selectedEntityId();
      if (id === -1 || !this.mapData) return null;
      
      const sprite = this.mapData.sprites[id];
      if (!sprite) return null;
      
      const textureInfo = this.textureService.getTextureByGroup(sprite.textureId);
      const def = this.entitiesService.getDefByTileIndex(sprite.textureId);
      
      return {
          spriteIndex: id,
          raw: sprite,
          texture: textureInfo,
          entityDef: def,
          flagsDecoded: this.decodeFlags(sprite.flags),
          floorHeight: this.coordinateService.getFloorHeight(this.mapData, sprite.x, sprite.z)
      };
  });

  constructor() {
      effect(() => {
          const req = this.editorService.requestedEntitySelection();
          if (req) {
              this.pendingSelection = req;
              if (this.selectedMapId() !== req.mapId) {
                  this.loadMap(req.mapId);
              } else if (!this.isLoading() && this.mapData) {
                   this.processPendingSelection();
              }
          }
      });
      
      effect(() => {
          if (this.fileService.isLoaded() && !this.mapData && !this.isLoading()) {
              this.loadMap(this.selectedMapId());
          }
      });
      
      effect(() => {
          this.editorService.scriptsUpdated(); 
          const mapId = this.selectedMapId();
          if (this.mapData && !this.isLoading()) {
              // Event edits already live in DoomScriptService's shared cache. Do not
              // force a JAR re-read here or an external update would discard them.
              this.scriptService.ensureScriptLoaded(mapId).then(d => {
                  this.currentScriptData.set(d);
              });
          }
      });

      effect(() => {
          // Tabs stay mounted, so explicitly release held movement when Map is hidden.
          if (this.editorService.activeTab() !== 'map') this.renderer.controls.clearInputState();
      });

      effect(() => {
          const mode = this.editMode();
          const selection = this.selectedGeometry();
          this.vertexUndoSession = -1;
          this.renderer.showVertexHandles(mode === 'vertex' ? this.mapData : null, mode === 'vertex' ? selection?.polyIndex ?? null : null);
      });
  }

  ngAfterViewInit(): void {
    this.renderer.init(this.canvasRef.nativeElement);
    
    this.renderer.entityMoved.subscribe(({id, position}) => {
        if (!this.mapData) return;
        const sprite = this.mapData.sprites[id];
        if (sprite) {
            this.pushUndo();
            // Convert world space back to game space
            // X and Z are multiples of 8 (128 world units)
            const byteX = Math.round(position.x / 128.0);
            const byteZ = Math.round(position.z / 128.0);
            
            sprite.x = byteX * 8;
            sprite.z = byteZ * 8;
            
            // Handle Y coordinate
            const S = 16.0;
            if (sprite.type === 'z') {
                sprite.y = Math.round(position.y / S);
            } else {
                let texInfo = this.textureService.getTextureByGroup(sprite.textureId);
                if (sprite.textureId >= 1 && sprite.textureId < 14) {
                    const worldSpriteFrame = this.textureService.getTextureFrame(sprite.textureId, 2);
                    if (worldSpriteFrame) {
                        texInfo = worldSpriteFrame;
                    }
                }
                const h = texInfo ? texInfo.height * S : 256;
                const logicalHeight = 64.0 * S;
                const yOffset = (h / 2) - (logicalHeight / 2);
                
                let yPosWorld = position.y - yOffset;
                if (sprite.flags & 1) { // SpriteFlag.ZOffset
                    yPosWorld += 32.0 * S;
                }
                
                sprite.y = Math.round(yPosWorld / S);
            }
            
            // Trigger change detection for the inspector
            this.spritesList.set([...this.mapData.sprites]);
            this.markMapDirty();
        }
    });

    this.renderer.geometryVertexMoved.subscribe(event => this.onGeometryVertexMoved(event));

    if (this.fileService.isLoaded()) {
        this.loadMap(this.selectedMapId());
    }
  }

  ngOnDestroy(): void {
    this.renderer.dispose();
  }
  
  onNodeSelected(node: BspNode) {
      this.selectedNode.set(node);
      this.renderer.highlightBspNode(node);
  }

  onCanvasMouseDown(e: MouseEvent) {
      this.mouseDownPos = { x: e.clientX, y: e.clientY };
  }

  onCanvasMouseUp(e: MouseEvent) {
      const dist = Math.abs(e.clientX - this.mouseDownPos.x) + Math.abs(e.clientY - this.mouseDownPos.y);
      if (dist < 5) { 
          const rect = this.canvasRef.nativeElement.getBoundingClientRect();
          if (this.editMode() === 'vertex' && this.renderer.pickVertexHandle(e.clientX, e.clientY, rect)) return;
          
          const entityId = this.renderer.pickObject(e.clientX, e.clientY, rect);
          if (entityId !== -1) {
              if (this.editMode() === 'select' || this.editMode() === 'vertex') {
                  this.selectEntity(entityId, false);
                  return; 
              }
          }
          
          const geom = this.renderer.pickGeometry(e.clientX, e.clientY, rect);
          if ((this.editMode() === 'wall' || this.editMode() === 'polygon') && this.mapData) {
              const fallbackPlane = this.drawingPlane ?? new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
              const planePoint = this.renderer.pickDrawingPosition(e.clientX, e.clientY, rect, fallbackPlane);
              const point = resolveDraftPoint(geom?.point ?? null, planePoint, this.drawingPlane);
              if (point) this.addDraftPoint(point, geom);
              return;
          }
          if (geom && this.mapData) {
              const groupId = this.mapData.geometry.textureIds[geom.polyIndex];
              const flags = this.mapData.geometry.flags[geom.polyIndex];
              
              if (this.editMode() === 'select' || this.editMode() === 'vertex') {
                  this.selectedEntityId.set(-1);
                  this.renderer.selectEntity(-1, false);
                  
                  const texInfo = this.textureService.getTextureByGroup(groupId);
                  const displayId = texInfo ? texInfo.id : -1;
                  
                  this.selectedGeometry.set({
                      polyIndex: geom.polyIndex,
                      textureId: groupId,
                      displayTextureId: displayId,
                      flags: flags,
                      point: geom.point
                  });
                  this.sidebarTab.set('inspector');
                  this.renderer.highlightPolygon(geom.object as any, geom.polyIndex);
                  if (this.editMode() === 'vertex') this.renderer.showVertexHandles(this.mapData, geom.polyIndex);
              } 
              else if (this.editMode() === 'paint') {
                  this.updateMapTexture(geom.polyIndex, this.currentTextureId());
              }
          } else if ((this.editMode() === 'select' || this.editMode() === 'vertex') && entityId === -1) {
              this.selectedEntityId.set(-1);
              this.selectedGeometry.set(null);
              this.renderer.selectEntity(-1, false);
              this.renderer.clearHighlights();
          }
      }
  }


  private onGeometryVertexMoved(event: { polyIndex: number; vertexIndex: number; position: THREE.Vector3; dragSession: number }) {
      if (!this.mapData || this.editMode() !== 'vertex' || this.selectedGeometry()?.polyIndex !== event.polyIndex) return;
      const poly = this.mapData.geometry.polygons[event.polyIndex];
      const source = poly && this.mapData.geometry.sourceVertices[poly.vertexStart + event.vertexIndex];
      if (!source) return;
      const previousWorld = new THREE.Vector3(source.x * 128, source.z * 128, source.y * 128);
      if (this.vertexUndoSession !== event.dragSession) {
          this.pushUndo();
          this.vertexUndoSession = event.dragSession;
      }
      const error = this.geometryService.moveVertex(this.mapData.geometry, {
          polyIndex: event.polyIndex,
          vertexIndex: event.vertexIndex,
          vertex: { x: Math.round(event.position.x / 128), y: Math.round(event.position.z / 128), z: Math.round(event.position.y / 128) }
      });
      if (error) {
          this.renderer.restoreSelectedVertex(previousWorld);
          return;
      }
      this.renderer.refreshGeometry(this.mapData);
  }
  
  async saveMap() {
      if (!this.mapData) return;
      const validationErrors = this.mapValidation.validate(this.mapData);
      if (validationErrors.length) { alert(`Map cannot be saved:\n\n${validationErrors.join('\n')}`); return; }
      
      try {
          // The MapSerializer handles sorting sprites, updating script indices, compiling scripts, and patching the header.
          const success = this.mapService.saveMap(this.selectedMapId(), this.mapData);
          
          if (success) {
              this.editorService.clearDirty('maps', this.selectedMapId());
              this.editorService.notify('success', `Map ${this.selectedMapId()} saved to memory.`);
              this.loadMap(this.selectedMapId());
          } else {
              this.editorService.notify('error', 'Failed to save map.');
          }
      } catch (e: any) {
          this.editorService.notify('error', 'Error saving map: ' + e.message);
          console.error(e);
      }
  }
  
  updateMapTexture(polyIndex: number, newFlatTextureId: number) {
      if (!this.mapData) return;
      
      const tex = this.textureService.textureList().find(t => t.id === newFlatTextureId);
      if (!tex) return;
      
      const newGroupId = tex.groupId;
      this.mapData.geometry.textureIds[polyIndex] = newGroupId;
      if (this.mapData.geometry.polygons?.[polyIndex]) this.mapData.geometry.polygons[polyIndex].textureId = newGroupId;
      this.renderer.loadMapData(this.mapData);
      this.markMapDirty();
      
      if (this.selectedGeometry()?.polyIndex === polyIndex) {
          const old = this.selectedGeometry()!;
          this.selectedGeometry.set({ 
              ...old, 
              textureId: newGroupId,
              displayTextureId: newFlatTextureId 
          });
      }
  }

  private addDraftPoint(point: THREE.Vector3, geometryPick: { faceNormal: THREE.Vector3; object: THREE.Object3D } | null) {
      const snapped = new THREE.Vector3(Math.round(point.x / 128) * 128, Math.round(point.y / 128) * 128, Math.round(point.z / 128) * 128);
      const limit = this.editMode() === 'wall' ? 2 : 9;
      if (this.draftPoints().length >= limit) return;
      if (!this.mapData) return;
      const leaf = validateDraftLeaf(this.geometryService, this.mapData.geometry, snapped, this.draftLeafIndex);
      if (!leaf.valid) { alert(leaf.message); return; }

      if (!this.drawingPlane) {
          const normal = geometryPick
              ? geometryPick.faceNormal.clone().transformDirection(geometryPick.object.matrixWorld)
              : new THREE.Vector3(0, 1, 0);
          this.drawingPlane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, snapped);
          this.draftLeafIndex = leaf.leafIndex;
      } else {
          this.drawingPlane.projectPoint(snapped, snapped);
      }
      const points = [...this.draftPoints(), snapped];
      this.draftPoints.set(points);
      this.renderer.showGeometryPreview(points, this.editMode() === 'polygon');
  }

  confirmGeometryOperation() {
      if (!this.mapData) return;
      const points = this.draftPoints();
      const minimum = this.editMode() === 'wall' ? 2 : 3;
      if (points.length < minimum) return;
      const raw: MapVertexRecord[] = points.map(p => ({ x: Math.round(p.x / 128), y: Math.round(p.z / 128), z: Math.round(p.y / 128), u: 0, v: 0 }));
      const leafIndex = this.geometryService.findLeafAt(this.mapData.geometry, raw[0].x, raw[0].y);
      if (leafIndex < 0 || raw.some(v => this.geometryService.findLeafAt(this.mapData!.geometry, v.x, v.y) !== leafIndex)) {
          alert('The operation crosses BSP leaf bounds. A BSP builder is not available, so it is blocked.'); return;
      }
      this.pushUndo();
      try {
          const flags = this.editMode() === 'wall' ? wallAxisFromEndpoints(points[0], points[1]) | PolyFlag.WallTexture : 1;
          this.geometryService.addPolygon(this.mapData.geometry, { leafIndex, textureId: this.selectedMaterialGroup(), flags, vertices: raw });
          this.mapData.header.numPolys = this.mapData.geometry.polygons.length;
          this.mapData.header.numVerts = this.mapData.geometry.sourceVertices.length;
          this.renderer.loadMapData(this.mapData); this.cancelGeometryOperation();
      } catch (error) { this.undoGeometry(); alert((error as Error).message); }
  }

  cancelGeometryOperation() { this.draftPoints.set([]); this.drawingPlane = null; this.draftLeafIndex = null; this.renderer.clearGeometryPreview(); }
  private snapshot(): MapEditorSnapshot { return { geometry: this.geometryService.cloneEditable(this.mapData!.geometry), sprites: structuredClone(this.mapData!.sprites), scripts: this.currentScriptData() ? structuredClone(this.currentScriptData()!) : null }; }
  pushUndo() { if (!this.mapData) return; this.undoStack.update(s => [...s, this.snapshot()].slice(-50)); this.redoStack.set([]); }
  private restoreSnapshot(value: MapEditorSnapshot) { if (!this.mapData) return; this.mapData.geometry = value.geometry; this.mapData.sprites = value.sprites; this.mapData.scripts = value.scripts ?? undefined; this.currentScriptData.set(value.scripts); this.scriptService.restoreScriptSnapshot(this.selectedMapId(), value.scripts); this.spritesList.set([...value.sprites]); this.renderer.loadMapData(this.mapData); this.restoreVertexHandles(); }
  undoGeometry() { if (!this.mapData || !this.undoStack().length) return; const stack = [...this.undoStack()]; const previous = stack.pop()!; this.redoStack.update(s => [...s, this.snapshot()]); this.undoStack.set(stack); this.restoreSnapshot(previous); }
  redoGeometry() { if (!this.mapData || !this.redoStack().length) return; const stack = [...this.redoStack()]; const next = stack.pop()!; this.undoStack.update(s => [...s, this.snapshot()]); this.redoStack.set(stack); this.restoreSnapshot(next); }
  private restoreVertexHandles() { if (this.editMode() === 'vertex') this.renderer.showVertexHandles(this.mapData, this.selectedGeometry()?.polyIndex ?? null); }

  @HostListener('window:keydown.delete', ['$event'])
  deleteSelectedPolygon(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (this.editorService.activeTab() !== 'map' || this.selectedEntityId() !== -1 || !!target?.closest('input, textarea, select, [contenteditable="true"]')) return;
      const index = this.selectedGeometry()?.polyIndex;
      if (!this.mapData || index === undefined) return;
      this.pushUndo();
      try { this.geometryService.removePolygon(this.mapData.geometry, index); this.renderer.loadMapData(this.mapData); this.selectedGeometry.set(null); }
      catch (error) { this.undoGeometry(); alert((error as Error).message); }
  }
  
  setTextureForSelectedPoly(flatTexId: number) {
      const sel = this.selectedGeometry();
      if (sel) {
          this.updateMapTexture(sel.polyIndex, flatTexId);
      }
  }

  selectEntity(id: number, focusCamera: boolean = true) {
      this.selectedEntityId.set(id);
      this.selectedGeometry.set(null); 
      this.sidebarTab.set('inspector');
      this.renderer.selectEntity(id, focusCamera);
  }

  focusSelected() {
      const entityId = this.selectedEntityId();
      if (entityId !== -1) {
          this.renderer.selectEntity(entityId, true);
          return;
      }
      const geometry = this.selectedGeometry();
      if (geometry?.point) this.renderer.controls.focusAt(geometry.point);
  }
  
  async addEntity(template: EntityTemplate) {
      if (!this.mapData) return;
      
      let spawnPos: THREE.Vector3;
      const sel = this.selectedGeometry();
      
      if (sel && sel.point) {
          spawnPos = sel.point.clone();
      } else {
          const pos = this.renderer.getCameraPosition();
          const dir = this.renderer.getCameraDirection();
          // Place it 100 units in front of the camera (in world space)
          spawnPos = pos.add(dir.multiplyScalar(100));
      }
      
      // Create a sprite from the selected entity definition, never from the paint brush.
      // Convert world space to game space.
      // X and Z must be multiples of 8 (which corresponds to 128 world units)
      // because they are stored as a single byte (byte * 8) in the map file.
      const byteX = Math.round(spawnPos.x / 128.0);
      const byteZ = Math.round(spawnPos.z / 128.0);
      
      const gameX = byteX * 8;
      const gameZ = byteZ * 8;
      const floorHeight = this.coordinateService.getFloorHeight(this.mapData, gameX, gameZ);
      const requestedY = Math.round(spawnPos.y / 16.0);
      const newSprite: MapSprite = {
          x: gameX,
          y: template.type === 'normal' ? floorHeight + 32 : requestedY,
          z: gameZ, // World Z is Game Depth (spr.z)
          textureId: template.textureId,
          flags: template.flags & 0xffff,
          type: template.type,
          extraInfo: template.type === 'z' ? Math.max(0, Math.min(255, template.extraInfo)) : 0,
          flatIndex: 0,
          uuid: globalThis.crypto?.randomUUID?.() ?? `entity-${Date.now()}-${this.mapData.sprites.length}`
      };
      
      if (template.type === 'z') this.coordinateService.analyzeSpriteType(this.mapData, newSprite);
      const before = this.snapshot();
      // Add to map data
      newSprite.flatIndex = this.mapData.sprites.length;
      this.mapData.sprites.push(newSprite);
      const tileIndex = (gameZ >> 6) * 32 + (gameX >> 6);
      let actionCreated = true;
      if (template.action.kind === 'dialog') actionCreated = !!await this.scriptService.createDialogTileEvent(this.selectedMapId(), tileIndex, template.action.stringId, template.action.style);
      else if (template.action.kind === 'existing') actionCreated = !!await this.scriptService.addTileEvent(this.selectedMapId(), tileIndex, template.action.targetUid, template.action.flags);
      else if (template.action.kind === 'new-handler') actionCreated = !!await this.scriptService.createTileEventHandler(this.selectedMapId(), tileIndex, template.action.flags);
      if (!actionCreated) { this.restoreSnapshot(before); return; }
      this.undoStack.update(s => [...s, before].slice(-50)); this.redoStack.set([]);
      
      // Update UI
      this.spritesList.set([...this.mapData.sprites]);
      this.renderer.loadMapData(this.mapData);
      
      // Select the new entity
      this.selectEntity(this.mapData.sprites.length - 1, true);
      if (template.action.kind !== 'none') this.editorService.notifyScriptsChanged();
      this.markMapDirty();
  }
  
  swapSelectedEntity() {
      if (!this.mapData) return;
      const id = this.selectedEntityId();
      if (id === -1 || id <= 255) return; // Already safe or nothing selected
      const scripts = this.currentScriptData();
      const dependencies = scripts ? this.scriptService.getEntityReferences(scripts, this.mapData.sprites[id].uuid) : [];
      if (dependencies.some(reference => !reference.relocatable)) {
          alert(`Entity order cannot change because these references cannot be relocated safely:\n${dependencies.map(reference => reference.label).join('\n')}`);
          return;
      }
      this.pushUndo();
      
      // Get the UUID before sorting so we don't lose track of our sprite
      const targetUuid = this.mapData.sprites[id].uuid;
      
      // 1. Sort sprites first, so they are in their final order (normal then Z-sprites)
      this.mapService.sortSprites(this.mapData);
      
      // Update selected ID because it might have changed after sorting
      const newId = this.mapData.sprites.findIndex(s => s.uuid === targetUuid);
      if (newId === -1 || newId <= 255) {
          // It got sorted to < 255 automatically!
          this.selectEntity(newId, true);
          return;
      }
      
      const targetSprite = this.mapData.sprites[newId];
      const targetType = this.coordinateService.analyzeSpriteType(this.mapData, targetSprite).type;
      
      const usedIds = new Set<number>();
      
      // Find used IDs
      if (scripts) {
          for (const inst of scripts.instructions) {
              if (inst.referencedEntityId !== undefined) {
                  usedIds.add(inst.referencedEntityId);
              }
          }
      }
      
      // Find the first unused ID < 255 OF THE SAME TYPE
      let swapId = -1;
      for (let i = 0; i <= 255; i++) {
          if (i >= this.mapData.sprites.length) break; // Not enough sprites
          if (!usedIds.has(i)) {
              const type = this.coordinateService.analyzeSpriteType(this.mapData, this.mapData.sprites[i]).type;
              if (type === targetType) {
                  swapId = i;
                  break;
              }
          }
      }
      
      if (swapId !== -1) {
          // Swap them
          const temp = this.mapData.sprites[newId];
          this.mapData.sprites[newId] = this.mapData.sprites[swapId];
          this.mapData.sprites[swapId] = temp;
          
          // Re-sort to ensure everything is perfect (shouldn't change anything but good practice)
          this.mapService.sortSprites(this.mapData);
          
          // Find the new index of our target sprite
          const finalId = this.mapData.sprites.findIndex(s => s.uuid === targetSprite.uuid);
          
          // Update scripts with new indices
          if (scripts) {
              if (!this.scriptService.updateScriptIndices(scripts, this.mapData.sprites)) {
                  this.undoGeometry();
                  alert('Entity order was not changed because a script operand cannot represent the new sprite ID.');
                  return;
              }
          }
          
          // Update UI
          this.spritesList.set([...this.mapData.sprites]);
          this.renderer.loadMapData(this.mapData);
          this.selectEntity(finalId, true);
          this.markMapDirty();
      } else {
          alert(`No unused ${targetType} sprite ID < 255 found to swap with.`);
          console.warn(`No unused ${targetType} sprite ID < 255 found to swap with.`);
      }
  }
  
  onEntityUpdated() {
      if (!this.mapData) return;
      
      // Update the sprites list to trigger change detection
      this.spritesList.set([...this.mapData.sprites]);
      
      // Reload map data in renderer to reflect changes
      this.renderer.loadMapData(this.mapData);
      
      // Re-select the entity to update the inspector
      this.renderer.selectEntity(this.selectedEntityId(), false);
      this.markMapDirty();
  }

  onTileEventsChanged(tileIndex: number) {
      if (!this.mapData || tileIndex < 0 || tileIndex >= this.mapData.heightMap.length) return;
      this.editorService.notifyScriptsChanged();
      this.markMapDirty();
  }
  
  deleteSelectedEntity() {
      if (!this.mapData) return;
      const id = this.selectedEntityId();
      if (id === -1) return;
      
      const scripts = this.currentScriptData();
      const dependencies = scripts ? this.scriptService.getEntityReferences(scripts, this.mapData.sprites[id].uuid) : [];
      if (dependencies.length) { alert(`Entity cannot be deleted while scripts reference it:\n${dependencies.map(d => d.label).join('\n')}`); return; }
      this.pushUndo();
      // Remove from array
      this.mapData.sprites.splice(id, 1);
      this.mapData.sprites.forEach((s, i) => s.flatIndex = i);
      
      // Update scripts with new indices
      if (scripts) {
          if (!this.scriptService.updateScriptIndices(scripts, this.mapData.sprites)) {
              this.undoGeometry();
              alert('Entity was not deleted because the remaining script references could not be relocated.');
              return;
          }
      }
      
      // Update UI
      this.spritesList.set([...this.mapData.sprites]);
      this.renderer.loadMapData(this.mapData);
      
      // Clear selection
      this.selectedEntityId.set(-1);
      this.renderer.selectEntity(-1, false);
      this.sidebarTab.set('entities'); // Switch to entities list
      this.markMapDirty();
  }
  
  private processPendingSelection() {
      if (this.pendingSelection) {
          const req = this.pendingSelection;
          setTimeout(() => {
              if (this.pendingSelection === req) {
                  if (req.fromScript) {
                      this.renderer.geometry.showWalls.set(false);
                      this.renderer.geometry.showFlats.set(false);
                  }
                  this.selectEntity(req.entityId, true);
                  this.sidebarTab.set('entities');
                  this.pendingSelection = null;
              }
          }, 100);
      }
  }

  async loadMap(id: number) {
      if (this.isLoading() && this.selectedMapId() === id && this.mapData) return;
      if (!this.editorService.confirmResourceChange('maps', id)) return;
      this.selectedMapId.set(id);
      if (!this.fileService.isLoaded()) return;

      this.isLoading.set(true);
      
      try {
          if (!this.textureService.texturesLoaded()) {
              await this.textureService.loadTextures();
          }
          if (!this.entitiesService.isLoaded()) {
              await this.entitiesService.loadEntities();
          }
          await this.textureService.loadSkyTexture(id);

          this.mapData = await this.mapService.loadMap(id);
          if (this.mapData) {
              this.undoStack.set([]); this.redoStack.set([]); this.cancelGeometryOperation();
              this.spritesList.set([...this.mapData.sprites]);
              this.renderer.loadMapData(this.mapData);
              this.bspTree.set(this.mapData.bspTree);
              
              this.selectedNode.set(null);
              this.selectedEntityId.set(-1);
              this.selectedGeometry.set(null);
              this.renderer.selectEntity(-1, false); 
              this.renderer.clearHighlights();

              this.processPendingSelection();
              
              if (this.mapData.scripts) {
                  this.currentScriptData.set(this.mapData.scripts);
              } else {
                  this.currentScriptData.set(null);
              }
          }

      } catch (e) {
          console.error('Failed to load map', e);
      } finally {
          this.isLoading.set(false);
      }
  }

  private markMapDirty() {
      if (this.mapData) this.editorService.markDirty('maps', this.selectedMapId());
  }

  private decodeFlags(flags: number): string[] {
      const res: string[] = [];
      if (flags & (1 << 8)) res.push("NORTH");
      if (flags & (1 << 9)) res.push("SOUTH");
      if (flags & (1 << 10)) res.push("EAST");
      if (flags & (1 << 11)) res.push("WEST");
      if (flags & (1 << 13)) res.push("FLAT");
      if (flags & 64) res.push("WALL_TEX");
      if (flags & 8192) res.push("NPC_CHAT");
      return res;
  }

  // --- Script Interactions ---
  
  onJumpToScript(uid: string) {
      const data = this.currentScriptData();
      if (!data) return;
      const inst = data.instructions.find(i => i.uid === uid);
      if (inst) {
          this.editorService.goToScript(data.mapId, inst.offset);
      }
  }
}
