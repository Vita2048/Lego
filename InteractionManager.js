import * as THREE from 'three';

export class InteractionManager {
    constructor(scene, camera, canvas, brickManager, orbitControls = null) {
        this.scene = scene;
        this.camera = camera;
        this.canvas = canvas;
        this.brickManager = brickManager;
        this.orbitControls = orbitControls;

        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();
        this.selectedBrickName = null;
        this.ghostBrick = null;
        this.placedBricks = []; // Array of meshes placed in the scene

        this.mode = 'select'; // 'select' | 'place' | 'drag' | 'gizmo-drag'
        this.selectedObject = null;
        this.selectionBoxHelper = null;
        this.selectionOutline = null; // For edge highlighting

        // Stud grid settings (will be configured by setStudGrid)
        this.studSpacing = 0.8; // Distance between stud centers
        this.studHeight = 0.17; // Height of studs for interlocking
        this.gridStartX = 0; // Starting X position of stud grid
        this.gridStartZ = 0; // Starting Z position of stud grid

        // Legacy grid size (replaced by studSpacing)
        this.gridSize = this.studSpacing;

        // Drag state
        this.isDragging = false;
        this.dragOffset = new THREE.Vector3();
        this.dragStartPosition = new THREE.Vector3();
        this.draggedObject = null;
        this.dragGhost = null;

        // Transform gizmo
        this.gizmo = null;
        this.gizmoArrows = { x: null, y: null, z: null };
        this.gizmoCenterHandle = null;
        this.activeGizmoAxis = null; // 'x', 'y', 'z', or 'center'
        this.gizmoDragStart = new THREE.Vector3();
        this.objectDragStart = new THREE.Vector3();

        this.initEvents();
        this.createGizmo();
    }

    // Configure stud grid settings from baseplate
    setStudGrid(studSpacing, studHeight, startX, startZ) {
        this.studSpacing = studSpacing;
        this.studHeight = studHeight;
        this.gridStartX = startX;
        this.gridStartZ = startZ;
        this.gridSize = studSpacing; // Keep legacy property in sync
        console.log('Stud grid configured:', { studSpacing, studHeight, startX, startZ });
    }

    // Snap a position to the stud grid, accounting for brick dimensions
    // For even-sized bricks (2x2, 2x4), the center is between studs
    // For odd-sized bricks (1x2), the center is at a stud
    snapToStudGrid(x, z, brickMesh = null) {
        // Calculate offset from grid start
        const offsetX = x - this.gridStartX;
        const offsetZ = z - this.gridStartZ;

        // Determine if the brick has even or odd stud counts in X and Z
        let evenStudsX = true; // Default to even (most bricks are 2xN)
        let evenStudsZ = true;

        if (brickMesh) {
            const bbox = new THREE.Box3().setFromObject(brickMesh);
            const size = new THREE.Vector3();
            bbox.getSize(size);

            // Calculate number of studs in each direction (rounded to nearest integer)
            const studsX = Math.round(size.x / this.studSpacing);
            const studsZ = Math.round(size.z / this.studSpacing);

            evenStudsX = studsX % 2 === 0;
            evenStudsZ = studsZ % 2 === 0;
        }

        // Snap to nearest stud position
        // For even stud counts, snap to between studs (add 0.5 offset)
        // For odd stud counts, snap directly to stud positions
        let studX, studZ;

        if (evenStudsX) {
            // Even: center should be between studs
            studX = Math.round(offsetX / this.studSpacing - 0.5) + 0.5;
        } else {
            // Odd: center should be at a stud
            studX = Math.round(offsetX / this.studSpacing);
        }

        if (evenStudsZ) {
            // Even: center should be between studs
            studZ = Math.round(offsetZ / this.studSpacing - 0.5) + 0.5;
        } else {
            // Odd: center should be at a stud
            studZ = Math.round(offsetZ / this.studSpacing);
        }

        // Convert back to world coordinates
        return {
            x: this.gridStartX + studX * this.studSpacing,
            z: this.gridStartZ + studZ * this.studSpacing
        };
    }

