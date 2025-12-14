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

// Set undo button update callback
interactionManager.onUpdateUndoButton = () => {
    if (interactionManager.hasActionToUndo) {
        undoBtn.classList.remove('disabled');
    } else {
        undoBtn.classList.add('disabled');
    }
};

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

// Reverse color map for detecting color from hex
const reverseColorMap = {};
for (const [name, hex] of Object.entries(colorMap)) {
    reverseColorMap[hex.toLowerCase()] = name;
}

// Make color maps globally available
window.colorMap = colorMap;
window.reverseColorMap = reverseColorMap;

// Function to get color name from brick material
function getColorNameFromBrick(brick) {
    if (brick && brick.material && brick.material.color) {
        const hex = '#' + brick.material.color.getHexString();
        return reverseColorMap[hex.toLowerCase()] || 'White';
    }
    return 'White';
}

// Global variables for color buttons
let colorButtons = {};

// Function to set selected color (for placement mode)
function setSelectedColor(color) {
    // Remove selected styling from all color buttons
    Object.values(colorButtons).forEach(btn => {
        btn.style.border = '2px solid #ccc';
        btn.style.boxShadow = 'none';
    });

    // Add selected styling to clicked button
    const button = colorButtons[color];
    if (button) {
        button.style.border = '4px solid #0066cc';
        button.style.boxShadow = '0 0 5px rgba(0, 102, 204, 0.5)';
    }

    // Store selected color
    window.selectedColor = color;

    // Update ghost brick color if in placement mode
    if (interactionManager.mode === 'place') {
        interactionManager.updateGhostColor();
    }
}

// Function to highlight color button for selected brick
function highlightColorButton(color) {
    // Remove selected styling from all color buttons
    Object.values(colorButtons).forEach(btn => {
        btn.style.border = '2px solid #ccc';
        btn.style.boxShadow = 'none';
    });

    // Add selected styling to matching button
    const button = colorButtons[color];
    if (button) {
        button.style.border = '4px solid #0066cc';
        button.style.boxShadow = '0 0 5px rgba(0, 102, 204, 0.5)';
    }
}

// Function to change color of selected bricks
function changeSelectedBricksColor(newColor) {
    const colorHex = colorMap[newColor];
    if (!colorHex) return;

    interactionManager.saveState();

    interactionManager.selectedObjects.forEach(brick => {
        // Recursively change color for groups
        brick.traverse((child) => {
            if (child.isMesh && child.material) {
                child.material.color.setStyle(colorHex);
            }
        });
    });

    // Highlight the new color button
    highlightColorButton(newColor);

    // Re-render the brick list to update thumbnail colors
    renderBrickList();
}

// Use fixed basic colors instead of extracting from GLTF
const getBasicColors = () => {
    return ['White', 'Red', 'Blue', 'Green', 'Yellow', 'Black', 'Gray', 'Orange'];
};

// Helper function to get contrast color for text
const getContrastColor = (color) => {
    // Convert THREE.Color to hex string if needed
    let hexString;
    if (color && color.getHexString) {
        hexString = color.getHexString();
    } else if (typeof color === 'string' && color.startsWith('#')) {
        hexString = color.substring(1);
    } else {
        return '#000000'; // Default to black
    }

    // Convert hex to RGB
    const r = parseInt(hexString.substring(0, 2), 16) / 255;
    const g = parseInt(hexString.substring(2, 4), 16) / 255;
    const b = parseInt(hexString.substring(4, 6), 16) / 255;

    // Calculate luminance
    const luminance = 0.299 * r + 0.587 * g + 0.114 * b;

    // Return black or white depending on luminance
    return luminance > 0.5 ? '#000000' : '#FFFFFF';
};

