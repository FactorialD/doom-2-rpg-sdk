
import { Component, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { BspNode } from '../../../services/doom-map.service';

@Component({
  selector: 'app-bsp-tree',
  standalone: true,
  imports: [CommonModule],
  template: `
     <div class="h-full flex flex-col bg-neutral-900 border-l border-neutral-800">
         <div class="p-3 border-b border-neutral-800 font-bold text-xs text-neutral-400 uppercase tracking-wider shrink-0">
             BSP Tree Structure
         </div>
         
         <!-- Tree Scroll Area -->
         <div class="flex-1 overflow-y-auto custom-scrollbar p-2">
             @if (bspTree()) {
                 <ng-container *ngTemplateOutlet="nodeTemplate; context: { node: bspTree() }"></ng-container>
             } @else {
                 <div class="text-xs text-neutral-600 italic text-center mt-4">No map data</div>
             }
         </div>
         
         <!-- Details Footer -->
         <div class="p-3 border-t border-neutral-800 text-[10px] text-neutral-500 font-mono h-24 overflow-y-auto shrink-0 bg-neutral-950">
             @if (selectedNode(); as n) {
                 <div class="text-white font-bold mb-1">Node #{{n.id}} {{ n.isLeaf ? '(Leaf)' : '' }}</div>
                 <div>Bounds X: [{{n.bounds.minX.toFixed(1)}}, {{n.bounds.maxX.toFixed(1)}}]</div>
                 <div>Bounds Y: [{{n.bounds.minY.toFixed(1)}}, {{n.bounds.maxY.toFixed(1)}}]</div>
                 @if(n.isLeaf) {
                     <div class="text-green-500 mt-1">Leaf Idx: {{n.leafIndex}}</div>
                     <div>Polygons: {{n.polyCount}}</div>
                 }
             } @else {
                 Select a node to view details
             }
         </div>
     </div>

     <!-- Recursive Template -->
     <ng-template #nodeTemplate let-node="node">
          <div class="ml-2 text-xs font-mono">
              <div 
                (click)="onNodeClick(node); $event.stopPropagation()"
                class="cursor-pointer hover:text-white px-1 rounded flex items-center gap-1 transition-colors whitespace-nowrap"
                [class.text-red-500]="selectedNode() === node"
                [class.bg-red-900_20]="selectedNode() === node"
                [class.text-neutral-400]="selectedNode() !== node">
                  @if (node.isLeaf) {
                     <span class="text-[10px] text-green-600">☘</span>
                     <span>Leaf {{node.leafIndex}}</span>
                  } @else {
                     <span class="text-[10px] text-blue-400">◯</span>
                     <span>Node {{node.id}}</span>
                  }
              </div>
              
              @if (!node.isLeaf) {
                  <div class="border-l border-neutral-800 pl-1">
                      @if(node.left) { <ng-container *ngTemplateOutlet="nodeTemplate; context: { node: node.left }"></ng-container> }
                      @if(node.right) { <ng-container *ngTemplateOutlet="nodeTemplate; context: { node: node.right }"></ng-container> }
                  </div>
              }
          </div>
      </ng-template>
  `,
  styles: [`
    .custom-scrollbar::-webkit-scrollbar { width: 8px; height: 8px; }
    .custom-scrollbar::-webkit-scrollbar-track { background: #111; }
    .custom-scrollbar::-webkit-scrollbar-thumb { background: #333; border-radius: 4px; border: 2px solid #111; }
    .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #555; }
  `]
})
export class BspTreeComponent {
    bspTree = input<BspNode | null>(null);
    selectedNode = input<BspNode | null>(null);
    nodeSelected = output<BspNode>();

    onNodeClick(node: BspNode) {
        this.nodeSelected.emit(node);
    }
}
