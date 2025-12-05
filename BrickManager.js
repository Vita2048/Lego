import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

export class BrickManager {
  constructor(scene) {
    this.scene = scene;
    this.loader = new GLTFLoader();
    this.bricks = new Map(); // Map<name, Mesh>
    this.onBricksLoaded = null; // Callback

    // Will be calculated from brick geometry
    this.studSpacing = 0.8; // Default, will be updated
    this.studHeight = 0.17; // Height of studs for interlocking
    this.brickHeight = 0.96; // Standard brick height (will be calculated)
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

        // Calculate stud spacing from 2x2 brick (width = 2 studs)
        if (child.name.includes('2x2')) {
          brick.geometry.computeBoundingBox();
          const size = new THREE.Vector3();
          brick.geometry.boundingBox.getSize(size);
          // 2x2 brick spans 2 studs, so divide by 2
          this.studSpacing = Math.min(size.x, size.z) / 2;
          this.brickHeight = size.y;
          console.log('Calculated stud spacing:', this.studSpacing, 'brick height:', this.brickHeight);
        }
      }
    });

    console.log('Bricks processed:', this.bricks);

    if (this.onBricksLoaded) {
      this.onBricksLoaded(Array.from(this.bricks.keys()));
    }
  }

  // Create a baseplate of white flat tiles
  createBaseplate(studsX, studsZ) {
    const baseGroup = new THREE.Group();
    baseGroup.name = 'Baseplate';

    // Create a flat white surface with stud grid
    const width = studsX * this.studSpacing;
    const depth = studsZ * this.studSpacing;

    // Main plate surface
    const plateGeometry = new THREE.BoxGeometry(width, 0.1, depth);
    const plateMaterial = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.3,
      metalness: 0.1
    });
    const plate = new THREE.Mesh(plateGeometry, plateMaterial);
    plate.position.set(0, -0.05, 0); // Slightly below ground so top is at y=0
    plate.name = 'Ground';
    plate.receiveShadow = true;
    baseGroup.add(plate);

    // Add studs on top
    const studRadius = this.studSpacing * 0.3;
    const studGeometry = new THREE.CylinderGeometry(studRadius, studRadius, this.studHeight, 16);
    const studMaterial = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.3,
      metalness: 0.1
    });

    // Create instanced mesh for performance
    const studCount = studsX * studsZ;
    const studMesh = new THREE.InstancedMesh(studGeometry, studMaterial, studCount);
    studMesh.name = 'Ground'; // So raycasting treats studs as ground

    const matrix = new THREE.Matrix4();
    let idx = 0;

    // Calculate starting position (centered)
    const startX = -width / 2 + this.studSpacing / 2;
    const startZ = -depth / 2 + this.studSpacing / 2;

    for (let x = 0; x < studsX; x++) {
      for (let z = 0; z < studsZ; z++) {
        const posX = startX + x * this.studSpacing;
        const posZ = startZ + z * this.studSpacing;
        matrix.setPosition(posX, this.studHeight / 2, posZ);
        studMesh.setMatrixAt(idx++, matrix);
      }
    }

    studMesh.instanceMatrix.needsUpdate = true;
    studMesh.receiveShadow = true;
    baseGroup.add(studMesh);

    this.scene.add(baseGroup);

    return {
      width,
      depth,
      studSpacing: this.studSpacing,
      startX,
      startZ
    };
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