// Create a visual representation of the brick based on type and size
const createBrickThumbnail = (type, width, depth) => {
    // Create image element for thumbnail
    const img = document.createElement('img');

    // Ensure we use the correct thumbnail path - Bricks and Plates have different icons
    // Bricks are 2x taller than plates, so we need to use the appropriate icon
    const thumbnailPath = `./lego_thumbnails/${type} ${width}x${depth}.png`;

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
        img.src = `./lego_thumbnails/Brick 2x2.png`;
    };

    return img;
};


// Mode state
let currentMode = 'select';

// Function to update UI based on mode
function updateModeUI() {
    const selectedCount = interactionManager.selectedObjects.size;
    if (currentMode === 'select') {
        selectModeBtn.classList.add('active');
        deleteBtn.classList.toggle('disabled', selectedCount === 0);
        duplicateBtn.classList.toggle('disabled', selectedCount === 0);
    } else {
        selectModeBtn.classList.remove('active');
        deleteBtn.classList.add('disabled');
        duplicateBtn.classList.add('disabled');
    }
}

// Modes section
const modesContainer = document.createElement('div');
modesContainer.style.padding = '10px';
modesContainer.style.borderBottom = '1px solid #333';
modesContainer.style.marginBottom = '10px';

const selectModeBtn = document.createElement('div');
selectModeBtn.className = 'action-button';
selectModeBtn.style.display = 'flex';
selectModeBtn.style.flexDirection = 'column';
selectModeBtn.style.alignItems = 'center';
selectModeBtn.style.cursor = 'pointer';
selectModeBtn.style.padding = '5px';
selectModeBtn.onclick = () => {
    currentMode = 'select';
    interactionManager.setMode('select');
    // Clear brick selection in menu
    document.querySelectorAll('.brick-item').forEach(el => el.classList.remove('selected'));
    updateModeUI();
};

const selectIcon = document.createElement('img');
selectIcon.src = './icons/select.png';
selectIcon.style.width = '48px';
selectIcon.style.height = '48px';
selectIcon.style.marginBottom = '2px';

const selectLabel = document.createElement('div');
selectLabel.textContent = 'Select';
selectLabel.style.fontSize = '0.7rem';
selectLabel.style.textAlign = 'center';

selectModeBtn.appendChild(selectIcon);
selectModeBtn.appendChild(selectLabel);

// Actions section
const actionsContainer = document.createElement('div');
actionsContainer.style.padding = '10px';
actionsContainer.style.borderBottom = '1px solid #333';
actionsContainer.style.marginBottom = '10px';
actionsContainer.style.display = 'flex';
actionsContainer.style.gap = '10px';

const deleteBtn = document.createElement('div');
deleteBtn.className = 'action-button';
deleteBtn.style.display = 'flex';
deleteBtn.style.flexDirection = 'column';
deleteBtn.style.alignItems = 'center';
deleteBtn.style.cursor = 'pointer';
deleteBtn.style.padding = '5px';
deleteBtn.onclick = () => {
    interactionManager.deleteSelected();
};

const deleteIcon = document.createElement('img');
deleteIcon.src = './icons/delete.png';
deleteIcon.style.width = '48px';
deleteIcon.style.height = '48px';
deleteIcon.style.marginBottom = '2px';

const deleteLabel = document.createElement('div');
deleteLabel.textContent = 'Delete';
deleteLabel.style.fontSize = '0.7rem';
deleteLabel.style.textAlign = 'center';

deleteBtn.appendChild(deleteIcon);
deleteBtn.appendChild(deleteLabel);

const duplicateBtn = document.createElement('div');
duplicateBtn.className = 'action-button';
duplicateBtn.style.display = 'flex';
duplicateBtn.style.flexDirection = 'column';
duplicateBtn.style.alignItems = 'center';
duplicateBtn.style.cursor = 'pointer';
duplicateBtn.style.padding = '5px';
duplicateBtn.onclick = () => {
    interactionManager.duplicateSelected();
};

const duplicateIcon = document.createElement('img');
duplicateIcon.src = './icons/clone.png';
duplicateIcon.style.width = '48px';
duplicateIcon.style.height = '48px';
duplicateIcon.style.marginBottom = '2px';

