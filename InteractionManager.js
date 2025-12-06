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
        this.tempBox = new THREE.Box3();
        this.tempVector = new THREE.Vector3();

        this.mode = 'select'; // 'select' | 'place' | 'drag' | 'gizmo-drag'
        this.selectedObjects = new Set(); // Multi-selection support
        this.selectionBoxHelpers = new Map(); // Map object UUID -> BoxHelper

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
        this.objectDragStarts = new Map(); // Map uuid -> original position

        // Callbacks for UI
        this.onBrickAdded = null;
        this.onBrickRemoved = null;
        this.onSelectionChanged = null;

        this.initEvents();
        this.createGizmo();
    }

    // Helper to find object recursively
    findBrickByUuid(uuid) {
        // First check top level
        for (const brick of this.placedBricks) {
            if (brick.uuid === uuid) return brick;
            // Check children if group
            if (brick.isGroup && brick.children && brick.children.length > 0) {
                const found = brick.getObjectByProperty('uuid', uuid);
                if (found) return found;
            }
        }
        return null;
    }

    // Select object by UUID (for UI list)
    selectObjectByUuid(uuid, multi = false) {
        const object = this.findBrickByUuid(uuid);
        if (object) {
            this.setMode('select');
            this.selectObject(object, multi);
        }
    }

    // Toggle selection (for Ctrl+Click)
    toggleSelectionByUuid(uuid) {
        const object = this.findBrickByUuid(uuid);
        if (object) {
            this.setMode('select');
            if (this.selectedObjects.has(object)) {
                this.deselectObject(object);
            } else {
                this.selectObject(object, true); // true = additive
            }
        }
    }

    // Batch select by UUIDs (for Shift+Click)
    selectObjectsByUuids(uuids) {
        this.deselectAll();

        const objects = [];
        uuids.forEach(uuid => {
            const obj = this.findBrickByUuid(uuid);
            if (obj) objects.push(obj);
        });

        if (objects.length > 0) {
            this.setMode('select');
            objects.forEach(obj => {
                this.selectedObjects.add(obj);
                // Add helper
                if (!this.selectionBoxHelpers.has(obj.uuid)) {
                    const helper = new THREE.BoxHelper(obj, 0xffff00);
                    this.scene.add(helper);
                    this.selectionBoxHelpers.set(obj.uuid, helper);
                }
            });
            this.showGizmo();

            // Trigger callback once
            if (this.onSelectionChanged) {
                this.onSelectionChanged(Array.from(this.selectedObjects).map(o => o.uuid));
            }
        }
    }

    showGizmo() {
        if (this.selectedObjects.size === 0 || !this.gizmo) {
            this.hideGizmo();
            return;
        }

        // Calculate center of all selected objects
        const center = new THREE.Vector3();
        const box = new THREE.Box3();

        this.selectedObjects.forEach(obj => {
            // Ensure matrix world is updated for accurate box
            obj.updateMatrixWorld(true);
            box.expandByObject(obj);
        });

        if (box.isEmpty()) {
            // Fallback if box is empty (e.g. empty group or issue with geometry)
            const first = this.selectedObjects.values().next().value;
            if (first) center.copy(first.position);
        } else {
            box.getCenter(center);
        }

        // Safety check for NaN
        if (isNaN(center.x) || isNaN(center.y) || isNaN(center.z)) {
            console.warn('Gizmo center is NaN, falling back to safe default');
            const first = this.selectedObjects.values().next().value;
            if (first) center.copy(first.position);
            if (isNaN(center.x)) center.set(0, 0, 0);
        }

        this.gizmo.position.copy(center);
        this.gizmo.visible = true;
        console.log('Gizmo shown at center:', center);
    }

    updateGizmoPosition() {
        if (this.selectedObjects.size > 0 && this.gizmo && this.gizmo.visible) {
            const center = new THREE.Vector3();
            const box = new THREE.Box3();

            this.selectedObjects.forEach(obj => {
                box.expandByObject(obj);
            });

            if (box.isEmpty()) {
                const first = this.selectedObjects.values().next().value;
                if (first) center.copy(first.position);
            } else {
                box.getCenter(center);
            }

            if (isNaN(center.x) || isNaN(center.y) || isNaN(center.z)) {
                const first = this.selectedObjects.values().next().value;
                if (first) center.copy(first.position);
            }

            this.gizmo.position.copy(center);

            // Update all helpers
            this.selectionBoxHelpers.forEach(helper => helper.update());
        }
    }

    onClick(event) {
        if (this.mode === 'place') {
            if (!this.ghostBrick || !this.ghostBrick.visible) return;

            // Find intersection with ground plane for placement
            const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
            const intersectionPoint = new THREE.Vector3();

            this.raycaster.ray.intersectPlane(groundPlane, intersectionPoint);

            if (intersectionPoint) {
                // Snap to stud grid
                const snapped = this.snapToStudGrid(intersectionPoint.x, intersectionPoint.z, this.ghostBrick);

                // Clone the ghost to create a real brick
                const newBrick = this.brickManager.getBrick(this.selectedBrickName);
                if (newBrick) {
                    // Position and rotate the new brick
                    newBrick.position.set(snapped.x, 0, snapped.z);
                    newBrick.rotation.copy(this.ghostBrick.rotation);

                    // Check for volumetric overlaps and find best placement
                    const finalPosition = this.findValidPlacementPosition(newBrick);

                    // Apply the final position
                    newBrick.position.copy(finalPosition);

                    this.scene.add(newBrick);
                    this.placedBricks.push(newBrick);

                    if (this.onBrickAdded) {
                        this.onBrickAdded(newBrick);
                    }

                    // Keep the ghost brick visible for next placement
                    this.ghostBrick.visible = true;
                } else {
                    console.error('Failed to get brick from manager:', this.selectedBrickName);
                }
            } else {
                console.warn('No intersection with ground plane for brick placement');
            }
        } else if (this.mode === 'select') {
            this.raycaster.setFromCamera(this.mouse, this.camera);

            // First check if clicking on gizmo
            const gizmoAxis = this.getGizmoIntersection();
            if (gizmoAxis) return; // Gizmo handled by mousedown

            // Check if clicking on a brick
            const intersects = this.raycaster.intersectObjects(this.placedBricks, true);

            if (intersects.length > 0) {
                // Find visible top-level object
                let hitBrick = intersects[0].object;

                // Traverse up until we find a direct child of scene OR a known placed brick
                // Since we support groups now, a "placed brick" might be a Group or a Mesh
                while (hitBrick.parent && !this.placedBricks.includes(hitBrick)) {
                    hitBrick = hitBrick.parent;
                }

                if (this.placedBricks.includes(hitBrick)) {
                    const multi = event.ctrlKey || event.metaKey;
                    if (multi) {
                        if (this.selectedObjects.has(hitBrick)) {
                            this.deselectObject(hitBrick);
                        } else {
                            this.selectObject(hitBrick, true);
                        }
                    } else {
                        // Single select
                        this.selectObject(hitBrick, false);
                    }
                }
            } else {
                // Clicked empty space
                this.deselectAll();
                this.hideGizmo();
            }
        }
    }

    onMouseDown(event) {
        this.updateMouse(event);
        this.raycaster.setFromCamera(this.mouse, this.camera);

        if (this.mode === 'select' && this.selectedObjects.size > 0) {
            // Check if clicking on gizmo
            const gizmoAxis = this.getGizmoIntersection();
            if (gizmoAxis) {
                // Start gizmo drag
                this.mode = 'gizmo-drag';
                this.activeGizmoAxis = gizmoAxis;

                // Store original positions of ALL selected objects
                this.objectDragStarts.clear();
                this.selectedObjects.forEach(obj => {
                    this.objectDragStarts.set(obj.uuid, obj.position.clone());
                });

                // Get start position on the appropriate plane
                if (this.activeGizmoAxis === 'y') {
                    // For Y-axis, use a plane facing the camera to allow vertical drag
                    const normal = new THREE.Vector3();
                    this.camera.getWorldDirection(normal);
                    normal.y = 0;
                    normal.normalize();
                    if (normal.lengthSq() < 0.1) normal.set(0, 0, 1);
                    this.dragPlane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, this.gizmo.position);
                } else {
                    // For X/Z, use the ground plane
                    this.dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
                }

                const startPoint = new THREE.Vector3();
                this.raycaster.ray.intersectPlane(this.dragPlane, startPoint);

                if (startPoint) {
                    this.gizmoDragStart.copy(startPoint);
                    this.canvas.style.cursor = 'grabbing';
                    if (this.orbitControls) this.orbitControls.enabled = false;
                }
                return;
            }
        }
    }

    onMouseMove(event) {
        this.updateMouse(event);
        this.raycaster.setFromCamera(this.mouse, this.camera);

        // Handle brick placement mode
        if (this.mode === 'place' && this.ghostBrick) {
            // Find intersection with ground plane for placement
            const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
            const intersectionPoint = new THREE.Vector3();

            this.raycaster.ray.intersectPlane(groundPlane, intersectionPoint);

            if (intersectionPoint) {
                // Snap to stud grid
                const snapped = this.snapToStudGrid(intersectionPoint.x, intersectionPoint.z, this.ghostBrick);

                // Position the ghost brick
                this.ghostBrick.position.set(snapped.x, 0, snapped.z);

                // Check for volumetric overlaps and adjust ghost position
                const validPosition = this.findValidPlacementPosition(this.ghostBrick);
                this.ghostBrick.position.copy(validPosition);

                // Make ghost brick visible if it's not already
                if (!this.ghostBrick.visible) {
                    this.ghostBrick.visible = true;
                }
            }
        }
        else if (this.mode === 'gizmo-drag' && this.selectedObjects.size > 0 && this.activeGizmoAxis && this.dragPlane) {
            this.canvas.style.cursor = 'grabbing';
            const currentPoint = new THREE.Vector3();
            this.raycaster.ray.intersectPlane(this.dragPlane, currentPoint);

            if (currentPoint) {
                const delta = new THREE.Vector3().subVectors(currentPoint, this.gizmoDragStart);

                // Apply delta to ALL selected objects
                this.selectedObjects.forEach(obj => {
                    const originalPos = this.objectDragStarts.get(obj.uuid);
                    if (!originalPos) return;

                    const newPosition = originalPos.clone();

                    if (this.activeGizmoAxis === 'x') {
                        newPosition.x += delta.x;
                    } else if (this.activeGizmoAxis === 'y') {
                        newPosition.y += delta.y;
                    } else if (this.activeGizmoAxis === 'z') {
                        newPosition.z += delta.z;
                    } else if (this.activeGizmoAxis === 'center') {
                        newPosition.x += delta.x;
                        newPosition.z += delta.z;
                    }

                    // Snap to grid immediately during drag for visual feedback
                    const snapped = this.snapToStudGrid(newPosition.x, newPosition.z, obj);
                    newPosition.x = snapped.x;
                    newPosition.z = snapped.z;

                    // Clamping logic: Ensure no part of the geometry goes below 0
                    obj.updateMatrixWorld(true);
                    const box = new THREE.Box3().setFromObject(obj);
                    const currentBottomOffset = box.min.y - obj.position.y;

                    if (newPosition.y + currentBottomOffset < 0) {
                        newPosition.y = 0 - currentBottomOffset;
                    }

                    obj.position.copy(newPosition);
                });

                this.updateGizmoPosition();
            }
        }

        // Gizmo Highlight Logic
        if (this.mode === 'select' || (this.mode === 'gizmo-drag' && !this.isDragging)) {
            const axis = this.getGizmoIntersection();
            this.highlightGizmoAxis(axis);
        } else {
            this.resetGizmoHighlight();
        }
    }

    onMouseUp(event) {
        if (this.mode === 'gizmo-drag') {
            // Snap ALL objects
            this.selectedObjects.forEach(obj => {
                const snapped = this.snapToStudGrid(obj.position.x, obj.position.z, obj);

                // Correctly calculate offset so object sits ON the floor, not IN it
                obj.updateMatrixWorld(true);
                const box = new THREE.Box3().setFromObject(obj);
                const bottomOffset = obj.position.y - box.min.y;

                // Preserve current Y (user placement), but ensure it doesn't go below ground
                // We'll let findValidPlacementPosition handle the floor clamp, 
                // here we just ensure we don't reset to 0 blindly.
                obj.position.set(snapped.x, obj.position.y, snapped.z);

                const validPos = this.findValidPlacementPosition(obj);
                obj.position.copy(validPos);
            });

            this.updateGizmoPosition();
            this.mode = 'select';
            this.activeGizmoAxis = null;
            if (this.orbitControls) this.orbitControls.enabled = true;
        }

        this.isDragging = false;
        this.canvas.style.cursor = 'default';
    }

    selectObject(object, multi = false) {
        if (!multi) {
            this.deselectAll();
        }

        this.selectedObjects.add(object);

        // Add visual helper
        if (!this.selectionBoxHelpers.has(object.uuid)) {
            const helper = new THREE.BoxHelper(object, 0xffff00);
            this.scene.add(helper);
            this.selectionBoxHelpers.set(object.uuid, helper);
        }

        this.showGizmo();

        if (this.onSelectionChanged) {
            // Pass array of UUIDs
            this.onSelectionChanged(Array.from(this.selectedObjects).map(o => o.uuid));
        }
    }

    deselectObject(object) {
        this.selectedObjects.delete(object);

        const helper = this.selectionBoxHelpers.get(object.uuid);
        if (helper) {
            this.scene.remove(helper);
            this.selectionBoxHelpers.delete(object.uuid);
        }

        this.showGizmo(); // Update gizmo for remaining

        if (this.onSelectionChanged) {
            this.onSelectionChanged(Array.from(this.selectedObjects).map(o => o.uuid));
        }
    }

    deselectAll() {
        this.selectedObjects.forEach(obj => {
            const helper = this.selectionBoxHelpers.get(obj.uuid);
            if (helper) this.scene.remove(helper);
        });
        this.selectionBoxHelpers.clear();
        this.selectedObjects.clear();
        this.hideGizmo();

        if (this.onSelectionChanged) {
            this.onSelectionChanged([]);
        }
    }

    hideGizmo() {
        if (this.gizmo) this.gizmo.visible = false;
    }

    deleteSelected() {
        const uuids = [];
        this.selectedObjects.forEach(obj => {
            uuids.push(obj.uuid);
            this.scene.remove(obj);
            this.placedBricks = this.placedBricks.filter(b => b !== obj);

            const helper = this.selectionBoxHelpers.get(obj.uuid);
            if (helper) this.scene.remove(helper);
        });

        this.selectedObjects.clear();
        this.selectionBoxHelpers.clear();
        this.hideGizmo();

        if (this.onBrickRemoved) {
            uuids.forEach(uuid => this.onBrickRemoved(uuid));
        }
    }

    // GROUPING LOGIC

    groupSelected() {
        if (this.selectedObjects.size < 2) return;

        const group = new THREE.Group();
        group.name = "Group";

        // 1. Calculate center
        const center = new THREE.Vector3();
        const box = new THREE.Box3();
        this.selectedObjects.forEach(obj => box.expandByObject(obj));
        box.getCenter(center);

        group.position.copy(center);
        this.scene.add(group);

        // 2. Attach objects to group (preserves world transform)
        const objectsToGroup = Array.from(this.selectedObjects);
        objectsToGroup.forEach(obj => {
            this.scene.remove(obj); // Detach from scene logic handled by attach? 
            // THREE.Object3D.attach removes from parent automatically.
            group.attach(obj);

            // Remove from placedBricks list
            this.placedBricks = this.placedBricks.filter(b => b !== obj);

            // Notify UI about removal (visual only)
            if (this.onBrickRemoved) this.onBrickRemoved(obj.uuid);
        });

        // 3. Add group to placedBricks
        this.placedBricks.push(group);
        if (this.onBrickAdded) this.onBrickAdded(group);

        // 4. Select the new group
        this.selectObject(group, false);
    }

    ungroupSelected() {
        if (this.selectedObjects.size !== 1) return;
        const group = this.selectedObjects.values().next().value;
        if (!group.isGroup) return;

        const children = [...group.children]; // snapshot

        // 1. Move children back to scene
        children.forEach(child => {
            this.scene.attach(child);
            this.placedBricks.push(child);
            if (this.onBrickAdded) this.onBrickAdded(child);
        });

        // 2. Remove group
        this.scene.remove(group);
        this.placedBricks = this.placedBricks.filter(b => b !== group);
        if (this.onBrickRemoved) this.onBrickRemoved(group.uuid);

        // 3. Select children
        this.deselectAll();
        children.forEach(child => this.selectObject(child, true));
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

    // Check if two boxes overlap volumetrically
    checkBoxOverlap(box1, box2) {
        const intersection = box1.clone().intersect(box2);
        if (intersection.isEmpty()) return false;

        const size = new THREE.Vector3();
        intersection.getSize(size);

        // Allow touching faces by ignoring tiny overlaps
        const epsilon = 1e-4;
        return size.x > epsilon && size.y > epsilon && size.z > epsilon;
    }

    // Find the highest non-overlapping position for stacking
    findStackingPosition(brick, targetX, targetZ) {
        // Create box for the brick at target position
        const brickBox = new THREE.Box3();
        brick.position.set(targetX, 0, targetZ);
        brick.updateMatrixWorld();
        brickBox.setFromObject(brick);

        let maxY = 0; // Start at ground level (y=0)

        // Check all placed bricks for potential stacking
        for (const placedBrick of this.placedBricks) {
            if (placedBrick === brick) continue;

            // Create box for placed brick
            const placedBox = new THREE.Box3();
            placedBrick.updateMatrixWorld();
            placedBox.setFromObject(placedBrick);

            // Check if they overlap in XZ plane (ignoring Y)
            const brickBox2D = new THREE.Box3();
            brickBox2D.min.copy(brickBox.min);
            brickBox2D.max.copy(brickBox.max);
            brickBox2D.min.y = -Infinity;
            brickBox2D.max.y = Infinity;

            const placedBox2D = new THREE.Box3();
            placedBox2D.min.copy(placedBox.min);
            placedBox2D.max.copy(placedBox.max);
            placedBox2D.min.y = -Infinity;
            placedBox2D.max.y = Infinity;

            if (brickBox2D.intersectsBox(placedBox2D)) {
                // They overlap in XZ, check if we can stack on top
                // For proper LEGO stacking, we need to account for the brick's height
                // Subtract studHeight to allow interlocking
                const topOfPlacedBrick = placedBox.max.y - this.studHeight;
                if (topOfPlacedBrick > maxY) {
                    maxY = topOfPlacedBrick;
                }
            }
        }

        // For LEGO bricks, the stacking should be tight - no gap
        // The brick's own geometry will handle the stud/tube connection
        return maxY;
    }

    // Snap studs of the new brick to studs of the existing brick below
    snapStudsToBrick(newBrick, baseBrick, targetX, targetZ) {
        // Get the stud spacing from the interaction manager
        const studSpacing = this.studSpacing;

        // Create boxes for both bricks
        const newBrickBox = new THREE.Box3();
        newBrick.position.set(targetX, 0, targetZ);
        newBrick.updateMatrixWorld();
        newBrickBox.setFromObject(newBrick);

        const baseBrickBox = new THREE.Box3();
        baseBrick.updateMatrixWorld();
        baseBrickBox.setFromObject(baseBrick);

        // Calculate the center positions
        const newBrickCenter = new THREE.Vector3();
        newBrickBox.getCenter(newBrickCenter);

        const baseBrickCenter = new THREE.Vector3();
        baseBrickBox.getCenter(baseBrickCenter);

        // Calculate the offset between centers
        const xOffset = newBrickCenter.x - baseBrickCenter.x;
        const zOffset = newBrickCenter.z - baseBrickCenter.z;

        // Snap to nearest stud position
        const snappedX = baseBrickCenter.x + Math.round(xOffset / studSpacing) * studSpacing;
        const snappedZ = baseBrickCenter.z + Math.round(zOffset / studSpacing) * studSpacing;

        return new THREE.Vector3(snappedX, newBrickCenter.y, snappedZ);
    }

    // Find valid placement position considering overlaps and stacking
    findValidPlacementPosition(brick) {
        // Create bounding box for the brick at its current position
        const brickBox = new THREE.Box3();
        brick.updateMatrixWorld();
        brickBox.setFromObject(brick);

        // Check for overlaps with existing bricks
        let hasOverlap = false;
        let bestY = brick.position.y;
        let stackingBrick = null;

        for (const placedBrick of this.placedBricks) {
            if (placedBrick === brick) continue;

            const placedBox = new THREE.Box3();
            placedBrick.updateMatrixWorld();
            placedBox.setFromObject(placedBrick);

            if (this.checkBoxOverlap(brickBox, placedBox)) {
                hasOverlap = true;
                // Try stacking on top of this brick
                const stackY = this.findStackingPosition(brick, brick.position.x, brick.position.z);
                if (stackY > bestY) {
                    bestY = stackY;
                    stackingBrick = placedBrick;
                }
            }
        }

        // If no overlap, ensure placement as close to canvas as possible
        if (!hasOverlap) {
            // Keep current height, but ensure it doesn't go below ground
            const result = brick.position.clone();

            // Calculate offset to keep bottom at y=0
            const box = new THREE.Box3().setFromObject(brick);
            const bottomOffset = brick.position.y - box.min.y;

            // If the bottom is below 0, snap to 0. Otherwise keep it.
            if (result.y < bottomOffset) {
                result.y = bottomOffset;
            }

            return result;
        }

        // If we have a stacking brick, try to snap studs together
        if (stackingBrick) {
            const snappedPosition = this.snapStudsToBrick(brick, stackingBrick, brick.position.x, brick.position.z);
            const result = snappedPosition.clone();

            // Calculate offset to keep bottom at bestY
            const box = new THREE.Box3().setFromObject(brick);
            const bottomOffset = brick.position.y - box.min.y;

            result.y = bestY + bottomOffset;
            return result;
        }

        // Return the best stacking position

        // Calculate offset to keep bottom at bestY
        const box = new THREE.Box3().setFromObject(brick);
        const bottomOffset = brick.position.y - box.min.y;

        const result = brick.position.clone();
        result.y = bestY + bottomOffset;
        return result;
    }

    initEvents() {
        this.canvas.addEventListener('mousemove', (e) => this.onMouseMove(e));
        this.canvas.addEventListener('click', (e) => this.onClick(e));
        this.canvas.addEventListener('mousedown', (e) => this.onMouseDown(e));
        this.canvas.addEventListener('mouseup', (e) => this.onMouseUp(e));
        window.addEventListener('keydown', (e) => this.onKeyDown(e));
    }

    // Update mouse coordinates from event
    updateMouse(event) {
        // Calculate mouse position in normalized device coordinates (-1 to +1)
        const rect = this.canvas.getBoundingClientRect();
        this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
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
            this.deselectAll();
            this.canvas.style.cursor = 'none'; // Or crosshair
        }
    }

    selectBrick(name) {
        console.log('selectBrick called with:', name);
        this.setMode('place');
        this.selectedBrickName = name;

        this.removeGhost();
        this.removeDragGhost();

        // Create new ghost for placement
        const brick = this.brickManager.getBrick(name);
        console.log('Got brick from manager:', brick);
        if (brick) {
            // Clone the brick to avoid modifying the original
            this.ghostBrick = brick.clone();
            this.ghostBrick.name = brick.name; // Preserve name
            console.log('Created ghost brick:', this.ghostBrick);

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
            console.log('Ghost brick added to scene');
        } else {
            console.error('Failed to get brick from manager for name:', name);
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
}
