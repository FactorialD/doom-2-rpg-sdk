
import { Injectable, signal, effect } from '@angular/core';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { isMapKeyboardControlAllowed } from './map-keyboard-control';

@Injectable({
  providedIn: 'root'
})
export class MapControlsService {
  flyMode = signal(false);
  flySpeed = signal(4000);

  private camera!: THREE.PerspectiveCamera;
  private controls!: OrbitControls;
  private keys = new Set<string>();
  
  // FPS Camera State
  private isRightMouseDown = false;
  private wheelSpeedMultiplier = 1;
  private wheelResetTimer: ReturnType<typeof setTimeout> | null = null;
  private lookSpeed = 0.0025;
  
  // Euler angles for stable FPS rotation (Y = Yaw, X = Pitch)
  private euler = new THREE.Euler(0, 0, 0, 'YXZ');
  private inputCanvas: HTMLCanvasElement | null = null;

  private readonly onKeyDown = (event: KeyboardEvent) => {
      if (event.code && isMapKeyboardControlAllowed(event.target)) this.keys.add(event.code.toLowerCase());
  };
  private readonly onKeyUp = (event: KeyboardEvent) => {
      if (event.code) this.keys.delete(event.code.toLowerCase());
  };
  private readonly onMouseDown = (event: MouseEvent) => {
      if (event.button !== 2) return;
      this.isRightMouseDown = true;
      if (this.flyMode()) this.euler.setFromQuaternion(this.camera.quaternion, 'YXZ');
  };
  private readonly onMouseUp = () => this.isRightMouseDown = false;
  private readonly onMouseMove = (event: MouseEvent) => {
      if (!this.flyMode() || !this.isRightMouseDown) return;
      this.euler.y -= (event.movementX || 0) * this.lookSpeed;
      this.euler.x -= (event.movementY || 0) * this.lookSpeed;
      const limit = Math.PI / 2 - 0.01;
      this.euler.x = Math.max(-limit, Math.min(limit, this.euler.x));
      this.camera.quaternion.setFromEuler(this.euler);
  };
  private readonly onContextMenu = (event: Event) => event.preventDefault();
  private readonly onWindowBlur = () => this.clearInputState();
  private readonly onVisibilityChange = () => {
      if (document.hidden) this.clearInputState();
  };
  private readonly onWheel = (event: WheelEvent) => {
      if (!this.flyMode()) return;
      this.wheelSpeedMultiplier = THREE.MathUtils.clamp(
          this.wheelSpeedMultiplier * (event.deltaY < 0 ? 1.25 : 0.8), 0.25, 4
      );
      if (this.wheelResetTimer) clearTimeout(this.wheelResetTimer);
      this.wheelResetTimer = setTimeout(() => {
          this.wheelSpeedMultiplier = 1;
          this.wheelResetTimer = null;
      }, 750);
      event.preventDefault();
  };

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
    this.dispose();
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

  setFlySpeed(speed: number) {
      if (Number.isFinite(speed)) this.flySpeed.set(THREE.MathUtils.clamp(speed, 250, 20000));
  }

  clearInputState() {
      this.keys.clear();
      this.isRightMouseDown = false;
  }

  resetView() {
      if (!this.camera || !this.controls) return;
      this.flyMode.set(false);
      this.camera.position.set(16384, 12000, 24000);
      this.controls.target.set(16384, 0, 16384);
      this.controls.update();
  }

  focusAt(point: THREE.Vector3) {
      if (!this.camera || !this.controls) return;
      this.flyMode.set(false);
      this.controls.target.copy(point);
      this.controls.update();
  }

  dispose() {
      const canvas = this.inputCanvas;
      window.removeEventListener('keydown', this.onKeyDown);
      window.removeEventListener('keyup', this.onKeyUp);
      window.removeEventListener('mouseup', this.onMouseUp);
      window.removeEventListener('mousemove', this.onMouseMove);
      window.removeEventListener('blur', this.onWindowBlur);
      document.removeEventListener('visibilitychange', this.onVisibilityChange);
      if (canvas) {
          canvas.removeEventListener('mousedown', this.onMouseDown);
          canvas.removeEventListener('contextmenu', this.onContextMenu);
          canvas.removeEventListener('wheel', this.onWheel);
      }
      if (this.wheelResetTimer) clearTimeout(this.wheelResetTimer);
      this.wheelResetTimer = null;
      this.wheelSpeedMultiplier = 1;
      this.clearInputState();
      this.controls?.dispose();
      this.inputCanvas = null;
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
      this.inputCanvas = canvas;
      window.addEventListener('keydown', this.onKeyDown);
      window.addEventListener('keyup', this.onKeyUp);
      window.addEventListener('mouseup', this.onMouseUp);
      window.addEventListener('mousemove', this.onMouseMove);
      window.addEventListener('blur', this.onWindowBlur);
      document.addEventListener('visibilitychange', this.onVisibilityChange);
      canvas.addEventListener('mousedown', this.onMouseDown);
      canvas.addEventListener('contextmenu', this.onContextMenu);
      canvas.addEventListener('wheel', this.onWheel, { passive: false });
  }

  private processFlyMovement(delta: number) {
      const baseSpeed = this.flySpeed() * this.wheelSpeedMultiplier;
      const speed = this.keys.has('shiftleft') || this.keys.has('shiftright') ? baseSpeed * 2.5 : baseSpeed;
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