const duplicateLabel = document.createElement('div');
duplicateLabel.textContent = 'Duplicate';
duplicateLabel.style.fontSize = '0.7rem';
duplicateLabel.style.textAlign = 'center';

duplicateBtn.appendChild(duplicateIcon);
duplicateBtn.appendChild(duplicateLabel);

const undoBtn = document.createElement('div');
undoBtn.id = 'undo-btn';
undoBtn.className = 'action-button disabled';
undoBtn.style.display = 'flex';
undoBtn.style.flexDirection = 'column';
undoBtn.style.alignItems = 'center';
undoBtn.style.cursor = 'pointer';
undoBtn.style.padding = '5px';
undoBtn.onclick = () => {
    if (!undoBtn.classList.contains('disabled')) {
        interactionManager.undoLastAction();
    }
};

const undoIcon = document.createElement('img');
undoIcon.src = './icons/undo.png';
undoIcon.style.width = '48px';
undoIcon.style.height = '48px';
undoIcon.style.marginBottom = '2px';

const undoLabel = document.createElement('div');
undoLabel.textContent = 'Undo';
undoLabel.style.fontSize = '0.7rem';
undoLabel.style.textAlign = 'center';

undoBtn.appendChild(undoIcon);
undoBtn.appendChild(undoLabel);

modesContainer.appendChild(selectModeBtn);
actionsContainer.appendChild(deleteBtn);
actionsContainer.appendChild(duplicateBtn);
actionsContainer.appendChild(undoBtn);

// Insert sections before the menu
const sidebar = document.getElementById('sidebar');
sidebar.insertBefore(modesContainer, brickMenu);
sidebar.insertBefore(actionsContainer, brickMenu);


brickManager.onBricksLoaded = (brickNames, gltf) => {
    console.log('onBricksLoaded called with:', { brickNames, gltf });

    // Create baseplate
    const baseplateInfo = brickManager.createBaseplate(60, 60);

    interactionManager.setStudGrid(
        brickManager.studSpacing,
        brickManager.studHeight,
        baseplateInfo.startX,
        baseplateInfo.startZ,
        brickManager.brickHeight
    );

    // Create color selection UI
    const colorContainer = document.createElement('div');
    colorContainer.id = 'color-selector';
    colorContainer.style.marginBottom = '15px';
    colorContainer.style.display = 'flex';
    colorContainer.style.flexWrap = 'wrap';
    colorContainer.style.gap = '5px';
    colorContainer.style.justifyContent = 'center';

    // Use basic colors
    const colors = getBasicColors();

    // Create color buttons
    let firstColorButton = null;
    colors.forEach(color => {
        const colorButton = document.createElement('button');
        colorButton.className = 'color-button';
        colorButton.textContent = color;
        colorButton.style.padding = '5px 10px';
        colorButton.style.border = '2px solid #ccc';
        colorButton.style.borderRadius = '4px';
        colorButton.style.cursor = 'pointer';
        colorButton.style.backgroundColor = 'white';

        // Use colorMap for consistent basic colors
        const colorHex = colorMap[color];
        if (colorHex) {
            colorButton.style.backgroundColor = colorHex;
            colorButton.style.color = getContrastColor(colorHex);
        }

        colorButton.addEventListener('click', () => {
            // Check if there are selected bricks
            if (interactionManager.selectedObjects.size > 0) {
                // Change color of selected bricks
                changeSelectedBricksColor(color);
            } else {
                // Normal behavior: set selected color for placement
                setSelectedColor(color);
            }
        });

        colorContainer.appendChild(colorButton);
        colorButtons[color] = colorButton;

        // Set first color as default selected
        if (!firstColorButton) {
            firstColorButton = colorButton;
        }
    });

    // Insert color selector after actions, with divider
    const colorsContainer = document.createElement('div');
    colorsContainer.style.padding = '10px';
    colorsContainer.style.borderBottom = '1px solid #333';
    colorsContainer.style.marginBottom = '10px';
    colorsContainer.appendChild(colorContainer);

    sidebar.insertBefore(colorsContainer, brickMenu);

    // Bricks section
    const bricksContainer = document.createElement('div');
    bricksContainer.style.padding = '10px';
    bricksContainer.appendChild(brickMenu);
    sidebar.appendChild(bricksContainer);

    // Select first color by default
    setSelectedColor('White');

    // Initialize UI
    updateModeUI();

    // Set render brick list callback for undo
    interactionManager.onRenderBrickList = renderBrickList;

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

        // Store the first brick name as the base brick for this type/size
        const baseBrickName = bricks[0];

        item.appendChild(preview);
        item.appendChild(label);

        item.addEventListener('click', (e) => {
            e.stopPropagation();
            document.querySelectorAll('.brick-item').forEach(el => el.classList.remove('selected'));
            item.classList.add('selected');

            // Switch to add brick mode
            currentMode = 'addBrick';
            updateModeUI();

            // Use the base brick name and apply the selected color
            interactionManager.selectBrick(baseBrickName);
        });

        brickMenu.appendChild(item);
    });
};

