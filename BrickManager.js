import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

export class BrickManager {
  constructor(scene) {
    this.scene = scene;
    this.loader = new GLTFLoader();

    // Public templates map — used by main.js to detect Brick vs Plate by height
    this.brickTemplates = new Map();   // <-- THIS IS THE ONLY NEW LINE YOU NEED

    this.bricks = new Map();           // kept for backward compatibility / getBrick()
    this.onBricksLoaded = null;        // Callback

    // Will be calculated from brick geometry
    this.studSpacing = 0.8;   // Default, will be updated
    this.studHeight = 0.17;   // Height of studs
    this.brickHeight = 0.96;  // Standard brick height (will be calculated)
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
    // Reset maps
    this.bricks.clear();
    this.brickTemplates.clear();

    gltf.scene.traverse((child) => {
      if (child.isMesh) {
        // 1. Clean template for placement (deep clone of geometry + material)
        const brick = child.clone();
        brick.position.set(0, 0, 0);
        brick.rotation.set(0, 0, 0);
        brick.scale.set(1, 1, 1);

        // Center horizontally, bottom at Y=0
        brick.geometry.computeBoundingBox();
        const box = brick.geometry.boundingBox;
        const center = new THREE.Vector3();
        box.getCenter(center);
        brick.geometry.translate(-center.x, -box.min.y, -center.z);

        // Store clean clone for placement
        brick.geometry = brick.geometry.clone();
        brick.material = child.material.clone();

        this.bricks.set(child.name, brick);

        // 2. Raw template for height detection (no geometry clone needed, just the object)
        const templateForHeight = child.clone();
        templateForHeight.geometry.computeBoundingBox();
        const center2 = new THREE.Vector3();
        templateForHeight.geometry.boundingBox.getCenter(center2);
        templateForHeight.geometry.translate(-center2.x, -templateForHeight.geometry.boundingBox.min.y, -center2.z);

        this.brickTemplates.set(child.name, templateForHeight);

        // Detect stud spacing & brick height from any 2x2 brick/plate
        if (child.name.includes('2x2')) {
          templateForHeight.geometry.computeBoundingBox();
          const size = new THREE.Vector3();
          templateForHeight.geometry.boundingBox.getSize(size);

          this.studSpacing = Math.min(size.x, size.z) / 2;
          this.brickHeight = size.y;   // full height including studs

          // Estimate stud height (body is ~1.2× stud spacing)
          const expectedBody = this.studSpacing * 1.2;
          const calcStudHeight = size.y - expectedBody;

          if (calcStudHeight > 0.05 && calcStudHeight < 0.5) {
            this.studHeight = calcStudHeight;
            console.log('Dynamic studHeight:', this.studHeight);
          }

          console.log('Stud spacing:', this.studSpacing, 'Full height:', this.brickHeight);
        }
      }
    });

    console.log('Bricks processed:', this.bricks.size, 'templates ready');
    console.log('GLTF data available:', gltf ? 'Yes' : 'No');
    console.log('GLTF materials:', gltf?.materials ? gltf.materials.length : 'None');

    // Store GLTF data for color extraction
    this.gltfData = gltf;

    // Notify main.js that everything is ready
    if (this.onBricksLoaded) {
      console.log('Calling onBricksLoaded with:', Array.from(this.bricks.keys()).length, 'bricks and gltf:', gltf);
      this.onBricksLoaded(Array.from(this.bricks.keys()), gltf);
    } else {
      console.warn('onBricksLoaded callback not set');
    }
  }

  createBaseplate(studsX, studsZ) {
    const baseGroup = new THREE.Group();
    baseGroup.name = 'Baseplate';

    const width = studsX * this.studSpacing;
    const depth = studsZ * this.studSpacing;

    // Ground plate
    const plateGeometry = new THREE.BoxGeometry(width, 0.1, depth);
    const plateMaterial = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.3,
      metalness: 0.1
    });
    const plate = new THREE.Mesh(plateGeometry, plateMaterial);
    plate.position.y = -0.05;
    plate.name = 'Ground';
    plate.receiveShadow = true;
    baseGroup.add(plate);

    // Studs
    const studRadius = this.studSpacing * 0.3;
    const studGeometry = new THREE.CylinderGeometry(studRadius, studRadius, this.studHeight, 16);
    const studMaterial = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.3,
      metalness: 0.1
    });

    const studCount = studsX * studsZ;
    const studMesh = new THREE.InstancedMesh(studGeometry, studMaterial, studCount);
    studMesh.name = 'Ground';
    studMesh.receiveShadow = true;

    const matrix = new THREE.Matrix4();
    let idx = 0;
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
    if (!template) return null;

    const clone = template.clone();
    clone.geometry = template.geometry.clone();
    clone.material = template.material.clone();
    return clone;
  }

  // Method to get a brick with a specific color
  getBrickWithColor(baseName, colorName) {
    // First, find the base brick template
    const baseTemplate = this.bricks.get(baseName);
    if (!baseTemplate) return null;

    // Clone the base brick
    const clone = baseTemplate.clone();
    clone.geometry = baseTemplate.geometry.clone();

    // Always use colorMap for consistent basic colors
    const colorMap = {
        'Red': '#ff0000',
        'Blue': '#0000ff',
        'Green': '#00ff00',
        'Yellow': '#ffff00',
        'White': '#ffffff',
        'Black': '#000000',
        'Gray': '#808080',
        'Grey': '#808080',
        'Orange': '#ffa500',
        'Purple': '#800080',
        'Pink': '#ffc0cb',
        'Brown': '#8B4513',
        'Tan': '#D2B48C',
        'LightGray': '#D3D3D3',
        'DarkGray': '#A9A9A9',
        'Cyan': '#00FFFF',
        'Magenta': '#FF00FF',
        'Lime': '#00FF00',
        'Navy': '#000080',
        'Teal': '#008080',
        'Olive': '#808000',
        'Maroon': '#800000'
    };
    const hexColor = colorMap[colorName];
    if (hexColor) {
        // Create a new material with consistent properties
        clone.material = new THREE.MeshStandardMaterial({
            color: hexColor,
            roughness: 0.3,
            metalness: 0.1,
            transparent: false,
            opacity: 1.0
        });
    } else {
        // Fallback to white if color not found
        clone.material = new THREE.MeshStandardMaterial({
            color: '#ffffff',
            roughness: 0.3,
            metalness: 0.1,
            transparent: false,
            opacity: 1.0
        });
    }

    return clone;
  }
}