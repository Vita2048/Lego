import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

export class BrickManager {
  constructor(scene) {
    this.scene = scene;
    this.loader = new GLTFLoader();
    this.bricks = new Map(); // Map<name, Mesh>
    this.onBricksLoaded = null; // Callback
  }

  loadBricks(url) {
    this.loader.load(
      url,
      (gltf) => {
        console.log('GLTF Loaded:', gltf);
        this.processGLTF(gltf);
      },
      (xhr) => {
        console.log((xhr.loaded / xhr.total * 100) + '% loaded');
      },
      (error) => {
        console.error('An error happened', error);
      }
    );
  }

  processGLTF(gltf) {
    // Traverse the scene and find all meshes
    gltf.scene.traverse((child) => {
      if (child.isMesh) {
        // Clone the mesh to ensure we have a clean template
        const brick = child.clone();

        // Reset position/rotation/scale just in case
        brick.position.set(0, 0, 0);
        brick.rotation.set(0, 0, 0);
        brick.scale.set(1, 1, 1);

        // Center the geometry but align bottom to 0
        brick.geometry.computeBoundingBox();
        const center = new THREE.Vector3();
        brick.geometry.boundingBox.getCenter(center);
        const min = brick.geometry.boundingBox.min;

        // Translate so that (0,0,0) is at the bottom center of the mesh
        brick.geometry.translate(-center.x, -min.y, -center.z);

        // Store in map
        this.bricks.set(child.name, brick);
      }
    });

    console.log('Bricks processed:', this.bricks);

    if (this.onBricksLoaded) {
      this.onBricksLoaded(Array.from(this.bricks.keys()));
    }
  }

  getBrick(name) {
    const template = this.bricks.get(name);
    if (template) {
      const clone = template.clone();
      // Deep clone geometry and material to prevent shared state
      clone.geometry = template.geometry.clone();
      clone.material = template.material.clone();
      return clone;
    }
    return null;
  }
}