// Load assets
brickManager.loadBricks(`./scene.gltf`);

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

// Helper function to check if a tree item is visible (parent is not collapsed)
function isTreeItemVisible(treeItemElement) {
    let current = treeItemElement.parentElement;
    
    while (current && current !== placedBricksList) {
        // Check if current is a tree-children container
        if (current.classList.contains('tree-children')) {
            // Check if it's expanded
            if (!current.classList.contains('expanded')) {
                return false; // Parent is collapsed
            }
        }
        current = current.parentElement;
    }
    
    return true; // All ancestors are expanded
}


function createBrickTreeItem(brick) {
    const container = document.createElement('div');
    container.className = 'tree-item';
    container.dataset.uuid = brick.uuid;

    // Create the main content row
    const content = document.createElement('div');
    content.className = 'tree-item-content';

    // Toggle button for groups
    const toggle = document.createElement('div');
    toggle.className = 'tree-toggle';
    const hasChildren = brick.name === 'Group' && brick.children.length > 0;
    if (hasChildren) {
        toggle.classList.add('has-children');
        toggle.classList.add('expanded'); // Groups expanded by default
    } else {
        toggle.classList.add('no-children');
    }

    // Thumbnail for groups or bricks
    const thumbnail = document.createElement('div');
    thumbnail.className = 'tree-thumbnail';

    if (brick.name === 'Group') {
        // Folder icon for groups
        const folderIcon = document.createElement('div');
        folderIcon.style.fontSize = '1rem';
        folderIcon.textContent = '📁';
        thumbnail.appendChild(folderIcon);
    } else {
        // Get the brick's color
        const colorName = getColorNameFromBrick(brick);
        const colorHex = colorMap[colorName] || '#ffffff';

        // Create canvas for tinted thumbnail
        const canvas = document.createElement('canvas');
        canvas.width = 24;
        canvas.height = 24;
        const ctx = canvas.getContext('2d');

        // Extract brick type and dimensions from name (e.g., "Brick_2_2" -> "Brick 2x2")
        const parts = brick.name.split('_');
        let thumbnailPath = './lego_thumbnails/Brick 2x2.png'; // Default fallback
        if (parts.length >= 2) {
            const type = parts[0];
            let width = parts[1];
            let depth = parts[2] || '2';
            if (width && width.includes('x')) {
                const sizeParts = width.split('x');
                width = sizeParts[0];
                depth = sizeParts[1] || '2';
            }
            thumbnailPath = `./lego_thumbnails/${type} ${width}x${depth}.png`;
        }

        // Load and tint the image
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.src = thumbnailPath;
        img.onload = () => {
            // Draw the original image
            ctx.drawImage(img, 0, 0, 24, 24);
            // Tint with the brick's color preserving shades
            if (colorName !== 'White') {
                const imageData = ctx.getImageData(0, 0, 24, 24);
                const data = imageData.data;
                // Parse the hex color
                const rColor = parseInt(colorHex.slice(1, 3), 16);
                const gColor = parseInt(colorHex.slice(3, 5), 16);
                const bColor = parseInt(colorHex.slice(5, 7), 16);
                for (let i = 0; i < data.length; i += 4) {
                    if (data[i + 3] > 0) { // If not transparent
                        // Calculate brightness from original (assuming grayscale)
                        const brightness = (data[i] + data[i + 1] + data[i + 2]) / (3 * 255);
                        // Tint by scaling the color, special case for black to preserve 3D shades
                        if (colorName === 'Black') {
                            const gray = Math.round(255 * (1 - brightness));
                            data[i] = gray;
                            data[i + 1] = gray;
                            data[i + 2] = gray;
                        } else {
                            data[i] = Math.round(rColor * brightness);
                            data[i + 1] = Math.round(gColor * brightness);
                            data[i + 2] = Math.round(bColor * brightness);
                        }
                        // Alpha remains the same
                    }
                }
                ctx.putImageData(imageData, 0, 0);
            }
        };
        img.onerror = () => {
            // Fallback to generic brick icon
            const fallbackImg = new Image();
            fallbackImg.crossOrigin = 'anonymous';
            fallbackImg.src = './lego_thumbnails/Brick 2x2.png';
            fallbackImg.onload = () => {
                ctx.drawImage(fallbackImg, 0, 0, 24, 24);
                if (colorName !== 'White') {
                    const imageData = ctx.getImageData(0, 0, 24, 24);
                    const data = imageData.data;
                    // Parse the hex color
                    const rColor = parseInt(colorHex.slice(1, 3), 16);
                    const gColor = parseInt(colorHex.slice(3, 5), 16);
                    const bColor = parseInt(colorHex.slice(5, 7), 16);
                    for (let i = 0; i < data.length; i += 4) {
                        if (data[i + 3] > 0) { // If not transparent
                            // Calculate brightness from original (assuming grayscale)
                            const brightness = (data[i] + data[i + 1] + data[i + 2]) / (3 * 255);
                            // Tint by scaling the color, special case for black to preserve 3D shades
                            if (colorName === 'Black') {
                                const gray = Math.round(255 * (1 - brightness));
                                data[i] = gray;
                                data[i + 1] = gray;
                                data[i + 2] = gray;
                            } else {
                                data[i] = Math.round(rColor * brightness);
                                data[i + 1] = Math.round(gColor * brightness);
                                data[i + 2] = Math.round(bColor * brightness);
                            }
                            // Alpha remains the same
                        }
                    }
                    ctx.putImageData(imageData, 0, 0);
                }
            };
        };

        thumbnail.appendChild(canvas);
    }

    // Label
    const label = document.createElement('div');
    label.className = 'tree-label';
    label.textContent = formatBrickName(brick.name);
    label.title = formatBrickName(brick.name);

    content.appendChild(toggle);
    content.appendChild(thumbnail);
    content.appendChild(label);

    // Add click handler for selection
    content.addEventListener('click', (e) => {
        e.stopPropagation();

        // Check if this item is visible in the tree (not inside a collapsed group)
        const treeItem = content.closest('.tree-item');
        if (!isTreeItemVisible(treeItem)) {
            console.log('Cannot select item inside collapsed group');
            return;
        }

        if (e.shiftKey && lastSelectedUuid) {
            // Shift+Click: Range Selection - only select visible items
            const allItems = Array.from(document.querySelectorAll('.tree-item-content'));
            const lastIdx = allItems.findIndex(el => {
                const item = el.closest('.tree-item');
                return item && item.dataset.uuid === lastSelectedUuid;
            });
            const currentIdx = allItems.findIndex(el => {
                const item = el.closest('.tree-item');
                return item && item.dataset.uuid === brick.uuid;
            });

            if (lastIdx !== -1 && currentIdx !== -1) {
                const start = Math.min(lastIdx, currentIdx);
                const end = Math.max(lastIdx, currentIdx);
                const rangeItems = allItems.slice(start, end + 1);
                const uuids = rangeItems.map(el => {
                    const item = el.closest('.tree-item');
                    // Only include visible items
                    if (item && isTreeItemVisible(item)) {
                        return item.dataset.uuid;
                    }
                    return null;
                }).filter(Boolean);

                interactionManager.selectObjectsByUuids(uuids);
            }
        } else if (e.ctrlKey || e.metaKey) {
            // Ctrl+Click: Toggle
            interactionManager.toggleSelectionByUuid(brick.uuid);
            lastSelectedUuid = brick.uuid;
        } else {
            // Single Click
            interactionManager.selectObjectByUuid(brick.uuid);
            lastSelectedUuid = brick.uuid;
        }
    });

    // Create children container first (before toggle handler)
    let childrenContainer = null;
    if (hasChildren) {
        childrenContainer = document.createElement('div');
        childrenContainer.className = 'tree-children expanded'; // Expanded by default

        brick.children.forEach(child => {
            if (child.isMesh || child.isGroup) {
                childrenContainer.appendChild(createBrickTreeItem(child));
            }
        });
    }

    // Handle toggle expansion
    if (hasChildren) {
        toggle.addEventListener('click', (e) => {
            e.stopPropagation();
            toggle.classList.toggle('expanded');
            childrenContainer.classList.toggle('expanded');
        });
    }

    container.appendChild(content);

    // Append children container
    if (childrenContainer) {
        container.appendChild(childrenContainer);
    }

    return container;
}

