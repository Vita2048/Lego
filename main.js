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

// Create a visual representation of the brick based on type and size
const createBrickThumbnail = (type, width, depth) => {
    // Create image element for thumbnail
    const img = document.createElement('img');

    // Ensure we use the correct thumbnail path - Bricks and Plates have different icons
    // Bricks are 2x taller than plates, so we need to use the appropriate icon
    const thumbnailPath = `lego_thumbnails/${type} ${width}x${depth}.png`;

    // Debug: log the thumbnail path being used
    console.log(`Creating thumbnail for ${type} ${width}x${depth}: ${thumbnailPath}`);

    img.src = thumbnailPath;
    img.width = 60;
    img.height = 60;
    img.style.objectFit = 'contain';

    // Add error handling for missing thumbnails
    img.onerror = () => {
        console.warn(`Thumbnail not found: ${thumbnailPath}`);
        // Fallback to a generic brick icon if available
        img.src = 'lego_thumbnails/Brick 2x2.png';
    };

    return img;
};


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
    // Create baseplate
    const baseplateInfo = brickManager.createBaseplate(60, 60);

    interactionManager.setStudGrid(
        brickManager.studSpacing,
        brickManager.studHeight,
        baseplateInfo.startX,
        baseplateInfo.startZ,
        brickManager.brickHeight
    );

    brickMenu.innerHTML = ''; 

    // key: `${type}_${width}x${depth}`, value: {type, width, depth, bricks: []}
    const sizeMap = new Map(); 

    brickNames.forEach(name => {
        const lowerName = name.toLowerCase();

        // Parse size
        let width = 2, depth = 2;
        const sizeMatch = name.match(/(\d+)x(\d+)/);
        if (sizeMatch) {
            width = parseInt(sizeMatch[1]);
            depth = parseInt(sizeMatch[2]);
        }

        // Determine type based on actual model height instead of name (to fix misclassification)
        const tempMesh = brickManager.brickTemplates.get(name).clone();
        const box = new THREE.Box3().setFromObject(tempMesh);
        const height = box.max.y - box.min.y;
        // Assuming brickManager.brickHeight is the full standard brick height (~9.6 units),
        // plates are ~1/3 that height (~3.2 units). Use a threshold like half the brick height.
        let type = (height < brickManager.brickHeight / 2) ? 'Plate' : 'Brick';

        const key = `${type}_${width}x${depth}`;
        
        if (!sizeMap.has(key)) {
            sizeMap.set(key, {type, width, depth, bricks: []});
        }
        sizeMap.get(key).bricks.push(name);
    });

    // Helper to extract clean colors
    const extractColor = (name, type, width, depth) => {
        const lowerName = name.toLowerCase();
        const typeLower = type.toLowerCase();
        
        // Remove known prefixes/suffixes to isolate color
        // Example: "Brick 2x2 Red" -> "Red"
        let tempName = name.replace(/brick/gi, '').replace(/plate/gi, '');
        tempName = tempName.replace(`${width}x${depth}`, '').replace(`${width}X${depth}`, '');
        tempName = tempName.replace(/_/g, ' ').trim();
        
        // If result is empty, fallback to original name
        return tempName || name;
    };

    // Convert Map to Array for Sorting
    const sortedItems = Array.from(sizeMap.values()).sort((a, b) => {
        // 1. Sort by Type (Brick first, then Plate)
        if (a.type !== b.type) return a.type.localeCompare(b.type);
        
        // 2. Sort by Width
        if (a.width !== b.width) return a.width - b.width;
        
        // 3. Sort by Depth
        return a.depth - b.depth;
    });

    // Generate Menu Items
    sortedItems.forEach(({type, width, depth, bricks}) => {
        const item = document.createElement('div');
        item.className = 'brick-item';

        const preview = document.createElement('div');
        preview.className = 'brick-preview';

        // Uses the specific icon: "Brick 2x2.png" or "Plate 2x2.png"
        const thumbnail = createBrickThumbnail(type, width, depth);
        preview.appendChild(thumbnail);

        const label = document.createElement('div');
        label.className = 'brick-name';
        label.textContent = `${type} ${width}x${depth}`;

        const colorSelect = document.createElement('select');
        colorSelect.className = 'color-select';
        colorSelect.style.width = '100%';
        colorSelect.style.marginTop = '5px';

        bricks.forEach(brick => {
            const color = extractColor(brick, type, width, depth);
            const option = document.createElement('option');
            option.value = brick;
            option.textContent = color;
            colorSelect.appendChild(option);
        });

        colorSelect.value = bricks[0];

        item.appendChild(preview);
        item.appendChild(label);
        item.appendChild(colorSelect);

        item.addEventListener('click', (e) => {
            e.stopPropagation();
            document.querySelectorAll('.brick-item').forEach(el => el.classList.remove('selected'));
            item.classList.add('selected');

            const selectedBrick = colorSelect.value;
            interactionManager.selectBrick(selectedBrick);
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

    const match = name.match(/Brick_(\d+x\d+)_(.+)/);
    if (match) return `${match[1]} ${match[2]}`;


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