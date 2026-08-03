
import { Injectable, signal, effect } from '@angular/core';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

@Injectable({
  providedIn: 'root'
})
export class MapControlsService {
  flyMode = signal(false);

  private camera!: THREE.PerspectiveCamera;
  private controls!: OrbitControls;
  private keys = new Set<string>();
  
  // FPS Camera State
  private isRightMouseDown = false;
  private flySpeed = 4000; // World units per second
  private lookSpeed = 0.0025;
  
  // Euler angles for stable FPS rotation (Y = Yaw, X = Pitch)
  private euler = new THREE.Euler(0, 0, 0, 'YXZ');

  constructor() {
      effect(() => {
          const flying = this.flyMode();
          
          if (this.controls && this.camera) {
              // 1. Critical: Disable OrbitControls completely in fly mode
              this.controls.enabled = !flying;
              
              if (flying) {
                  // Entering Fly Mode
                  // Sync internal Euler angles with current camera rotation to avoid jump start
                  this.euler.setFromQuaternion(this.camera.quaternion, 'YXZ');
                  
                  // Do NOT call controls.reset() - it teleports camera to origin
              } else {
                  // Exiting Fly Mode
                  // Set orbit target in front of camera so we rotate around what we were looking at
                  const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
                  const dist = 2000; 
                  const newTarget = this.camera.position.clone().add(forward.multiplyScalar(dist));
                  
                  this.controls.target.copy(newTarget);
                  this.controls.update();
              }
              
              // Reset input states
              this.keys.clear();
              this.isRightMouseDown = false;
          }
      });
  }

  init(camera: THREE.PerspectiveCamera, canvas: HTMLCanvasElement) {
    this.camera = camera;
    
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.1;
    this.controls.screenSpacePanning = true;
    this.controls.maxDistance = 500000;
    
    // Default to orbit
    this.controls.enabled = !this.flyMode();

    this.setupInputs(canvas);
  }
  
  get orbitControls() {
      return this.controls;
  }

  toggleFlyMode() {
      this.flyMode.update(v => !v);
  }

  update(delta: number) {
      if (this.flyMode()) {
        const d = Math.min(delta, 0.1); // Cap delta to prevent huge jumps on lag
        this.processFlyMovement(d);
      } else {
        this.controls.update();
      }
  }

  private setupInputs(canvas: HTMLCanvasElement) {
      window.addEventListener('keydown', (e) => {
          if (e.code) {
             this.keys.add(e.code.toLowerCase());
          }
      });
      window.addEventListener('keyup', (e) => {
          if (e.code) {
             this.keys.delete(e.code.toLowerCase());
          }
      });

      canvas.addEventListener('mousedown', (e) => {
          if (e.button === 2) { // Right Click
              this.isRightMouseDown = true;
              
              // Only prevent default if we are controlling camera to avoid context menu
              if (this.flyMode()) {
                  this.euler.setFromQuaternion(this.camera.quaternion, 'YXZ');
              }
          }
      });

      window.addEventListener('mouseup', () => {
          this.isRightMouseDown = false;
      });

      window.addEventListener('mousemove', (e) => {
          // Only rotate in fly mode if right mouse is held (FPS style)
          // Since OrbitControls is disabled, LMB won't rotate anymore.
          if (this.flyMode() && this.isRightMouseDown) {
              const movementX = e.movementX || 0;
              const movementY = e.movementY || 0;

              // Update Yaw (Y-axis) - Left/Right
              this.euler.y -= movementX * this.lookSpeed;

              // Update Pitch (X-axis) - Up/Down
              this.euler.x -= movementY * this.lookSpeed;

              // Clamp Pitch to avoid flipping (approx -90 to 90 degrees)
              const limit = Math.PI / 2 - 0.01;
              this.euler.x = Math.max(-limit, Math.min(limit, this.euler.x));

              // Apply rotation
              this.camera.quaternion.setFromEuler(this.euler);
          }
      });

      // Prevent context menu
      canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private processFlyMovement(delta: number) {
      const speed = this.keys.has('shiftleft') || this.keys.has('shiftright') ? this.flySpeed * 2.5 : this.flySpeed;
      const dist = speed * delta;

      // Calculate forward/right vectors based on current Yaw (ignore Pitch for movement to keep it flat-ish relative to horizon if preferred, but usually FPS flies in look dir)
      // Here we fly in look direction:
      const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);

      if (this.keys.has('keyw')) this.camera.position.addScaledVector(forward, dist);
      if (this.keys.has('keys')) this.camera.position.addScaledVector(forward, -dist);
      if (this.keys.has('keya')) this.camera.position.addScaledVector(right, -dist);
      if (this.keys.has('keyd')) this.camera.position.addScaledVector(right, dist);
      
      // Vertical movement global Y (Q/E)
      if (this.keys.has('keyq')) this.camera.position.y -= dist;
      if (this.keys.has('keye')) this.camera.position.y += dist;
  }
}