function renderBrickList() {
    placedBricksList.innerHTML = '';

    // Only render top-level placed bricks
    interactionManager.placedBricks.forEach(brick => {
        const item = createBrickTreeItem(brick);
        placedBricksList.appendChild(item);
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
    
    // Trigger selection changed to update button states
    if (interactionManager.onSelectionChanged) {
        interactionManager.onSelectionChanged(Array.from(interactionManager.selectedObjects).map(o => o.uuid));
    }
};

interactionManager.onSelectionChanged = (selectedUuids) => {
    // Remove selection from all items
    document.querySelectorAll('.tree-item-content').forEach(el => el.classList.remove('selected'));

    // selectedUuids is now an Array (or empty array)
    const uuids = Array.isArray(selectedUuids) ? selectedUuids : (selectedUuids ? [selectedUuids] : []);
    const selectedCount = uuids.length;
    let anyGroupSelected = false;
    let allAtSameLevel = true;
    let commonParent = null;
    let commonParentName = 'unknown';

    console.log('=== Selection Changed ===');
    console.log('Selected UUIDs:', uuids);
    console.log('Selected count:', selectedCount);

    uuids.forEach((uuid, index) => {
        const item = document.querySelector(`.tree-item[data-uuid="${uuid}"] .tree-item-content`);
        if (item) {
            item.classList.add('selected');
            if (uuids.indexOf(uuid) === 0) {
                // item.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }

            // Update last selected if single selection (to sync external changes)
            if (uuids.length === 1) lastSelectedUuid = uuid;
        }

        const obj = interactionManager.findBrickByUuid(uuid);
        
        let objParentName = 'NOT FOUND';
        let objParent = null;
        
        if (!obj) {
            console.log(`[${index}] UUID ${uuid}: OBJECT NOT FOUND`);
        } else {
            objParent = obj.parent;
            objParentName = objParent ? (objParent.name || 'unnamed parent') : 'NO PARENT (is root)';
            console.log(`[${index}] ${obj.name} (${uuid}) - Parent: ${objParentName}, isGroup: ${obj.isGroup}`);
            
            if (obj.isGroup) {
                anyGroupSelected = true;
            }

            // Check if all selected objects have the same parent (same hierarchical level)
            if (index === 0) {
                commonParent = objParent;
                commonParentName = objParentName;
            } else {
                if (objParent !== commonParent) {
                    allAtSameLevel = false;
                    console.log(`  ⚠️ Parent mismatch! Expected: ${commonParentName}, Got: ${objParentName}`);
                }
            }
        }
    });

    console.log('All at same level:', allAtSameLevel);
    console.log('Common parent:', commonParentName);

    // Sync currentMode with selection
    if (selectedCount > 0) {
        currentMode = 'select';
    }

    // Handle color button highlighting
    if (selectedCount === 1) {
        // Single brick selected - highlight its color
        const selectedBrick = interactionManager.findBrickByUuid(uuids[0]);
        if (selectedBrick) {
            const colorName = getColorNameFromBrick(selectedBrick);
            highlightColorButton(colorName);
        }
    } else if (selectedCount === 0) {
        // No selection - show selected color for placement
        if (window.selectedColor) {
            highlightColorButton(window.selectedColor);
        }
    }
    // For multiple selection, keep current highlight or clear?

    // Update button states
    // Group button: enabled only if 2+ items selected AND all at same hierarchical level
    if (groupBtn) {
        const shouldEnable = selectedCount >= 2 && allAtSameLevel;
        console.log('Group button: enabled=' + shouldEnable + ' (count=' + selectedCount + ', sameLvl=' + allAtSameLevel + ')');
        if (shouldEnable) {
            groupBtn.classList.remove('disabled');
        } else {
            groupBtn.classList.add('disabled');
        }
    }
    if (ungroupBtn) {
        if (selectedCount === 1 && anyGroupSelected) {
            ungroupBtn.classList.remove('disabled');
        } else {
            ungroupBtn.classList.add('disabled');
        }
    }
    updateModeUI();
};

// Button Handlers
if (groupBtn) {
    groupBtn.onclick = () => {
        if (!groupBtn.classList.contains('disabled')) {
            interactionManager.groupSelected();
        }
    };
}

if (ungroupBtn) {
    ungroupBtn.onclick = () => {
        if (!ungroupBtn.classList.contains('disabled')) {
            interactionManager.ungroupSelected();
        }
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
        xml += `    <color name="${getColorNameFromBrick(brick)}" />\n`;
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
                
                // Force matrix world update and ensure proper raycasting setup
                brick.updateMatrixWorld(true);
                
                // Ensure all child meshes have proper materials for raycasting
                brick.traverse((child) => {
                    if (child.isMesh && child.material) {
                        // Ensure material is properly configured for raycasting
                        if (!child.material.userData.isRaycastable) {
                            child.material.userData.isRaycastable = true;
                        }
                    }
                });
                
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
    // Only apply color to individual bricks, not groups
    if (element.tagName === 'brick') {

    const colorElement = element.getElementsByTagName('color')[0];
    if (colorElement) {
        const colorName = colorElement.getAttribute('name');
        if (colorName && colorMap[colorName]) {
            brick.traverse((child) => {
                if (child.isMesh && child.material) {
                    // Recreate the material to ensure proper transparency state
                    const hexColor = colorMap[colorName];
                    child.material = new THREE.MeshStandardMaterial({
                        color: hexColor,
                        roughness: 0.3,
                        metalness: 0.1,
                        transparent: false,
                        opacity: 1.0
                    });
                }
            });
        }
    }
    }

    // Apply transforms
    brick.position.set(position.x, position.y, position.z);
    brick.rotation.set(rotation.x, rotation.y, rotation.z);
    brick.scale.set(scale.x, scale.y, scale.z);

    // Force multiple matrix updates to ensure proper raycasting
    brick.updateMatrixWorld(true);
    
    // Also ensure all children have updated matrices
    if (brick.isGroup) {
        brick.traverse((child) => {
            if (child.isMesh) {
                child.updateMatrixWorld(true);
            }
        });
    }

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