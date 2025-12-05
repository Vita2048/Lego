import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { BrickManager } from './BrickManager.js';
import { InteractionManager } from './InteractionManager.js';

// Scene setup
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xffffff); // White canvas

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(10, 10, 10);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth - 250, window.innerHeight); // Adjust for sidebar
renderer.shadowMap.enabled = true;
document.getElementById('canvas-container').appendChild(renderer.domElement);

// Controls
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

// Lights
const ambientLight = new THREE.AmbientLight(0x404040, 1.5); // Soft white light
scene.add(ambientLight);

const dirLight = new THREE.DirectionalLight(0xffffff, 2);
dirLight.position.set(10, 20, 10);
dirLight.castShadow = true;
scene.add(dirLight);

// Ground Plane
const planeGeometry = new THREE.PlaneGeometry(100, 100);
const planeMaterial = new THREE.MeshStandardMaterial({ color: 0xeeeeee });
const plane = new THREE.Mesh(planeGeometry, planeMaterial);
plane.rotation.x = -Math.PI / 2;
plane.receiveShadow = true;
plane.name = 'Ground';
scene.add(plane);

// Grid Helper
const gridHelper = new THREE.GridHelper(100, 100);
scene.add(gridHelper);

// Managers
const brickManager = new BrickManager(scene);
const interactionManager = new InteractionManager(scene, camera, renderer.domElement, brickManager);

// UI Integration
const brickMenu = document.getElementById('brick-menu');

// Add Mode Controls
const controlsContainer = document.createElement('div');
controlsContainer.style.padding = '10px';
controlsContainer.style.borderBottom = '1px solid #333';
controlsContainer.style.marginBottom = '10px';
controlsContainer.style.display = 'flex';
controlsContainer.style.gap = '10px';

const selectModeBtn = document.createElement('button');
selectModeBtn.textContent = 'Select Mode (Esc)';
selectModeBtn.style.padding = '5px 10px';
selectModeBtn.style.cursor = 'pointer';
selectModeBtn.onclick = () => {
    interactionManager.setMode('select');
    // Clear brick selection in menu
    document.querySelectorAll('.brick-item').forEach(el => el.classList.remove('selected'));
};

const deleteBtn = document.createElement('button');
deleteBtn.textContent = 'Delete (Del)';
deleteBtn.style.padding = '5px 10px';
deleteBtn.style.cursor = 'pointer';
deleteBtn.style.backgroundColor = '#ff4444';
deleteBtn.style.color = 'white';
deleteBtn.style.border = 'none';
deleteBtn.style.borderRadius = '4px';
deleteBtn.onclick = () => {
    interactionManager.deleteSelected();
};

controlsContainer.appendChild(selectModeBtn);
controlsContainer.appendChild(deleteBtn);

// Insert controls before the menu
const sidebar = document.getElementById('sidebar');
sidebar.insertBefore(controlsContainer, brickMenu);


brickManager.onBricksLoaded = (brickNames) => {
    brickMenu.innerHTML = ''; // Clear loading text if any

    brickNames.forEach(name => {
        const item = document.createElement('div');
        item.className = 'brick-item';

        const preview = document.createElement('div');
        preview.className = 'brick-preview';
        preview.textContent = 'Brick'; // Placeholder

        const label = document.createElement('div');
        label.className = 'brick-name';
        label.textContent = name;

        item.appendChild(preview);
        item.appendChild(label);

        item.addEventListener('click', (e) => {
            e.stopPropagation(); // Prevent click from reaching canvas
            // Highlight selection
            document.querySelectorAll('.brick-item').forEach(el => el.classList.remove('selected'));
            item.classList.add('selected');

            interactionManager.selectBrick(name);
        });

        brickMenu.appendChild(item);
    });
};

// Load assets
brickManager.loadBricks('/scene.gltf');

// Handle resize
window.addEventListener('resize', () => {
    const width = window.innerWidth - 250;
    const height = window.innerHeight;

    camera.aspect = width / height;
    camera.updateProjectionMatrix();

    renderer.setSize(width, height);
});

// Animation Loop
function animate() {
    requestAnimationFrame(animate);

    controls.update();
    renderer.render(scene, camera);
}

animate();
