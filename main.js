import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { BrickManager } from './BrickManager.js';
import { InteractionManager } from './InteractionManager.js';

// Scene setup
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87ceeb); // Light sky blue background

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(30, 30, 30);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth - 500, window.innerHeight); // Adjust for 2 sidebars (250px each)
renderer.shadowMap.enabled = true;
document.getElementById('canvas-container').appendChild(renderer.domElement);

// Controls
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

// Lights
const ambientLight = new THREE.AmbientLight(0x404040, 1.5); // Soft white light
scene.add(ambientLight);

const dirLight = new THREE.DirectionalLight(0xffffff, 2);
dirLight.position.set(30, 50, 30);
dirLight.castShadow = true;
dirLight.shadow.mapSize.width = 2048;
dirLight.shadow.mapSize.height = 2048;
dirLight.shadow.camera.near = 1;
dirLight.shadow.camera.far = 200;
dirLight.shadow.camera.left = -50;
dirLight.shadow.camera.right = 50;
dirLight.shadow.camera.top = 50;
dirLight.shadow.camera.bottom = -50;
scene.add(dirLight);

// Managers
const brickManager = new BrickManager(scene);
const interactionManager = new InteractionManager(scene, camera, renderer.domElement, brickManager, controls);

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
    // Create the 60x60 stud white baseplate
    const baseplateInfo = brickManager.createBaseplate(60, 60);
    console.log('Baseplate created:', baseplateInfo);

    // Configure InteractionManager with stud grid settings
    interactionManager.setStudGrid(
        brickManager.studSpacing,
        brickManager.studHeight,
        baseplateInfo.startX,
        baseplateInfo.startZ,
        brickManager.brickHeight
    );

    brickMenu.innerHTML = ''; // Clear loading text if any

    brickNames.forEach(name => {
        const item = document.createElement('div');
        item.className = 'brick-item';

        const preview = document.createElement('div');
        preview.className = 'brick-preview';

        // Create a visual representation of the brick based on its name
        const createBrickThumbnail = (brickName) => {
            const canvas = document.createElement('canvas');
            canvas.width = 60;
            canvas.height = 60;

            const ctx = canvas.getContext('2d');

            // Parse brick name to determine size and color - handle multiple formats
            let width = 2, depth = 2, colorName = 'Gray';
            let match;

            // Try standard format: Brick_2x4_Red
            match = brickName.match(/Brick_(\d+)x(\d+)_(.+)/);
            if (match) {
                width = parseInt(match[1]);
                depth = parseInt(match[2]);
                colorName = match[3];
            }
            // Try alternative format: 2x4_Red_Brick
            else if ((match = brickName.match(/(\d+)x(\d+)_(.+)_Brick/))) {
                width = parseInt(match[1]);
                depth = parseInt(match[2]);
                colorName = match[3];
            }
            // Try format without "Brick": 2x4_Red
            else if ((match = brickName.match(/(\d+)x(\d+)_(.+)/))) {
                width = parseInt(match[1]);
                depth = parseInt(match[2]);
                colorName = match[3];
            }
            // Try format with underscore variations
            else if ((match = brickName.match(/(\d+)x(\d+)/))) {
                width = parseInt(match[1]);
                depth = parseInt(match[2]);
                // Try to extract color from remaining parts
                const colorMatch = brickName.match(/(Red|Blue|Green|Yellow|White|Black|Gray|Orange|Purple|Pink)/i);
                if (colorMatch) {
                    colorName = colorMatch[1];
                }
            }

            // Extended color mapping with more LEGO colors
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

            // Case-insensitive color lookup
            const normalizedColor = colorName.charAt(0).toUpperCase() + colorName.slice(1).toLowerCase();
            const brickColor = colorMap[normalizedColor] || colorMap[colorName] || '#aaaaaa';

            // Draw brick representation
            ctx.fillStyle = '#333333';
            ctx.fillRect(0, 0, 60, 60);

            // Calculate stud positions - make more compact for better visibility
            const studSize = 3;
            const spacing = 6;
            const startX = (60 - (width * spacing)) / 2;
            const startY = (60 - (depth * spacing)) / 2;

            // Draw brick body
            ctx.fillStyle = brickColor;
            ctx.fillRect(
                startX - 2,
                startY - 2,
                width * spacing + 4,
                depth * spacing + 4
            );

            // Draw studs
            ctx.fillStyle = '#ffffff';
            for (let x = 0; x < width; x++) {
                for (let y = 0; y < depth; y++) {
                    ctx.beginPath();
                    ctx.arc(
                        startX + x * spacing + spacing/2,
                        startY + y * spacing + spacing/2,
                        studSize,
                        0,
                        Math.PI * 2
                    );
                    ctx.fill();
                }
            }

            // Add some shading for 3D effect
            ctx.fillStyle = 'rgba(0, 0, 0, 0.15)';
            ctx.fillRect(
                startX - 2,
                startY - 2,
                width * spacing + 4,
                2
            );
            ctx.fillRect(
                startX - 2,
                startY - 2,
                2,
                depth * spacing + 4
            );

            // Add brick name abbreviation for better identification
            ctx.fillStyle = '#ffffff';
            ctx.font = '8px Arial';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'bottom';
            ctx.fillText(brickName.substring(0, 10), 30, 58);

            return canvas;
        };

        // Create and add the thumbnail
        const thumbnailCanvas = createBrickThumbnail(name);
        preview.appendChild(thumbnailCanvas);

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
    const width = window.innerWidth - 500; // Adjust for left and right sidebars (250 + 250)
    const height = window.innerHeight;

    camera.aspect = width / height;
    camera.updateProjectionMatrix();

    renderer.setSize(width, height);
});