    initEvents() {
        this.canvas.addEventListener('mousemove', (e) => this.onMouseMove(e));
        this.canvas.addEventListener('click', (e) => this.onClick(e));
        this.canvas.addEventListener('mousedown', (e) => this.onMouseDown(e));
        this.canvas.addEventListener('mouseup', (e) => this.onMouseUp(e));
        window.addEventListener('keydown', (e) => this.onKeyDown(e));
    }

    createGizmo() {
        // Create a group to hold all gizmo elements
        this.gizmo = new THREE.Group();
        this.gizmo.name = 'TransformGizmo';
        this.gizmo.visible = false;

        // Track hovered axis for glow effect
        this.hoveredGizmoAxis = null;

        // Arrow dimensions - make them much longer and thicker
        const arrowLength = 4.0;
        const shaftRadius = 0.08;
        const headLength = 0.6;
        const headRadius = 0.2;

        // Helper function to create a thick arrow
        const createArrow = (direction, color, name, axis) => {
            const group = new THREE.Group();
            group.name = name;
            group.userData.axis = axis;
            group.userData.originalColor = color;

            // Shaft (cylinder)
            const shaftGeometry = new THREE.CylinderGeometry(shaftRadius, shaftRadius, arrowLength - headLength, 16);
            const shaftMaterial = new THREE.MeshBasicMaterial({ color: color });
            const shaft = new THREE.Mesh(shaftGeometry, shaftMaterial);
            shaft.position.y = (arrowLength - headLength) / 2;
            shaft.userData.axis = axis;
            group.add(shaft);

            // Head (cone)
            const headGeometry = new THREE.ConeGeometry(headRadius, headLength, 16);
            const headMaterial = new THREE.MeshBasicMaterial({ color: color });
            const head = new THREE.Mesh(headGeometry, headMaterial);
            head.position.y = arrowLength - headLength / 2;
            head.userData.axis = axis;
            group.add(head);

            // Rotate to point in the correct direction
            if (direction.x === 1) {
                group.rotation.z = -Math.PI / 2;
            } else if (direction.z === 1) {
                group.rotation.x = Math.PI / 2;
            }
            // Y direction is already correct (pointing up)

            return group;
        };

        // X axis - Red
        const xArrow = createArrow(new THREE.Vector3(1, 0, 0), 0xff0000, 'gizmo-x', 'x');
        this.gizmoArrows.x = xArrow;
        this.gizmo.add(xArrow);

        // Y axis - Green
        const yArrow = createArrow(new THREE.Vector3(0, 1, 0), 0x00ff00, 'gizmo-y', 'y');
        this.gizmoArrows.y = yArrow;
        this.gizmo.add(yArrow);

        // Z axis - Blue
        const zArrow = createArrow(new THREE.Vector3(0, 0, 1), 0x0000ff, 'gizmo-z', 'z');
        this.gizmoArrows.z = zArrow;
        this.gizmo.add(zArrow);

        // Center handle - White sphere (larger)
        const centerGeometry = new THREE.SphereGeometry(0.4, 16, 16);
        const centerMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });
        this.gizmoCenterHandle = new THREE.Mesh(centerGeometry, centerMaterial);
        this.gizmoCenterHandle.name = 'gizmo-center';
        this.gizmoCenterHandle.userData.axis = 'center';
        this.gizmoCenterHandle.userData.originalColor = 0xffffff;
        this.gizmo.add(this.gizmoCenterHandle);

        this.scene.add(this.gizmo);
    }

    // Highlight gizmo axis on hover with blue glow
    highlightGizmoAxis(axis) {
        // Reset previous highlight
        this.resetGizmoHighlight();

        if (!axis) return;

        this.hoveredGizmoAxis = axis;
        const glowColor = 0x00aaff; // Bright blue glow

        try {
            if (axis === 'center') {
                if (this.gizmoCenterHandle && this.gizmoCenterHandle.material) {
                    this.gizmoCenterHandle.material.color.setHex(glowColor);
                    // MeshBasicMaterial does not support emissive
                    // this.gizmoCenterHandle.material.emissive = new THREE.Color(glowColor);
                    // TEMPORARILY DISABLED SCALING
                    // this.gizmoCenterHandle.scale.set(1.3, 1.3, 1.3);
                }
            } else if (this.gizmoArrows[axis]) {
                const arrow = this.gizmoArrows[axis];
                arrow.traverse((child) => {
                    if (child.isMesh && child.material) {
                        child.material.color.setHex(glowColor);
                    }
                });
                // TEMPORARILY DISABLED SCALING
                // arrow.scale.set(1.2, 1.2, 1.2);
            }
        } catch (error) {
            console.error('Error in highlightGizmoAxis:', error);
        }
    }

    // Reset gizmo highlight
    resetGizmoHighlight() {
        if (!this.hoveredGizmoAxis) return;

        try {
            // Reset center handle
            if (this.gizmoCenterHandle) {
                this.gizmoCenterHandle.material.color.setHex(0xffffff);
                this.gizmoCenterHandle.scale.set(1, 1, 1);
            }

            // Reset arrows
            for (const axisName of ['x', 'y', 'z']) {
                const arrow = this.gizmoArrows[axisName];
                if (arrow) {
                    const originalColor = arrow.userData.originalColor;
                    arrow.traverse((child) => {
                        if (child.isMesh && child.material) {
                            child.material.color.setHex(originalColor);
                        }
                    });
                    arrow.scale.set(1, 1, 1);
                }
            }
        } catch (error) {
            console.error('Error in resetGizmoHighlight:', error);
        }

        this.hoveredGizmoAxis = null;
    }

    showGizmo(object) {
        if (!object || !this.gizmo) return;

        console.log('showGizmo called for:', object.name, 'at position:', object.position);

        // DEBUG: Log scene state before changes
        console.log('--- SCENE STATE BEFORE GIZMO ---');
        console.log('Camera:', this.camera.position);
        this.scene.children.forEach(child => {
            console.log(`Child: ${child.name}, Visible: ${child.visible}, Position: ${JSON.stringify(child.position)}`);
        });

        // Validate object position
        if (isNaN(object.position.x) || isNaN(object.position.y) || isNaN(object.position.z)) {
            console.error('showGizmo: Object has NaN position!', object.position);
            return;
        }

        // Position gizmo at object's center
        const bbox = new THREE.Box3().setFromObject(object);

        // Validate bounding box
        if (isNaN(bbox.min.x) || isNaN(bbox.max.x)) {
            console.error('showGizmo: Object bbox invalid!', bbox);
            // Fallback to object position
            this.gizmo.position.copy(object.position);
        } else {
            const center = new THREE.Vector3();
            bbox.getCenter(center);
            this.gizmo.position.copy(center);
        }

        this.gizmo.visible = true;

        // Create edge outline for the selected object
        // TEMPORARILY DISABLED FOR DEBUGGING
        /*
        try {
            this.createSelectionOutline(object);
        } catch (e) {
            console.error('Failed to create selection outline:', e);
        }
        */

        console.log('Gizmo position:', this.gizmo.position);

        // DEBUG: Log scene state after changes
        console.log('--- SCENE STATE AFTER GIZMO ---');
        this.scene.children.forEach(child => {
            console.log(`Child: ${child.name}, Visible: ${child.visible}, Position: ${JSON.stringify(child.position)}`);
        });
    }

    createSelectionOutline(object) {
        // Remove existing outline
        this.removeSelectionOutline();

        // Create a BoxHelper for edge highlighting
        try {
            this.selectionOutline = new THREE.BoxHelper(object, 0x00ffff); // Cyan color
            this.selectionOutline.name = 'SelectionOutline';
            this.scene.add(this.selectionOutline);
        } catch (error) {
            console.error('Error creating BoxHelper:', error);
            this.selectionOutline = null;
        }
    }

    removeSelectionOutline() {
        if (this.selectionOutline) {
            this.scene.remove(this.selectionOutline);
            this.selectionOutline = null;
        }
    }

    updateSelectionOutline() {
        if (this.selectionOutline && this.selectedObject) {
            this.selectionOutline.update();
        }
    }

    hideGizmo() {
        if (this.gizmo) {
            this.gizmo.visible = false;
        }
        // Also remove edge outline
        this.removeSelectionOutline();
    }

    updateGizmoPosition() {
        if (this.selectedObject && this.gizmo && this.gizmo.visible) {
            // Validate object position
            if (isNaN(this.selectedObject.position.x)) {
                console.warn('updateGizmoPosition: Object has NaN position');
                return;
            }

            const bbox = new THREE.Box3().setFromObject(this.selectedObject);
            const center = new THREE.Vector3();
            bbox.getCenter(center);

            if (!isNaN(center.x)) {
                this.gizmo.position.copy(center);
            }

            // Update selection outline too
            this.updateSelectionOutline();
        }
    }

    getGizmoIntersection() {
        if (!this.gizmo || !this.gizmo.visible) return null;

        // Collect all gizmo parts for raycasting
        const gizmoParts = [];

        // Add arrow line and cone parts
        this.gizmo.traverse((child) => {
            if (child.isMesh || child.isLine) {
                gizmoParts.push(child);
            }
        });

        const intersects = this.raycaster.intersectObjects(gizmoParts, false);

        if (intersects.length > 0) {
            // Find the axis from the parent hierarchy
            let obj = intersects[0].object;
            while (obj && !obj.userData.axis) {
                obj = obj.parent;
            }
            if (obj && obj.userData.axis) {
                return obj.userData.axis;
            }
        }

        return null;
    }

    setMode(mode) {
        this.mode = mode;
        if (mode === 'select') {
            this.removeGhost();
            this.canvas.style.cursor = 'default';
        } else {
            this.deselectObject();
            this.canvas.style.cursor = 'none'; // Or crosshair
        }
    }

    selectBrick(name) {
        this.setMode('place');
        this.selectedBrickName = name;

        this.removeGhost();
        this.removeDragGhost();

        // Create new ghost for placement
        const brick = this.brickManager.getBrick(name);
        if (brick) {
            this.ghostBrick = brick;
            // Make it semi-transparent
            this.ghostBrick.traverse((child) => {
                if (child.isMesh) {
                    child.material = child.material.clone();
                    child.material.transparent = true;
                    child.material.opacity = 0.5;
                    child.material.depthWrite = false;
                }
            });
            // Hide initially until mouse move
            this.ghostBrick.visible = false;
            this.scene.add(this.ghostBrick);
        }
    }

    removeGhost() {
        if (this.ghostBrick) {
            this.scene.remove(this.ghostBrick);
            this.ghostBrick = null;
        }
    }

    removeDragGhost() {
        if (this.dragGhost) {
            this.scene.remove(this.dragGhost);
            this.dragGhost = null;
        }
    }

    onMouseMove(event) {
        this.updateMouse(event);
        this.raycaster.setFromCamera(this.mouse, this.camera);

        if (this.mode === 'place' && this.ghostBrick) {
            // Place mode - ghost follows mouse along surfaces
            this.ghostBrick.visible = true;

            // Step 1: Get XZ position from mouse on ground plane (y=0)
            const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
            const groundPoint = new THREE.Vector3();
            this.raycaster.ray.intersectPlane(groundPlane, groundPoint);

            if (groundPoint) {
                // Snap to stud grid (pass brick for dimension-aware snapping)
                const snapped = this.snapToStudGrid(groundPoint.x, groundPoint.z, this.ghostBrick);
                const x = snapped.x;
                const z = snapped.z;

                // Step 2: Find the lowest valid Y position at this XZ
                const y = this.findLowestValidY(x, z, this.ghostBrick);

                this.ghostBrick.position.set(x, y, z);
            }
        } else if (this.mode === 'drag' && this.dragGhost) {
            // Drag mode - ghost follows mouse along surfaces (same as place mode)
            this.canvas.style.cursor = 'grabbing';

            // Step 1: Get XZ position from mouse on ground plane (y=0)
            const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
            const groundPoint = new THREE.Vector3();
            this.raycaster.ray.intersectPlane(groundPlane, groundPoint);

            if (groundPoint) {
                // Snap to stud grid (pass brick for dimension-aware snapping)
                const snapped = this.snapToStudGrid(groundPoint.x, groundPoint.z, this.dragGhost);
                const x = snapped.x;
                const z = snapped.z;

                // Step 2: Find the lowest valid Y position at this XZ (excluding dragged object)
                const y = this.findLowestValidY(x, z, this.dragGhost, this.draggedObject);

                this.dragGhost.position.set(x, y, z);
            }
        } else if (this.mode === 'gizmo-drag' && this.selectedObject && this.activeGizmoAxis) {
            // Gizmo drag mode - move object along the active axis
            this.canvas.style.cursor = 'grabbing';

            // Get current mouse position on ground plane
            const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
            const currentPoint = new THREE.Vector3();
            this.raycaster.ray.intersectPlane(groundPlane, currentPoint);

            if (currentPoint) {
                const delta = new THREE.Vector3().subVectors(currentPoint, this.gizmoDragStart);

                // Calculate new position based on axis
                const newPosition = this.selectedObject.position.clone();

                if (this.activeGizmoAxis === 'x') {
                    newPosition.x = this.objectDragStart.x + delta.x;
                } else if (this.activeGizmoAxis === 'y') {
                    const yDelta = -delta.z * 0.5;
                    newPosition.y = Math.max(0, this.objectDragStart.y + yDelta);
                } else if (this.activeGizmoAxis === 'z') {
                    newPosition.z = this.objectDragStart.z + delta.z;
                } else if (this.activeGizmoAxis === 'center') {
                    newPosition.x = this.objectDragStart.x + delta.x;
                    newPosition.z = this.objectDragStart.z + delta.z;
                }

                // Check for collision at new position
                if (!this.wouldCollide(this.selectedObject, newPosition)) {
                    // No collision - apply the new position
                    this.selectedObject.position.copy(newPosition);

                    // Update gizmo position to follow object
                    this.updateGizmoPosition();
                }
                // If collision, don't move - brick stays at previous valid position
            }
        } else if (this.mode === 'select') {
            // Select mode - check for hover over gizmo or objects
            this.canvas.style.cursor = 'default';

            // Check gizmo hover first
            const gizmoAxis = this.getGizmoIntersection();
            if (gizmoAxis) {
                this.canvas.style.cursor = 'grab';
                // Highlight the hovered axis with blue glow
                this.highlightGizmoAxis(gizmoAxis);
                return;
            } else {
                // Not hovering on gizmo - reset highlight
                this.resetGizmoHighlight();
            }

            if (this.selectedObject) {
                // Check if hovering over selected object
                const intersects = this.raycaster.intersectObjects([this.selectedObject], true);
                if (intersects.length > 0) {
                    this.canvas.style.cursor = 'pointer';
                }
            } else {
                // Check if hovering over any placed brick for selection
                const intersects = this.raycaster.intersectObjects(this.placedBricks, true);
                if (intersects.length > 0) {
                    this.canvas.style.cursor = 'pointer';
                }
            }
        }
    }

    onClick(event) {
        if (this.mode === 'place') {
            console.log('onClick: place mode. ghostBrick:', this.ghostBrick ? 'exists' : 'missing', 'visible:', this.ghostBrick ? this.ghostBrick.visible : 'N/A');

            if (!this.ghostBrick || !this.ghostBrick.visible) {
                console.log('onClick: ghostBrick not valid for placement');
                return;
            }

            // Clone the ghost to create a real brick
            const newBrick = this.brickManager.getBrick(this.selectedBrickName);
            if (!newBrick) {
                console.error('onClick: Failed to create new brick from', this.selectedBrickName);
                return;
            }

            newBrick.position.copy(this.ghostBrick.position);
            newBrick.rotation.copy(this.ghostBrick.rotation);

            this.scene.add(newBrick);
            this.placedBricks.push(newBrick);
            console.log('onClick: Brick placed. New count:', this.placedBricks.length, 'Brick:', newBrick);
        } else if (this.mode === 'drag') {
            // End drag mode - place the brick at the ghost's position (already calculated correctly)
            if (this.dragGhost && this.draggedObject) {
                this.draggedObject.position.copy(this.dragGhost.position);
                this.preventOverlaps(this.draggedObject);
            }

            // Clean up drag mode
            this.endDragMode();
        } else if (this.mode === 'select') {
            console.log('onClick: select mode, placedBricks count:', this.placedBricks.length);
            this.raycaster.setFromCamera(this.mouse, this.camera);

            // First check if clicking on gizmo
            const gizmoAxis = this.getGizmoIntersection();
            if (gizmoAxis) {
                console.log('onClick: hit gizmo axis:', gizmoAxis);
                // Don't do anything on click - gizmo is handled by mousedown/mousemove
                return;
            }

            // Check if clicking on a brick
            const intersects = this.raycaster.intersectObjects(this.placedBricks, true);
            console.log('onClick: intersects count:', intersects.length);

            if (intersects.length > 0) {
                console.log('onClick: hit object:', intersects[0].object.name);
                // Find the actual brick (not child mesh)
                let hitBrick = intersects[0].object;
                while (hitBrick.parent && !this.placedBricks.includes(hitBrick)) {
                    hitBrick = hitBrick.parent;
                }

                console.log('onClick: hitBrick:', hitBrick.name, 'isPlaced:', this.placedBricks.includes(hitBrick));

                if (this.placedBricks.includes(hitBrick)) {
                    // Select the brick and show gizmo
                    this.selectedObject = hitBrick;
                    this.showGizmo(hitBrick);
                }
            } else {
                console.log('onClick: no intersection, deselecting');
                // Clicked empty space - deselect
                this.deselectObject();
                this.hideGizmo();
            }
        }
    }

    startDragMode(object) {
        this.mode = 'drag';
        this.draggedObject = object;
        this.dragStartPosition.copy(object.position);

        // Create drag ghost (semi-transparent copy)
        this.dragGhost = object.clone();
        this.dragGhost.traverse((child) => {
            if (child.isMesh) {
                child.material = child.material.clone();
                child.material.transparent = true;
                child.material.opacity = 0.7;
            }
        });

        // Position drag ghost at same location as original
        this.dragGhost.position.copy(object.position);
        this.scene.add(this.dragGhost);

        // Hide the original object during drag
        object.visible = false;
    }

    endDragMode() {
        this.mode = 'select';

        // Remove drag ghost
        if (this.dragGhost) {
            this.scene.remove(this.dragGhost);
            this.dragGhost = null;
        }

        // Show the original object again
        if (this.draggedObject) {
            this.draggedObject.visible = true;
            this.draggedObject = null;
        }

        this.deselectObject();
    }

    preventOverlaps(brick) {
        // Check if the brick overlaps with any other bricks
        const brickBox = new THREE.Box3().setFromObject(brick);

        for (const otherBrick of this.placedBricks) {
            if (otherBrick === brick) continue;

            const otherBox = new THREE.Box3().setFromObject(otherBrick);

            if (brickBox.intersectsBox(otherBox)) {
                // Try to resolve overlap by moving in X or Z direction
                const overlapX = Math.min(brickBox.max.x, otherBox.max.x) - Math.max(brickBox.min.x, otherBox.min.x);
                const overlapZ = Math.min(brickBox.max.z, otherBox.max.z) - Math.max(brickBox.min.z, otherBox.min.z);

                if (Math.abs(overlapX) < Math.abs(overlapZ)) {
                    // Move in X direction
                    if (brick.position.x < otherBrick.position.x) {
                        brick.position.x = otherBox.min.x - (brickBox.max.x - brickBox.min.x);
                    } else {
                        brick.position.x = otherBox.max.x;
                    }
                } else {
                    // Move in Z direction
                    if (brick.position.z < otherBrick.position.z) {
                        brick.position.z = otherBox.min.z - (brickBox.max.z - brickBox.min.z);
                    } else {
                        brick.position.z = otherBox.max.z;
                    }
                }

                // Apply grid snapping after adjustment
                brick.position.x = Math.round(brick.position.x / this.gridSize) * this.gridSize;
                brick.position.z = Math.round(brick.position.z / this.gridSize) * this.gridSize;

                // Update bounding box after movement
                brickBox.setFromObject(brick);
            }
        }
    }

    selectObject(object) {
        this.deselectObject();
        this.selectedObject = object;

        // Add visual helper
        this.selectionBoxHelper = new THREE.BoxHelper(object, 0xffff00); // Yellow highlight
        this.scene.add(this.selectionBoxHelper);
    }

    deselectObject() {
        if (this.selectedObject) {
            this.selectedObject = null;
        }
        if (this.selectionBoxHelper) {
            this.scene.remove(this.selectionBoxHelper);
            this.selectionBoxHelper = null;
        }
    }

    deleteSelected() {
        if (this.selectedObject) {
            this.scene.remove(this.selectedObject);
            this.placedBricks = this.placedBricks.filter(b => b !== this.selectedObject);
            this.deselectObject();
        }
    }

    onKeyDown(event) {
        if (event.key === 'r' || event.key === 'R') {
            if (this.mode === 'place' && this.ghostBrick) {
                this.ghostBrick.rotation.y += Math.PI / 2;
            }
        }

        if (event.key === 'Escape') {
            this.setMode('select');
        }

        if (event.key === 'Delete' || event.key === 'Backspace') {
            this.deleteSelected();
        }
    }

    updateMouse(event) {
        const rect = this.canvas.getBoundingClientRect();
        this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    }

    onMouseDown(event) {
        this.updateMouse(event);
        this.raycaster.setFromCamera(this.mouse, this.camera);

        if (this.mode === 'select' && this.selectedObject) {
            // Check if clicking on gizmo
            const gizmoAxis = this.getGizmoIntersection();
            if (gizmoAxis) {
                // Start gizmo drag
                this.mode = 'gizmo-drag';
                this.activeGizmoAxis = gizmoAxis;
                this.objectDragStart.copy(this.selectedObject.position);

                // Get start position on the appropriate plane
                const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
                const startPoint = new THREE.Vector3();
                this.raycaster.ray.intersectPlane(groundPlane, startPoint);
                this.gizmoDragStart.copy(startPoint);

                this.canvas.style.cursor = 'grabbing';

                // Disable orbit controls during gizmo drag
                if (this.orbitControls) {
                    this.orbitControls.enabled = false;
                }
                return;
            }
        }
    }

    onMouseUp(event) {
        if (this.mode === 'gizmo-drag') {
            // Snap the final position to stud grid (only XZ, keep Y exactly where user placed it)
            if (this.selectedObject) {
                const snapped = this.snapToStudGrid(
                    this.selectedObject.position.x,
                    this.selectedObject.position.z,
                    this.selectedObject
                );
                this.selectedObject.position.x = snapped.x;
                this.selectedObject.position.z = snapped.z;

                // Keep Y exactly where user placed it, just ensure not below ground
                this.selectedObject.position.y = Math.max(0, this.selectedObject.position.y);

                // Update gizmo and outline position
                this.updateGizmoPosition();
            }

            this.mode = 'select';
            this.activeGizmoAxis = null;

            // Re-enable orbit controls
            if (this.orbitControls) {
                this.orbitControls.enabled = true;
            }
        }

        this.isDragging = false;
        this.canvas.style.cursor = 'default';
    }

    getMouseWorldPosition(mouseCoords, targetY = 0) {
        // Create a plane at the target Y height for intersection
        const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), targetY);
        const raycaster = new THREE.Raycaster();

        // Set raycaster from camera using mouse coordinates
        raycaster.setFromCamera(mouseCoords, this.camera);

        // Find intersection with the plane
        const intersectionPoint = new THREE.Vector3();
        raycaster.ray.intersectPlane(plane, intersectionPoint);

        return intersectionPoint;
    }

    // Check if moving a brick to a new position would cause a collision
    // This allows studs to interlock by shrinking the collision box vertically
    wouldCollide(brick, newPosition) {
        // Get the brick's bounding box at its current position
        const brickBox = new THREE.Box3().setFromObject(brick);
        const brickSize = new THREE.Vector3();
        brickBox.getSize(brickSize);

        // Calculate the bounding box at the new position
        const halfSizeX = brickSize.x / 2;
        const halfSizeZ = brickSize.z / 2;

        // Shrink horizontally slightly to allow touching
        const horizontalShrink = 0.05;

        // Shrink vertically by stud height to allow interlocking
        // Top studs go into the underside of the brick above
        const verticalShrink = this.studHeight;

        const newMin = new THREE.Vector3(
            newPosition.x - halfSizeX + horizontalShrink,
            newPosition.y + verticalShrink, // Shrink from bottom
            newPosition.z - halfSizeZ + horizontalShrink
        );
        const newMax = new THREE.Vector3(
            newPosition.x + halfSizeX - horizontalShrink,
            newPosition.y + brickSize.y - verticalShrink, // Shrink from top
            newPosition.z + halfSizeZ - horizontalShrink
        );

        const testBox = new THREE.Box3(newMin, newMax);

        // Check against all other placed bricks
        for (const otherBrick of this.placedBricks) {
            if (otherBrick === brick) continue; // Skip self

            const otherBox = new THREE.Box3().setFromObject(otherBrick);

            // Also shrink the other brick's box for stud interlocking
            otherBox.min.y += verticalShrink;
            otherBox.max.y -= verticalShrink;

            if (testBox.intersectsBox(otherBox)) {
                return true; // Collision detected
            }
        }

        return false; // No collision
    }

    checkCollision(brick, newPosition) {
        return this.wouldCollide(brick, newPosition);
    }

    // Find the lowest valid Y position for placing a brick at a given XZ coordinate
    findLowestValidY(x, z, brickToPlace, excludeBrick = null) {
        // Get the bounding box of the brick to place (to know its footprint)
        const brickBox = new THREE.Box3().setFromObject(brickToPlace);
        const brickSize = new THREE.Vector3();
        brickBox.getSize(brickSize);

        // Create a test box at the target XZ position at ground level
        const halfWidth = brickSize.x / 2;
        const halfDepth = brickSize.z / 2;

        // Find all bricks that overlap in XZ
        let highestY = 0; // Start at ground level

        for (const brick of this.placedBricks) {
            if (brick === excludeBrick) continue; // Skip the brick being dragged

            const otherBox = new THREE.Box3().setFromObject(brick);

            // Check XZ overlap (with small tolerance)
            const tolerance = 0.01;
            const overlapX = !(x + halfWidth <= otherBox.min.x + tolerance ||
                x - halfWidth >= otherBox.max.x - tolerance);
            const overlapZ = !(z + halfDepth <= otherBox.min.z + tolerance ||
                z - halfDepth >= otherBox.max.z - tolerance);

            if (overlapX && overlapZ) {
                // This brick overlaps in XZ, we need to stack on top of it
                // Subtract stud height for interlocking
                const stackY = otherBox.max.y - this.studHeight;
                if (stackY > highestY) {
                    highestY = stackY;
                }
            }
        }

        return highestY;
    }
}
