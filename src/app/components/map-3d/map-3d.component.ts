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
            (loadMap)="loadMap($event)"
            (editModeChange)="editMode.set($event)"
            (saveMap)="saveMap()"
            (addEntity)="addEntity($event)"
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
                    (entityUpdated)="onEntityUpdated()"
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
  undoStack = signal<MapGeometry[]>([]);
  redoStack = signal<MapGeometry[]>([]);
  
  selectedEntityId = signal<number>(-1);
  selectedGeometry = signal<GeometrySelection | null>(null);
  
  mapData: MapData | null = null;
  spritesList = signal<MapSprite[]>([]);
  
  currentScriptData = signal<ScriptData | null>(null);
  selectedMaterialGroup = computed(() => this.textureService.textureList().find(t => t.id === this.currentTextureId())?.groupId ?? 1);

  private mouseDownPos = { x: 0, y: 0 };
  private pendingSelection: EntitySelection | null = null;

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
          flagsDecoded: this.decodeFlags(sprite.flags)
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
              this.editorService.requestedEntitySelection.set(null);
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
  }

  ngAfterViewInit(): void {
    this.renderer.init(this.canvasRef.nativeElement);
    
    this.renderer.entityMoved.subscribe(({id, position}) => {
        if (!this.mapData) return;
        const sprite = this.mapData.sprites[id];
        if (sprite) {
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
        }
    });

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
          
          const entityId = this.renderer.pickObject(e.clientX, e.clientY, rect);
          if (entityId !== -1) {
              if (this.editMode() === 'select') {
                  this.selectEntity(entityId, false);
                  return; 
              }
          }
          
          const geom = this.renderer.pickGeometry(e.clientX, e.clientY, rect);
          if (geom && this.mapData) {
              const groupId = this.mapData.geometry.textureIds[geom.polyIndex];
              const flags = this.mapData.geometry.flags[geom.polyIndex];
              
              if (this.editMode() === 'select') {
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
              } 
              else if (this.editMode() === 'paint') {
                  this.updateMapTexture(geom.polyIndex, this.currentTextureId());
              } else {
                  this.addDraftPoint(geom.point);
              }
          } else if (this.editMode() === 'select' && entityId === -1) {
              this.selectedEntityId.set(-1);
              this.selectedGeometry.set(null);
              this.renderer.selectEntity(-1, false);
              this.renderer.clearHighlights();
          }
      }
  }
  
  async saveMap() {
      if (!this.mapData) return;
      const validationErrors = this.mapValidation.validate(this.mapData);
      if (validationErrors.length) { alert(`Map cannot be saved:\n\n${validationErrors.join('\n')}`); return; }
      
      try {
          // The MapSerializer handles sorting sprites, updating script indices, compiling scripts, and patching the header.
          const success = this.mapService.saveMap(this.selectedMapId(), this.mapData);
          
          if (success) {
              alert(`Map ${this.selectedMapId()} saved! You can download the JAR now.`);
              this.loadMap(this.selectedMapId());
          } else {
              alert('Failed to save map.');
          }
      } catch (e: any) {
          alert('Error saving map: ' + e.message);
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
      
      if (this.selectedGeometry()?.polyIndex === polyIndex) {
          const old = this.selectedGeometry()!;
          this.selectedGeometry.set({ 
              ...old, 
              textureId: newGroupId,
              displayTextureId: newFlatTextureId 
          });
      }
  }

  private addDraftPoint(point: THREE.Vector3) {
      const snapped = new THREE.Vector3(Math.round(point.x / 128) * 128, Math.round(point.y / 128) * 128, Math.round(point.z / 128) * 128);
      const limit = this.editMode() === 'wall' ? 2 : 9;
      if (this.draftPoints().length >= limit) return;
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
          const flags = this.editMode() === 'wall' ? PolyFlag.AxisZ | PolyFlag.WallTexture : 1;
          this.geometryService.addPolygon(this.mapData.geometry, { leafIndex, textureId: this.selectedMaterialGroup(), flags, vertices: raw });
          this.mapData.header.numPolys = this.mapData.geometry.polygons.length;
          this.mapData.header.numVerts = this.mapData.geometry.sourceVertices.length;
          this.renderer.loadMapData(this.mapData); this.cancelGeometryOperation();
      } catch (error) { this.undoGeometry(); alert((error as Error).message); }
  }

  cancelGeometryOperation() { this.draftPoints.set([]); this.renderer.clearGeometryPreview(); }
  private pushUndo() { if (!this.mapData) return; this.undoStack.update(s => [...s, this.geometryService.cloneEditable(this.mapData!.geometry)].slice(-50)); this.redoStack.set([]); }
  undoGeometry() { if (!this.mapData || !this.undoStack().length) return; const stack = [...this.undoStack()]; const previous = stack.pop()!; this.redoStack.update(s => [...s, this.geometryService.cloneEditable(this.mapData!.geometry)]); this.undoStack.set(stack); this.mapData.geometry = previous; this.renderer.loadMapData(this.mapData); }
  redoGeometry() { if (!this.mapData || !this.redoStack().length) return; const stack = [...this.redoStack()]; const next = stack.pop()!; this.undoStack.update(s => [...s, this.geometryService.cloneEditable(this.mapData!.geometry)]); this.redoStack.set(stack); this.mapData.geometry = next; this.renderer.loadMapData(this.mapData); }

  @HostListener('window:keydown.delete')
  deleteSelectedPolygon() {
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
  
  addEntity(template: EntityTemplate) {
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
      
      const newSprite: MapSprite = {
          x: byteX * 8,
          y: Math.max(0, Math.min(255, Math.round(spawnPos.y / 16.0) + 32)),
          z: byteZ * 8, // World Z is Game Depth (spr.z)
          textureId: template.textureId,
          flags: template.flags & 0xffff,
          type: template.type,
          extraInfo: template.type === 'z' ? Math.max(0, Math.min(255, template.extraInfo)) : 0,
          flatIndex: 0,
          uuid: globalThis.crypto?.randomUUID?.() ?? `entity-${Date.now()}-${this.mapData.sprites.length}`
      };
      
      // Add to map data
      newSprite.flatIndex = this.mapData.sprites.length;
      this.mapData.sprites.push(newSprite);
      
      // Update UI
      this.spritesList.set([...this.mapData.sprites]);
      this.renderer.loadMapData(this.mapData);
      
      // Select the new entity
      this.selectEntity(this.mapData.sprites.length - 1, true);
  }
  
  swapSelectedEntity() {
      if (!this.mapData) return;
      const id = this.selectedEntityId();
      if (id === -1 || id <= 255) return; // Already safe or nothing selected
      
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
      
      const scripts = this.currentScriptData();
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
              this.scriptService.updateScriptIndices(scripts, this.mapData.sprites);
          }
          
          // Update UI
          this.spritesList.set([...this.mapData.sprites]);
          this.renderer.loadMapData(this.mapData);
          this.selectEntity(finalId, true);
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
  }

  onTileEventsChanged(tileIndex: number) {
      if (!this.mapData || tileIndex < 0 || tileIndex >= this.mapData.heightMap.length) return;
      const hasEvents = this.currentScriptData()?.tileEventRefs.some(ref => ref.tileIndex === tileIndex) ?? false;
      // Game.executeTile only examines tiles carrying the event marker bit.
      this.mapData.heightMap[tileIndex] = hasEvents
          ? this.mapData.heightMap[tileIndex] | 0x40
          : this.mapData.heightMap[tileIndex] & ~0x40;
      this.editorService.notifyScriptsChanged();
  }
  
  deleteSelectedEntity() {
      if (!this.mapData) return;
      const id = this.selectedEntityId();
      if (id === -1) return;
      
      // Remove from array
      this.mapData.sprites.splice(id, 1);
      this.mapData.sprites.forEach((s, i) => s.flatIndex = i);
      
      // Update scripts with new indices
      const scripts = this.currentScriptData();
      if (scripts) {
          this.scriptService.updateScriptIndices(scripts, this.mapData.sprites);
      }
      
      // Update UI
      this.spritesList.set([...this.mapData.sprites]);
      this.renderer.loadMapData(this.mapData);
      
      // Clear selection
      this.selectedEntityId.set(-1);
      this.renderer.selectEntity(-1, false);
      this.sidebarTab.set('entities'); // Switch to entities list
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
                  this.pendingSelection = null;
              }
          }, 100);
      }
  }

  async loadMap(id: number) {
      if (this.isLoading() && this.selectedMapId() === id && this.mapData) return;
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