// UI List Logic
const placedBricksList = document.getElementById('placed-bricks-list');
const groupBtn = document.getElementById('group-btn');
const ungroupBtn = document.getElementById('ungroup-btn');

let lastSelectedUuid = null;

function formatBrickName(name) {
    if (name === 'Group') return 'Group';
    // Match "Brick_2x4_Red" -> "2x4 Red"
    const match = name.match(/Brick_(\d+x\d+)_(.+)/);
    if (match) {
        return `${match[1]} ${match[2]}`;
    }
    return name;
}

function createBrickListItem(brick) {
    const li = document.createElement('li');
    li.className = 'placed-brick-item';
    li.dataset.uuid = brick.uuid;

    // Create label with name and coordinates hint
    const label = document.createElement('span');
    label.textContent = formatBrickName(brick.name);

    // Minimal hint for groups or bricks
    const coordHint = document.createElement('span');
    coordHint.className = 'coord-hint';
    const x = Math.round(brick.position.x * 10) / 10;
    const z = Math.round(brick.position.z * 10) / 10;
    coordHint.textContent = `(${x}, ${z})`;

    const contentDiv = document.createElement('div');
    contentDiv.style.display = 'flex';
    contentDiv.style.justifyContent = 'space-between';
    contentDiv.style.width = '100%';
    contentDiv.appendChild(label);
    contentDiv.appendChild(coordHint);

    li.appendChild(contentDiv);

    // If it's a group, add children container
    if (brick.name === 'Group' && brick.children.length > 0) {
        const ul = document.createElement('ul');
        ul.style.paddingLeft = '15px';
        ul.style.listStyle = 'none';
        ul.style.marginTop = '5px';

        brick.children.forEach(child => {
            if (child.isMesh || child.isGroup) {
                ul.appendChild(createBrickListItem(child));
            }
        });
        li.appendChild(ul);
    }

    li.addEventListener('click', (e) => {
        e.stopPropagation();

        if (e.shiftKey && lastSelectedUuid) {
            // Shift+Click: Range Selection
            const allItems = Array.from(document.querySelectorAll('.placed-brick-item'));
            const lastIdx = allItems.findIndex(el => el.dataset.uuid === lastSelectedUuid);
            const currentIdx = allItems.findIndex(el => el.dataset.uuid === brick.uuid);

            if (lastIdx !== -1 && currentIdx !== -1) {
                const start = Math.min(lastIdx, currentIdx);
                const end = Math.max(lastIdx, currentIdx);
                const rangeItems = allItems.slice(start, end + 1);
                const uuids = rangeItems.map(el => el.dataset.uuid);

                interactionManager.selectObjectsByUuids(uuids);
            }
        } else if (e.ctrlKey || e.metaKey) {
            // Ctrl+Click: Toggle
            interactionManager.toggleSelectionByUuid(brick.uuid);
            lastSelectedUuid = brick.uuid; // Update anchor
        } else {
            // Single Click
            interactionManager.selectObjectByUuid(brick.uuid);
            lastSelectedUuid = brick.uuid; // Update anchor
        }
    });

    return li;
}

function renderBrickList() {
    placedBricksList.innerHTML = '';

    // Only render top-level placed bricks
    interactionManager.placedBricks.forEach(brick => {
        const li = createBrickListItem(brick);
        placedBricksList.appendChild(li);
    });
}

// Subscribe to InteractionManager events
interactionManager.onBrickAdded = (brick) => {
    // Re-render entire list to handle hierarchy changes safely
    renderBrickList();
};

interactionManager.onBrickRemoved = (uuid) => {
    // Re-render entire list
    renderBrickList();
};

interactionManager.onSelectionChanged = (selectedUuids) => {
    // Remove selection from all items
    document.querySelectorAll('.placed-brick-item').forEach(el => el.classList.remove('selected'));

    // selectedUuids is now an Array (or empty array)
    const uuids = Array.isArray(selectedUuids) ? selectedUuids : (selectedUuids ? [selectedUuids] : []);
    const selectedCount = uuids.length;
    let anyGroupSelected = false;

    uuids.forEach(uuid => {
        const li = document.querySelector(`li[data-uuid="${uuid}"]`);
        if (li) {
            li.classList.add('selected');
            if (uuids.indexOf(uuid) === 0) {
                // li.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }

            // Update last selected if single selection (to sync external changes)
            if (uuids.length === 1) lastSelectedUuid = uuid;
        }

        const obj = interactionManager.placedBricks.find(b => b.uuid === uuid);
        if (obj && obj.name === 'Group') {
            anyGroupSelected = true;
        }
    });

    // Update button states
    if (groupBtn) groupBtn.disabled = selectedCount < 2;
    if (ungroupBtn) ungroupBtn.disabled = !(selectedCount === 1 && anyGroupSelected);
};

// Button Handlers
if (groupBtn) {
    groupBtn.onclick = () => {
        interactionManager.groupSelected();
    };
}

if (ungroupBtn) {
    ungroupBtn.onclick = () => {
        interactionManager.ungroupSelected();
    };
}

// Initial resize to fit layout
window.dispatchEvent(new Event('resize'));

// Animation Loop
function animate() {
    requestAnimationFrame(animate);

    controls.update();
    renderer.render(scene, camera);
}

animate();
