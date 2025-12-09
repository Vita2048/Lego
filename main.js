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

const base = import.meta.env.BASE_URL;

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
    const thumbnailPath = `${base}lego_thumbnails/${type} ${width}x${depth}.png`;

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
        img.src = `${base}Brick 2x2.png`;
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

const duplicateBtn = document.createElement('button');
duplicateBtn.textContent = 'Duplicate';
duplicateBtn.style.padding = '5px 10px';
duplicateBtn.style.cursor = 'pointer';
duplicateBtn.disabled = true;
duplicateBtn.onclick = () => {
    interactionManager.duplicateSelected();
};

controlsContainer.appendChild(selectModeBtn);
controlsContainer.appendChild(deleteBtn);
controlsContainer.appendChild(duplicateBtn);

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
brickManager.loadBricks(`${base}scene.gltf`);

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

    const parts = name.split('_');
    if (parts.length >= 2) {
        return `${parts[0]} ${parts[1]}`;
    }

    return name;
}


function createBrickListItem(brick) {
    const li = document.createElement('li');
    li.className = 'placed-brick-item';
    li.dataset.uuid = brick.uuid;

    // Create label with name
    const label = document.createElement('span');
    label.textContent = formatBrickName(brick.name);

    const contentDiv = document.createElement('div');
    contentDiv.style.display = 'flex';
    contentDiv.style.justifyContent = 'space-between';
    contentDiv.style.width = '100%';
    contentDiv.appendChild(label);

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
    if (duplicateBtn) duplicateBtn.disabled = selectedCount === 0;
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

// Menu functionality
const newFileBtn = document.getElementById('new-file');
const saveFileBtn = document.getElementById('save-file');
const loadFileBtn = document.getElementById('load-file');

newFileBtn.addEventListener('click', () => {
    handleNewFile();
});

saveFileBtn.addEventListener('click', () => {
    handleSaveFile();
});

loadFileBtn.addEventListener('click', () => {
    handleLoadFile();
});

// Check if canvas has content
function hasCanvasContent() {
    return interactionManager.placedBricks.length > 0;
}

// Handle New File
function handleNewFile() {
    if (hasCanvasContent()) {
        const saveFirst = confirm('The canvas is not empty. Do you want to save your work first?');
        if (saveFirst) {
            handleSaveFile(() => {
                clearCanvas();
            });
        } else {
            clearCanvas();
        }
    } else {
        clearCanvas();
    }
}

// Clear all bricks from canvas
function clearCanvas() {
    // Remove all placed bricks from scene
    interactionManager.placedBricks.forEach(brick => {
        scene.remove(brick);
    });

    // Clear the placed bricks array
    interactionManager.placedBricks = [];

    // Clear selection
    interactionManager.deselectAll();

    // Update UI
    renderBrickList();
}

// Handle Save File
function handleSaveFile(callback) {
    const xmlData = serializeCanvasToXML();
    downloadXML(xmlData, 'lego-model.xml');

    if (callback) callback();
}

// Handle Load File
function handleLoadFile() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.xml';
    input.onchange = (event) => {
        const file = event.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (e) => {
                const xmlContent = e.target.result;
                deserializeXMLToCanvas(xmlContent);
            };
            reader.readAsText(file);
        }
    };
    input.click();
}

// Serialize canvas to XML
function serializeCanvasToXML() {
    const bricks = interactionManager.placedBricks;

    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
    xml += '<lego-model>\n';

    bricks.forEach(brick => {
        xml += serializeBrickToXML(brick);
    });

    xml += '</lego-model>\n';
    return xml;
}

// Serialize a single brick or group to XML
function serializeBrickToXML(brick) {
    let xml = '';

    if (brick.isGroup) {
        xml += `  <group name="${brick.name}" uuid="${brick.uuid}">\n`;
        xml += `    <position x="${brick.position.x}" y="${brick.position.y}" z="${brick.position.z}" />\n`;
        xml += `    <rotation x="${brick.rotation.x}" y="${brick.rotation.y}" z="${brick.rotation.z}" />\n`;
        xml += `    <scale x="${brick.scale.x}" y="${brick.scale.y}" z="${brick.scale.z}" />\n`;

        // Serialize children
        brick.children.forEach(child => {
            if (child.isMesh || child.isGroup) {
                xml += '    ' + serializeBrickToXML(child).replace(/\n/g, '\n    ').trim() + '\n';
            }
        });

        xml += '  </group>\n';
    } else {
        xml += `  <brick name="${brick.name}" uuid="${brick.uuid}">\n`;
        xml += `    <position x="${brick.position.x}" y="${brick.position.y}" z="${brick.position.z}" />\n`;
        xml += `    <rotation x="${brick.rotation.x}" y="${brick.rotation.y}" z="${brick.rotation.z}" />\n`;
        xml += `    <scale x="${brick.scale.x}" y="${brick.scale.y}" z="${brick.scale.z}" />\n`;
        xml += '  </brick>\n';
    }

    return xml;
}

// Deserialize XML to canvas
function deserializeXMLToCanvas(xmlContent) {
    // Clear current canvas
    clearCanvas();

    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlContent, 'text/xml');

    const modelElement = xmlDoc.getElementsByTagName('lego-model')[0];
    if (!modelElement) {
        alert('Invalid XML file format');
        return;
    }

    // Process all top-level bricks and groups
    const elements = modelElement.children;
    for (let i = 0; i < elements.length; i++) {
        const element = elements[i];
        if (element.tagName === 'brick' || element.tagName === 'group') {
            const brick = deserializeBrickFromXML(element);
            if (brick) {
                scene.add(brick);
                interactionManager.placedBricks.push(brick);
            }
        }
    }

    // Update UI
    renderBrickList();
}

// Deserialize a single brick or group from XML
function deserializeBrickFromXML(element) {
    const name = element.getAttribute('name');
    const uuid = element.getAttribute('uuid');

    // Get position, rotation, scale
    const positionElement = element.getElementsByTagName('position')[0];
    const rotationElement = element.getElementsByTagName('rotation')[0];
    const scaleElement = element.getElementsByTagName('scale')[0];

    if (!positionElement || !rotationElement || !scaleElement) {
        console.warn('Missing position, rotation, or scale data for brick:', name);
        return null;
    }

    const position = {
        x: parseFloat(positionElement.getAttribute('x')),
        y: parseFloat(positionElement.getAttribute('y')),
        z: parseFloat(positionElement.getAttribute('z'))
    };

    const rotation = {
        x: parseFloat(rotationElement.getAttribute('x')),
        y: parseFloat(rotationElement.getAttribute('y')),
        z: parseFloat(rotationElement.getAttribute('z'))
    };

    const scale = {
        x: parseFloat(scaleElement.getAttribute('x')),
        y: parseFloat(scaleElement.getAttribute('y')),
        z: parseFloat(scaleElement.getAttribute('z'))
    };

    let brick;

    if (element.tagName === 'group') {
        // Create group
        brick = new THREE.Group();
        brick.name = name;
        brick.uuid = uuid;

        // Process children
        const children = element.children;
        for (let i = 0; i < children.length; i++) {
            const childElement = children[i];
            if (childElement.tagName === 'brick' || childElement.tagName === 'group') {
                const childBrick = deserializeBrickFromXML(childElement);
                if (childBrick) {
                    brick.add(childBrick);
                }
            }
        }
    } else {
        // Create brick
        brick = brickManager.getBrick(name);
        if (!brick) {
            console.warn('Unknown brick type:', name);
            return null;
        }
        brick.uuid = uuid;
    }

    // Apply transforms
    brick.position.set(position.x, position.y, position.z);
    brick.rotation.set(rotation.x, rotation.y, rotation.z);
    brick.scale.set(scale.x, scale.y, scale.z);

    return brick;
}

// Download XML file
function downloadXML(content, filename) {
    const blob = new Blob([content], { type: 'application/xml' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    URL.revokeObjectURL(url);
}

// Animation Loop
function animate() {
    requestAnimationFrame(animate);

    controls.update();
    renderer.render(scene, camera);
}

animate();