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
        this.gizmoDragOccurred = false; // Flag to prevent click after gizmo drag

        // Transform gizmo
        this.gizmo = null;
        this.gizmoArrows = { x: null, y: null, z: null };
        this.gizmoCenterHandle = null;
        this.gizmoRotationRing = null;
        this.activeGizmoAxis = null; // 'x', 'y', 'z', 'center', or 'rotate'
        this.gizmoDragStart = new THREE.Vector3();
        this.dragStartMouse = new THREE.Vector2(); // For vertical drag sensitivity
        this.verticalDragFactor = 1.0; // Sensitivity for vertical drag
        this.objectDragStarts = new Map(); // Map uuid -> original position
        this.objectRotationStarts = new Map(); // Map uuid -> original rotation
        this.initialRingRotationZ = 0; // Initial rotation of the rotation ring

        // Callbacks for UI
        this.onBrickAdded = null;
        this.onBrickRemoved = null;
        this.onSelectionChanged = null;

        this.initEvents();
        this.createGizmo();
    }

    // Helper to find object recursively
    findBrickByUuid(uuid) {
        // Recursive helper function
        const searchInObject = (obj) => {
            if (obj.uuid === uuid) return obj;

            // If this is a group, search its children
            if (obj.isGroup && obj.children && obj.children.length > 0) {
                for (const child of obj.children) {
                    const found = searchInObject(child);
                    if (found) return found;
                }
            }

            return null;
        };

        // Search in all placed bricks
        for (const brick of this.placedBricks) {
            const found = searchInObject(brick);
            if (found) return found;
        }

        return null;
    }

    // Select object by UUID (for UI list)
    selectObjectByUuid(uuid, multi = false) {
        const object = this.findBrickByUuid(uuid);
        console.log('selectObjectByUuid:', uuid, 'found:', !!object, object ? object.name : 'N/A');
        if (object) {
            this.setMode('select');
            this.selectObject(object, multi);
        } else {
            console.warn('Could not find object with UUID:', uuid);
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

        // Scale gizmo based on selected object size
        this.updateGizmoScale(box);

        this.gizmo.visible = true;
    }

    updateGizmoScale(box) {
        // Calculate the size of the selection box
        const size = new THREE.Vector3();
        box.getSize(size);

        // Find the largest dimension
        const maxDimension = Math.max(size.x, size.y, size.z);

        // Minimum gizmo scale (when object is very small)
        const minArrowLength = 4.0;
        const minRotationRingRadius = 3.0;

        // Calculate required scale: object size + 25% margin
        // The gizmo should extend to at least maxDimension * 0.625 (1.25 * 0.5, since gizmo extends from center)
        const requiredReach = (maxDimension * 1.25) / 2; // 25% outside means 1.25x from center

        // Scale factor: how much we need to scale the gizmo
        // Use the larger of: minimum size or required reach
        const scaleMultiplier = Math.max(1.0, requiredReach / minArrowLength);

        // Apply scaling to arrows
        this.gizmo.traverse((child) => {
            if (child.name === 'gizmo-x' || child.name === 'gizmo-y' || child.name === 'gizmo-z') {
                // Scale the arrow group
                child.scale.set(scaleMultiplier, scaleMultiplier, scaleMultiplier);
            }
        });

        // Update rotation ring radius
        if (this.gizmoRotationRing) {
            this.gizmoRotationRing.scale.set(scaleMultiplier, scaleMultiplier, scaleMultiplier);
        }

        // Update center handle size
        if (this.gizmoCenterHandle) {
            this.gizmoCenterHandle.scale.set(scaleMultiplier, scaleMultiplier, scaleMultiplier);
        }

        // Update label positions and sizes
        if (this.gizmoLabels) {
            const labelDistance = 4.5 * scaleMultiplier;

            if (this.gizmoLabels.x) {
                this.gizmoLabels.x.position.set(labelDistance, 0, 0);
                this.gizmoLabels.x.scale.set(scaleMultiplier, scaleMultiplier, 1);
            }

            if (this.gizmoLabels.y) {
                this.gizmoLabels.y.position.set(0, labelDistance, 0);
                this.gizmoLabels.y.scale.set(scaleMultiplier, scaleMultiplier, 1);
            }

            if (this.gizmoLabels.z) {
                this.gizmoLabels.z.position.set(0, 0, labelDistance);
                this.gizmoLabels.z.scale.set(scaleMultiplier, scaleMultiplier, 1);
            }
        }
    }

    updateGizmoPosition() {
        if (this.selectedObjects.size > 0 && this.gizmo && this.gizmo.visible) {
            const center = new THREE.Vector3();
            const box = new THREE.Box3();

            this.selectedObjects.forEach(obj => {
                obj.updateMatrixWorld(true);
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

            // Update gizmo scale based on current selection size
            this.updateGizmoScale(box);

            // Update all helpers
            this.selectionBoxHelpers.forEach(helper => helper.update());
        }
    }

    onClick(event) {
        // Prevent selection if we just finished a gizmo drag
        if (this.gizmoDragOccurred) {
            this.gizmoDragOccurred = false;
            return;
        }

        if (this.mode === 'place') {
            if (!this.ghostBrick || !this.ghostBrick.visible) return;

            // Find intersection with ground plane for placement
            const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
            const intersectionPoint = new THREE.Vector3();

            this.raycaster.ray.intersectPlane(groundPlane, intersectionPoint);

            if (intersectionPoint) {
                // Snap to stud grid
                const snapped = this.snapToStudGrid(intersectionPoint.x, intersectionPoint.z, this.ghostBrick);

                // Get the selected color (default to white if not set)
                const selectedColor = window.selectedColor || 'White';

                // Clone the ghost to create a real brick with selected color
                const newBrick = this.brickManager.getBrickWithColor(this.selectedBrickName, selectedColor);
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

            // Check if clicking on a brick - use a comprehensive search
            let intersects = this.raycaster.intersectObjects(this.placedBricks, true);

            // If no direct hits, try a broader search including scene children
            if (intersects.length === 0) {
                intersects = this.raycaster.intersectObjects(this.scene.children, true);
            }

            // If still no hits, try searching all mesh objects in the scene
            if (intersects.length === 0) {
                const allMeshes = [];
                this.scene.traverse((child) => {
                    if (child.isMesh) {
                        allMeshes.push(child);
                    }
                });
                intersects = this.raycaster.intersectObjects(allMeshes, true);
            }

            if (intersects.length > 0) {
                // Find the actual intersected object in our hierarchy
                let hitBrick = intersects[0].object;

                console.log('Clicked on object:', hitBrick.name, 'Type:', hitBrick.type, 'UUID:', hitBrick.uuid);

                // Determine the object to select
                let foundObject = hitBrick;

                // If the hit object is inside a group, select the immediate parent group
                if (hitBrick.parent && hitBrick.parent.isGroup && hitBrick.parent !== this.scene) {
                    foundObject = hitBrick.parent;
                    console.log('Selecting immediate parent group:', foundObject.name);
                }

                // Check if this foundObject is selectable (in placedBricks hierarchy)
                let isSelectable = false;
                if (this.placedBricks.includes(foundObject)) {
                    isSelectable = true;
                    console.log('Direct selectable object:', foundObject.name);
                } else {
                    // Check if it's in the hierarchy of a placed brick
                    for (const brick of this.placedBricks) {
                        if (brick.isGroup && brick.children && brick.children.length > 0) {
                            const found = brick.getObjectByProperty('uuid', foundObject.uuid);
                            if (found) {
                                isSelectable = true;
                                console.log('Found in hierarchy of:', brick.name);
                                break;
                            }
                        }
                    }
                }

                // If we found something selectable, select it
                if (isSelectable) {
                    const multi = event.ctrlKey || event.metaKey;
                    if (multi) {
                        if (this.selectedObjects.has(foundObject)) {
                            this.deselectObject(foundObject);
                        } else {
                            this.selectObject(foundObject, true);
                        }
                    } else {
                        // Single select
                        this.selectObject(foundObject, false);
                    }
                } else {
                    console.log('No selectable object found for hit brick');
                }
            } else {
                console.log('No objects found at click position');
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
                this.isDragging = true;

                // Store original positions and rotations of ALL selected objects
                this.objectDragStarts.clear();
                this.objectRotationStarts.clear();
                this.selectedObjects.forEach(obj => {
                    this.objectDragStarts.set(obj.uuid, obj.position.clone());
                    this.objectRotationStarts.set(obj.uuid, obj.rotation.clone());
                });

                // Store initial rotation ring rotation for visual feedback
                if (gizmoAxis === 'rotate') {
                    this.initialRingRotationZ = this.gizmoRotationRing.rotation.z;
                }

                // Use the ground plane for all axes to allow proper delta calculation
                this.dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

                const startPoint = new THREE.Vector3();
                this.raycaster.ray.intersectPlane(this.dragPlane, startPoint);

                if (startPoint) {
                    this.gizmoDragStart.copy(startPoint);
                    this.dragStartMouse.copy(this.mouse);
                    // Compute vertical drag sensitivity based on camera distance
                    this.verticalDragFactor = this.camera.position.distanceTo(startPoint) * 0.5;
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
                if (this.activeGizmoAxis === 'rotate') {
                    // Handle rotation around Y axis
                    const gizmoCenter = this.gizmo.position.clone();
                    const startVector = this.gizmoDragStart.clone().sub(gizmoCenter).normalize();
                    const currentVector = currentPoint.clone().sub(gizmoCenter).normalize();

                    // Calculate angle difference
                    // Calculate angle difference
                    const angle = Math.atan2(currentVector.z, currentVector.x) - Math.atan2(startVector.z, startVector.x);

                    console.log('Rotation angle:', angle * 180 / Math.PI, 'degrees');

                    // Update rotation ring to show current rotation
                    // Invert angle for ring because its local Z axis is inverted relative to world Y due to X rotation
                    this.gizmoRotationRing.rotation.z = this.initialRingRotationZ - angle;

                    // Apply rotation to ALL selected objects
                    this.selectedObjects.forEach(obj => {
                        const originalRotation = this.objectRotationStarts.get(obj.uuid);
                        if (!originalRotation) return;

                        const newRotation = originalRotation.clone();
                        newRotation.y = originalRotation.y + angle;

                        obj.rotation.copy(newRotation);
                        console.log('Object rotation:', obj.rotation.y * 180 / Math.PI, 'degrees');
                    });
                } else {
                    let delta = new THREE.Vector3();
                    if (this.activeGizmoAxis === 'y') {
                        // Vertical drag: compute delta based on mouse Y movement
                        const mouseDeltaY = this.mouse.y - this.dragStartMouse.y;
                        delta.y = mouseDeltaY * this.verticalDragFactor;
                        delta.x = 0;
                        delta.z = 0;
                    } else {
                        delta.subVectors(currentPoint, this.gizmoDragStart);
                    }

                    // Apply delta to ALL selected objects
                    this.selectedObjects.forEach(obj => {
                        const originalPos = this.objectDragStarts.get(obj.uuid);
                        if (!originalPos) return;

                        const newPosition = originalPos.clone();

                        if (this.activeGizmoAxis === 'x') {
                            newPosition.x += delta.x;
                        } else if (this.activeGizmoAxis === 'y') {
                            newPosition.y += delta.y;
                            // Snap Y to vertical grid (brick height - stud height)
                            if (this.verticalGridSize > 0) {
                                newPosition.y = Math.round(newPosition.y / this.verticalGridSize) * this.verticalGridSize;
                            }
                            // Clamp to ground (Y >= 0)
                            if (newPosition.y < 0) newPosition.y = 0;
                        } else if (this.activeGizmoAxis === 'z') {
                            newPosition.z += delta.z;
                        } else if (this.activeGizmoAxis === 'center') {
                            newPosition.x += delta.x;
                            newPosition.z += delta.z;
                            newPosition.y = originalPos.y;
                        }

                        // Snap X and Z to stud grid
                        const snapped = this.snapToStudGrid(newPosition.x, newPosition.z, obj);
                        newPosition.x = snapped.x;
                        newPosition.z = snapped.z;

                        // Apply the new approximate position first so we can check it
                        obj.position.copy(newPosition);

                        // Skip collision detection during drag to prevent jumping.
                        // Validation will be applied on mouse up.
                        // const validPos = this.findValidPlacementPosition(obj);
                        // obj.position.copy(validPos);
                    });
                }

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
            // Mark that a gizmo drag just occurred to prevent click selection
            this.gizmoDragOccurred = true;

            // Because onMouseMove now handles the heavy lifting of collision and stacking,
            // we simply need to ensure the gizmo is updated and state is reset.
            // The position is already valid.

            this.selectedObjects.forEach(obj => {
                if (this.activeGizmoAxis === 'rotate') {
                    // Snap rotation to 90-degree increments
                    const snappedRotationY = Math.round(obj.rotation.y / (Math.PI / 2)) * (Math.PI / 2);
                    obj.rotation.y = snappedRotationY;
                    // Update rotation ring to match snapped rotation
                    this.gizmoRotationRing.rotation.z = snappedRotationY;
                } else {
                    // One final sanity check to ensure grid alignment
                    const snapped = this.snapToStudGrid(obj.position.x, obj.position.z, obj);
                    obj.position.x = snapped.x;
                    obj.position.z = snapped.z;

                    // Re-validate strictly one last time to ensure no slight drifts.
                    // NOTE: We only apply full Y-validation if the Y-axis was dragged
                    // or if it was a placement, otherwise the XZ drag over/under
                    // objects would cause "jumping".
                    if (this.activeGizmoAxis === 'y' || this.activeGizmoAxis === null) {
                        const validPos = this.findValidPlacementPosition(obj);
                        obj.position.copy(validPos);
                    } else {
                        // For X/Z/Center drag, just ensure we don't sink below the ground (Y>=0)
                        if (obj.position.y < 0) obj.position.y = 0;
                    }
                }

                console.log("Brick dropped at:", obj.position, "rotation:", obj.rotation.y);
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
        const objectsToRemove = Array.from(this.selectedObjects);

        objectsToRemove.forEach(obj => {
            // Find the immediate parent group (closest parent)
            let immediateParentGroup = null;
            if (obj.parent && obj.parent !== this.scene && obj.parent.isGroup) {
                immediateParentGroup = obj.parent;
            }

            if (immediateParentGroup) {
                // This is a child of a group - remove it completely from the scene
                console.log('Deleting individual brick from group:', obj.name);

                uuids.push(obj.uuid);

                // Remove from group (don't add back to scene)
                immediateParentGroup.remove(obj);

                // Check if group is now empty and should be removed
                if (immediateParentGroup.children.length === 0) {
                    console.log('Group is now empty, removing group:', immediateParentGroup.name);
                    this.scene.remove(immediateParentGroup);
                    this.placedBricks = this.placedBricks.filter(b => b !== immediateParentGroup);
                    uuids.push(immediateParentGroup.uuid);
                }
            } else {
                // This is a direct object in placedBricks (group or individual brick)
                console.log('Removing direct object:', obj.name);
                uuids.push(obj.uuid);
                this.scene.remove(obj);
                this.placedBricks = this.placedBricks.filter(b => b !== obj);
            }

            const helper = this.selectionBoxHelpers.get(obj.uuid);
            if (helper) this.scene.remove(helper);
        });

        this.selectedObjects.clear();
        this.selectionBoxHelpers.clear();
        this.hideGizmo();

        if (this.onBrickRemoved) {
            // Remove duplicates from uuids array
            const uniqueUuids = [...new Set(uuids)];
            uniqueUuids.forEach(uuid => this.onBrickRemoved(uuid));
        }

        // Clean up groups with single children
        this.cleanupSingleChildGroups();

        // Trigger selection changed callback to update UI
        if (this.onSelectionChanged) {
            this.onSelectionChanged([]);
        }
    }

    duplicateSelected() {
        if (this.selectedObjects.size === 0) return;

        const newObjects = [];
        let offsetIndex = 0;

        this.selectedObjects.forEach(obj => {
            const cloned = obj.clone();

            // Deep clone materials to prevent shared material references
            cloned.traverse(child => {
                if (child.material) {
                    if (Array.isArray(child.material)) {
                        child.material = child.material.map(mat => mat.clone());
                    } else {
                        child.material = child.material.clone();
                    }
                }
            });

            // Offset position to avoid overlap
            cloned.position.x += (offsetIndex + 1) * this.studSpacing * 2;

            // Add to scene
            this.scene.add(cloned);

            // Add to placed bricks
            this.placedBricks.push(cloned);

            // Notify UI
            if (this.onBrickAdded) {
                this.onBrickAdded(cloned);
            }

            newObjects.push(cloned);
            offsetIndex++;
        });

        // Deselect old objects and select new ones
        this.deselectAll();
        newObjects.forEach(obj => this.selectObject(obj, true));
    }

    // GROUPING LOGIC

    groupSelected() {
        if (this.selectedObjects.size < 2) return;

        const objectsToGroup = Array.from(this.selectedObjects);

        // Check if all objects are at the same hierarchical level (same parent)
        let commonParent = null;

        for (const obj of objectsToGroup) {
            const objParent = obj.parent;

            if (commonParent === null) {
                commonParent = objParent;
            } else if (objParent !== commonParent) {
                // Objects are at different hierarchical levels - should not happen
                // because button should be disabled in this case
                console.warn('Cannot group objects at different hierarchical levels');
                return;
            }
        }

        const group = new THREE.Group();
        group.name = "Group";

        // Use the common parent as target
        const targetParent = commonParent || this.scene;

        // Calculate center in world space
        const center = new THREE.Vector3();
        const box = new THREE.Box3();
        objectsToGroup.forEach(obj => {
            obj.updateMatrixWorld(true);
            box.expandByObject(obj);
        });
        box.getCenter(center);

        group.position.copy(center);
        targetParent.add(group);
        group.updateMatrixWorld(true);

        // Attach objects to group
        objectsToGroup.forEach(obj => {
            group.attach(obj);

            // Remove from placedBricks list only if they were directly in placedBricks
            if (this.placedBricks.includes(obj)) {
                this.placedBricks = this.placedBricks.filter(b => b !== obj);
            }

            // Notify UI about removal (visual only)
            if (this.onBrickRemoved) this.onBrickRemoved(obj.uuid);
        });

        // Add group to placedBricks only if it's added directly to the scene
        if (targetParent === this.scene) {
            this.placedBricks.push(group);
            if (this.onBrickAdded) this.onBrickAdded(group);
        }

        // Select the new group
        this.selectObject(group, false);
    }

    ungroupSelected() {
        if (this.selectedObjects.size !== 1) return;
        const group = this.selectedObjects.values().next().value;
        if (!group.isGroup) return;

        // Recursively ungroup groups that end up with only one child
        this.ungroupRecursively(group);

        // Select the final children after all ungrouping is done
        this.deselectAll();
        // Find the children of the original group (they may have been moved)
        const finalChildren = [];
        if (group.parent) {
            // Find children that were originally in the group
            group.parent.children.forEach(child => {
                if (child !== group) { // group is already removed
                    finalChildren.push(child);
                }
            });
        }
        finalChildren.forEach(child => this.selectObject(child, true));
    }

    // Helper method to remove groups with only one child (recursively checks nested groups)
    cleanupSingleChildGroups() {
        let groupsRemoved = [];

        // Recursive helper to check and ungroup single-child groups
        const checkAndUngroupRecursive = (parent) => {
            // Check all children of this parent
            for (let i = parent.children.length - 1; i >= 0; i--) {
                const child = parent.children[i];

                // First, recursively check this child's children
                if (child.isGroup) {
                    checkAndUngroupRecursive(child);
                }

                // Now check if this child is a group with only one child
                if (child.isGroup && child.children.length === 1) {
                    console.log('Found group with single child, ungrouping:', child.name);

                    const grandchild = child.children[0];

                    // Move grandchild to parent
                    parent.attach(grandchild);

                    // Remove the single-child group from parent
                    parent.remove(child);

                    // If grandchild was in placedBricks, keep it; if group was in placedBricks, remove it
                    if (this.placedBricks.includes(child)) {
                        this.placedBricks = this.placedBricks.filter(b => b !== child);
                        if (grandchild.isMesh || grandchild.isGroup) {
                            this.placedBricks.push(grandchild);
                        }
                    }

                    // Notify about group removal
                    if (this.onBrickRemoved) this.onBrickRemoved(child.uuid);

                    groupsRemoved.push(child.uuid);
                }
            }
        };

        // Check all top-level placed bricks
        checkAndUngroupRecursive(this.scene);

        return groupsRemoved;
    }

    // Helper method to recursively ungroup groups with only one child
    ungroupRecursively(group) {
        const children = [...group.children]; // snapshot

        // Determine if this is a top-level group (directly in scene)
        const isTopLevelGroup = group.parent === this.scene;

        // 1. Move children back to their appropriate parent
        children.forEach(child => {
            if (group.parent) {
                group.parent.attach(child);
            } else {
                this.scene.attach(child);
            }
            // Only add to placedBricks if ungrouping a top-level group
            if (isTopLevelGroup) {
                this.placedBricks.push(child);
                if (this.onBrickAdded) this.onBrickAdded(child);
            }
        });

        // 2. Remove group from its parent
        if (group.parent) {
            group.parent.remove(group);
        } else {
            this.scene.remove(group);
        }
        this.placedBricks = this.placedBricks.filter(b => b !== group);
        if (this.onBrickRemoved) this.onBrickRemoved(group.uuid);

        // 3. Check if parent now has only one child and should be ungrouped
        if (group.parent && group.parent.isGroup && group.parent.children.length === 1) {
            // Parent has only one child, ungroup it recursively
            this.ungroupRecursively(group.parent);
        }
    }

    // Configure stud grid settings from baseplate
    setStudGrid(studSpacing, studHeight, startX, startZ, brickHeight = 0.96) {
        this.studSpacing = studSpacing;
        this.studHeight = studHeight;
        this.brickHeight = brickHeight;
        this.verticalGridSize = brickHeight - studHeight; // Height of brick body (without stud)
        this.gridStartX = startX;
        this.gridStartZ = startZ;
        this.gridSize = studSpacing; // Keep legacy property in sync
        console.log('Stud grid configured:', { studSpacing, studHeight, brickHeight, startX, startZ });
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
        // Shrink boxes slightly to avoid detecting touching faces as overlap
        const epsilon = 0.01; // Increased from 1e-4 to 0.01 to reduce sensitivity
        const intersection = box1.clone().expandByScalar(-epsilon).intersect(box2.clone().expandByScalar(-epsilon));

        if (intersection.isEmpty()) return false;

        const size = new THREE.Vector3();
        intersection.getSize(size);

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

            // Expand boxes slightly to account for floating point errors
            const epsilon = 0.001;
            brickBox2D.expandByScalar(epsilon);
            placedBox2D.expandByScalar(epsilon);

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
    // In InteractionManager.js

    findValidPlacementPosition(brick) {
        // Helper: Recursively get all mesh children from a brick/group
        const getMeshes = (obj) => {
            let meshes = [];
            if (obj.isMesh) {
                meshes.push(obj);
            } else if (obj.isGroup) {
                obj.children.forEach(child => {
                    meshes = meshes.concat(getMeshes(child));
                });
            }
            return meshes;
        };

        // Get all meshes that constitute the object being placed
        let draggedMeshes = getMeshes(brick);

        // Create a Set of dragged mesh UUIDs for fast exclusion
        const draggedMeshIDs = new Set(draggedMeshes.map(m => m.uuid));

        let requiredGroupY = -Infinity; // Start with no constraint
        let constrained = false;

        // Flatten the placed bricks list into a list of actual physical meshes
        // EXCLUDING any meshes that are part of the dragged object (to handle nested groups)
        const allPlacedMeshes = [];
        this.placedBricks.forEach(pb => {
            // Skip the brick itself if it's already in the placed list
            if (pb === brick) return;

            // Get all meshes from this placed brick
            const meshes = getMeshes(pb);

            // Add only those that are NOT part of the dragged object
            meshes.forEach(m => {
                if (!draggedMeshIDs.has(m.uuid)) {
                    allPlacedMeshes.push(m);
                }
            });
        });

        // We also need to check against the ground!
        // The ground is essentially a constraint at Y=0.
        // For every part of the dragged object, its Y world position must be >= 0.
        // Thus, the group position must be such that (groupPos.y + partOffset.y) >= 0.
        // => groupPos.y >= -partOffset.y

        // Let's iterate through all parts of our dragged group/brick
        for (const part of draggedMeshes) {
            // Get the part's world bounding box relative to the group's current position
            // But we want to simulate this:
            // The group is at some (X, Z) and we are looking for Y.
            // part.position is relative to group.
            // We need part's World(X, Z) and its relative Y to the group.

            // Since 'brick' (the group) is at its current position, we can use its current world matrix
            // BUT we only care about X and Z fixed.

            // To simplify: Let's calculate the part's offset from the group origin
            const partWorldPos = new THREE.Vector3();
            part.getWorldPosition(partWorldPos);
            // Note: brick.position gives the group's origin.
            // partWorldPos.y - brick.position.y is the vertical offset.

            // Get part's bounding box in world space (current)
            const partBox = new THREE.Box3().setFromObject(part);

            // We want to find the lowest Y for the *Group Origin* such that this part is valid.

            // 1. Ground Constraint
            // The bottom of this part must be >= 0.
            // partBottom_World = GroupY + (partBox.min.y - brick.position.y)
            // Let partBottomOffset = partBox.min.y - brick.position.y
            // GroupY + partBottomOffset >= 0
            // GroupY >= -partBottomOffset

            const partBottomOffset = partBox.min.y - brick.position.y;
            const groundConstraintY = -partBottomOffset;

            if (groundConstraintY > requiredGroupY) {
                requiredGroupY = groundConstraintY;
                constrained = true;
            }

            // 2. Stacking Constraint against all other placed meshes

            // Slight epsilon for X/Z to allow touching without overlap
            const epsilon = 0.05;
            const partMinX = partBox.min.x + epsilon;
            const partMaxX = partBox.max.x - epsilon;
            const partMinZ = partBox.min.z + epsilon;
            const partMaxZ = partBox.max.z - epsilon;

            for (const otherMesh of allPlacedMeshes) {
                const otherBox = new THREE.Box3().setFromObject(otherMesh);

                // IGNORE objects unless we are essentially "on top" of them.
                // To prevent "jumping" when sliding sideways or moving downwards through hollow objects,
                // we only stack if the part is already at (or above) the stacking surface.

                // Allow a small overlap (tolerance) to account for studs or slight misalignment.
                // If we penetrate deeper than this tolerance, we assume the user intends to clip/pass through
                // (or that the object should not be supported by this specific mesh).
                const stackTolerance = (this.studHeight || 0.16) * 1.5;

                if (partBox.min.y < otherBox.max.y - stackTolerance) {
                    continue;
                }

                // Strict X/Z Overlap Check between this part and the other mesh
                const overlapX = (partMaxX > otherBox.min.x && partMinX < otherBox.max.x);
                const overlapZ = (partMaxZ > otherBox.min.z && partMinZ < otherBox.max.z);

                if (overlapX && overlapZ) {
                    // Overlap detected!
                    // This part must be stacked on top of otherMesh.

                    // We stack on top of the physical bounds of the other mesh.
                    // Standard stacking behavior: sit on top.
                    // We assume the other mesh is a solid object we are cleaning.

                    // Note: In LEGO logic, we might want to interlock.
                    // To strictly fix the "jumping" bug, we just need to ensure we don't collide with things *not under us*.
                    // But for things *under us*, we must stack.

                    // Since specific stud logic is complex and might depend on geometry we don't fully parse here,
                    // we will stick to AABB stacking on the specific mesh.
                    // This allows "arch" behavior because the gap in the arch won't have a mesh to collide with.

                    // Optimization: Subtract stud height if we want to sink in?
                    // The previous logic was: const stackY = worldPos.y + gridStep;
                    // Let's use the bounding box top.

                    // If we assume standard bricks, we can sink 0.16 (stud height)?
                    // But let's be safe and stack ON TOP first. If it looks floating, we tune it.
                    // Actually, the previous code had `snapStudsToBrick` separately?
                    // No, `findValidPlacementPosition` returns the final Y.

                    // Let's check `studHeight` property.
                    const studH = this.studHeight || 0.16;

                    // Stack Y for the part's bottom
                    const validPartBottomY = otherBox.max.y - studH;

                    // GroupY >= validPartBottomY - partBottomOffset
                    const stackingConstraintY = validPartBottomY - partBottomOffset;

                    if (stackingConstraintY > requiredGroupY) {
                        requiredGroupY = stackingConstraintY;
                        constrained = true;
                    }
                }
            }
        }

        const result = brick.position.clone();

        // "Breakable Snap" Logic:
        // 1. If we are clearly ABOVE the required height (or at it), we use the Max (standard stacking).
        // 2. If we are BELOW the required height (Intersection), we check if we should "Snap Up" or "Allow Intersection".

        // Define a tiny distance where we FORCE snap (Magnetism).
        // This ensures if you are practically on top, you snap perfectly.
        const magneticDist = 0.05;

        // If 'requiredGroupY' is 0 (Ground/No Collision), we always allow going down to 0.
        // If 'requiredGroupY' > 0, it means we hit an object.

        if (brick.position.y >= requiredGroupY - magneticDist) {
            // We are above or very close to surface -> Hard Snap/Stack.
            result.y = Math.max(brick.position.y, requiredGroupY);
        } else {
            // We are colliding (intersecting) but "Pushing Through".
            // We allow the intersection visually! 
            // This prevents the "Trap" where 'Math.max' forces us back up, preventing us from ever reaching the "Ignore" threshold.
            // Result: The brick will look like it's clipping into the object.
            // If the user keeps dragging down, eventually they will cross the 'stackTolerance' (in the loop above),
            // causing the Object to be IGNORED, 'requiredGroupY' will drop to 0, and the brick will fall free.
            result.y = brick.position.y;
        }

        return result;
    }
    // Find a non-overlapping position at the same Y level
    findNonOverlappingPosition(brick, targetY) {
        const originalPos = brick.position.clone();
        const brickBox = new THREE.Box3();
        brick.updateMatrixWorld();
        brickBox.setFromObject(brick);

        // Calculate brick dimensions
        const brickSize = new THREE.Vector3();
        brickBox.getSize(brickSize);

        // Generate candidate positions in a spiral pattern around the original position
        const candidates = [];
        const maxSearchRadius = 5; // studs

        // Try positions in expanding spiral pattern
        for (let radius = 1; radius <= maxSearchRadius; radius++) {
            for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 4) {
                const xOffset = Math.round(Math.cos(angle) * radius);
                const zOffset = Math.round(Math.sin(angle) * radius);

                // Skip (0,0) as that's the original position
                if (xOffset === 0 && zOffset === 0) continue;

                const candidateX = originalPos.x + xOffset * this.studSpacing;
                const candidateZ = originalPos.z + zOffset * this.studSpacing;

                candidates.push({ x: candidateX, z: candidateZ });
            }
        }

        // Also try immediate neighbors (more thoroughly)
        const immediateNeighbors = [
            { x: originalPos.x + this.studSpacing, z: originalPos.z },
            { x: originalPos.x - this.studSpacing, z: originalPos.z },
            { x: originalPos.x, z: originalPos.z + this.studSpacing },
            { x: originalPos.x, z: originalPos.z - this.studSpacing },
            { x: originalPos.x + this.studSpacing, z: originalPos.z + this.studSpacing },
            { x: originalPos.x + this.studSpacing, z: originalPos.z - this.studSpacing },
            { x: originalPos.x - this.studSpacing, z: originalPos.z + this.studSpacing },
            { x: originalPos.x - this.studSpacing, z: originalPos.z - this.studSpacing }
        ];

        // Add immediate neighbors to the beginning of candidates to try them first
        candidates.unshift(...immediateNeighbors);

        // Test each candidate position
        for (const candidate of candidates) {
            // Temporarily move brick to candidate position
            brick.position.set(candidate.x, targetY, candidate.z);
            brick.updateMatrixWorld();

            // Create box at candidate position
            const candidateBox = new THREE.Box3();
            candidateBox.setFromObject(brick);

            let hasOverlap = false;

            // Check against all placed bricks
            for (const placedBrick of this.placedBricks) {
                if (placedBrick === brick) continue;

                const placedBox = new THREE.Box3();
                placedBrick.updateMatrixWorld();
                placedBox.setFromObject(placedBrick);

                if (this.checkBoxOverlap(candidateBox, placedBox)) {
                    hasOverlap = true;
                    break;
                }
            }

            // If no overlap found, this is a valid position
            if (!hasOverlap) {
                // Snap to stud grid
                const snapped = this.snapToStudGrid(candidate.x, candidate.z, brick);

                // Calculate proper Y position (keep bottom at targetY level)
                const box = new THREE.Box3().setFromObject(brick);
                const bottomOffset = targetY - box.min.y;

                return new THREE.Vector3(snapped.x, bottomOffset, snapped.z);
            }
        }

        // If no valid position found, return null to use fallback
        return null;
    }

    // Generate neighbor positions for sliding logic
    generateNeighborPositions(x, z, brick) {
        const neighbors = [
            { x: x + this.studSpacing, z: z },
            { x: x - this.studSpacing, z: z },
            { x: x, z: z + this.studSpacing },
            { x: x, z: z - this.studSpacing },
            { x: x + this.studSpacing, z: z + this.studSpacing },
            { x: x + this.studSpacing, z: z - this.studSpacing },
            { x: x - this.studSpacing, z: z + this.studSpacing },
            { x: x - this.studSpacing, z: z - this.studSpacing }
        ];

        // Add more distant neighbors for better coverage
        for (let i = 2; i <= 3; i++) {
            neighbors.push(
                { x: x + i * this.studSpacing, z: z },
                { x: x - i * this.studSpacing, z: z },
                { x: x, z: z + i * this.studSpacing },
                { x: x, z: z - i * this.studSpacing }
            );
        }

        return neighbors;
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

    // Create 4 circular arrows for rotation gizmo (each covering 90 degrees)
    createDoubleCircularArrows(radius, color) {
        const group = new THREE.Group();

        const arrowRadius = radius;
        const tubeRadius = 0.12;
        const arrowHeadLength = 0.5;
        const arrowHeadRadius = 0.25;
        const segmentsPerArrow = 16;

        // Create 4 segments, each covering 90 degrees with bidirectional arrows
        const angleStep = Math.PI / 2; // 90 degrees
        const halfAngleStep = angleStep / 2; // 45 degrees

        for (let i = 0; i < 4; i++) {
            const segmentStart = i * angleStep;
            const segmentMid = segmentStart + halfAngleStep;
            const segmentEnd = (i + 1) * angleStep;

            // First half: forward arrow (start to mid)
            const forwardArrow = this.createSingleCircularArrow(
                arrowRadius,
                tubeRadius,
                color,
                segmentStart,
                segmentMid,
                arrowHeadLength,
                arrowHeadRadius,
                segmentsPerArrow,
                true // forward direction
            );
            group.add(forwardArrow);

            // Second half: backward arrow (mid to end)
            const backwardArrow = this.createSingleCircularArrow(
                arrowRadius,
                tubeRadius,
                color,
                segmentMid,
                segmentEnd,
                arrowHeadLength,
                arrowHeadRadius,
                segmentsPerArrow,
                false // reverse direction
            );
            group.add(backwardArrow);
        }

        return group;
    }

    // Create a single curved arrow segment
    createSingleCircularArrow(radius, tubeRadius, color, startAngle, endAngle, arrowHeadLength, arrowHeadRadius, segments, forwardDirection = true) {
        const group = new THREE.Group();

        // Reduce tube angle to leave space for arrow heads (no overlap)
        const arrowHeadAngleSpace = 0.08; // Smaller angle space reserved for arrow head
        let tubeStartAngle = startAngle;
        let tubeEndAngle = endAngle;

        if (forwardDirection) {
            // Arrow head at the end, so shorten tube at the end
            tubeEndAngle = endAngle - arrowHeadAngleSpace;
        } else {
            // Arrow head at the start, so shorten tube at the start
            tubeStartAngle = startAngle + arrowHeadAngleSpace;
        }

        // Create the curved tube (torus segment) in XY plane (like the original torus)
        const points = [];
        for (let i = 0; i <= segments; i++) {
            const angle = tubeStartAngle + (tubeEndAngle - tubeStartAngle) * (i / segments);
            const x = Math.cos(angle) * radius;
            const y = Math.sin(angle) * radius;
            points.push(new THREE.Vector3(x, y, 0));
        }

        const curve = new THREE.CatmullRomCurve3(points);
        const tubeGeometry = new THREE.TubeGeometry(curve, segments, tubeRadius, 8, false);
        const tubeMaterial = new THREE.MeshBasicMaterial({ color: color });
        const tube = new THREE.Mesh(tubeGeometry, tubeMaterial);
        group.add(tube);

        // Create arrow head at the appropriate end
        let headAngle;
        if (forwardDirection) {
            // Arrow head at the end
            headAngle = endAngle - 0.1;
        } else {
            // Arrow head at the start
            headAngle = startAngle + 0.1;
        }

        const headX = Math.cos(headAngle) * radius;
        const headY = Math.sin(headAngle) * radius;

        // Direction vector for arrow head orientation
        let direction;
        if (forwardDirection) {
            const nextAngle = headAngle + 0.1;
            const nextX = Math.cos(nextAngle) * radius;
            const nextY = Math.sin(nextAngle) * radius;
            direction = new THREE.Vector3(nextX - headX, nextY - headY, 0).normalize();
        } else {
            const prevAngle = headAngle - 0.1;
            const prevX = Math.cos(prevAngle) * radius;
            const prevY = Math.sin(prevAngle) * radius;
            direction = new THREE.Vector3(prevX - headX, prevY - headY, 0).normalize();
        }

        // Create cone for arrow head
        const coneGeometry = new THREE.ConeGeometry(arrowHeadRadius, arrowHeadLength, 16);
        const coneMaterial = new THREE.MeshBasicMaterial({ color: color });
        const cone = new THREE.Mesh(coneGeometry, coneMaterial);

        // Position the cone at the end of the arrow
        cone.position.set(headX, headY, 0);

        // Rotate cone to point in the direction of motion
        const quaternion = new THREE.Quaternion();
        quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);
        cone.quaternion.multiplyQuaternions(quaternion, cone.quaternion);

        group.add(cone);

        return group;
    }

    createGizmo() {
        // Create a group to hold all gizmo elements
        this.gizmo = new THREE.Group();
        this.gizmo.name = 'TransformGizmo';
        this.gizmo.visible = false;

        // Track hovered axis for glow effect
        this.hoveredGizmoAxis = null;

        // Store labels for scaling
        this.gizmoLabels = {};

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

        // Helper function to create text sprite
        const createTextSprite = (text, color) => {
            const canvas = document.createElement('canvas');
            const context = canvas.getContext('2d');
            canvas.width = 64;
            canvas.height = 64;
            context.font = 'Bold 48px Arial';
            context.fillStyle = color;
            context.textAlign = 'center';
            context.textBaseline = 'middle';
            context.fillText(text, 32, 32);
            const texture = new THREE.CanvasTexture(canvas);
            const spriteMaterial = new THREE.SpriteMaterial({ map: texture, transparent: true });
            const sprite = new THREE.Sprite(spriteMaterial);
            sprite.scale.set(0.8, 0.8, 1);
            return sprite;
        };

        // X axis - Red
        const xArrow = createArrow(new THREE.Vector3(1, 0, 0), 0xff0000, 'gizmo-x', 'x');
        this.gizmoArrows.x = xArrow;
        this.gizmo.add(xArrow);

        // X label
        const xLabel = createTextSprite('X', '#ff0000');
        xLabel.position.set(4.5, 0, 0);
        xLabel.userData.basePosition = new THREE.Vector3(4.5, 0, 0);
        xLabel.userData.axis = 'x';
        this.gizmo.add(xLabel);
        this.gizmoLabels.x = xLabel;

        // Y axis - Green
        const yArrow = createArrow(new THREE.Vector3(0, 1, 0), 0x00ff00, 'gizmo-y', 'y');
        this.gizmoArrows.y = yArrow;
        this.gizmo.add(yArrow);

        // Y label
        const yLabel = createTextSprite('Y', '#00ff00');
        yLabel.position.set(0, 4.5, 0);
        yLabel.userData.basePosition = new THREE.Vector3(0, 4.5, 0);
        yLabel.userData.axis = 'y';
        this.gizmo.add(yLabel);
        this.gizmoLabels.y = yLabel;

        // Z axis - Blue
        const zArrow = createArrow(new THREE.Vector3(0, 0, 1), 0x0000ff, 'gizmo-z', 'z');
        this.gizmoArrows.z = zArrow;
        this.gizmo.add(zArrow);

        // Z label
        const zLabel = createTextSprite('Z', '#0000ff');
        zLabel.position.set(0, 0, 4.5);
        zLabel.userData.basePosition = new THREE.Vector3(0, 0, 4.5);
        zLabel.userData.axis = 'z';
        this.gizmo.add(zLabel);
        this.gizmoLabels.z = zLabel;

        // Center handle - White sphere (larger)
        const centerGeometry = new THREE.SphereGeometry(0.4, 16, 16);
        const centerMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });
        this.gizmoCenterHandle = new THREE.Mesh(centerGeometry, centerMaterial);
        this.gizmoCenterHandle.name = 'gizmo-center';
        this.gizmoCenterHandle.userData.axis = 'center';
        this.gizmoCenterHandle.userData.originalColor = 0xffffff;
        this.gizmo.add(this.gizmoCenterHandle);

        // Rotation ring - Create 2 circular arrows around Y axis, parallel to canvas (XZ plane)
        this.gizmoRotationRing = this.createDoubleCircularArrows(3.0, 0xffa500);
        this.gizmoRotationRing.name = 'gizmo-rotate';
        this.gizmoRotationRing.userData.axis = 'rotate';
        this.gizmoRotationRing.userData.originalColor = 0xffa500;
        // Rotate to make it parallel to canvas (XZ plane)
        this.gizmoRotationRing.rotation.x = Math.PI / 2;
        this.gizmo.add(this.gizmoRotationRing);

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
            } else if (axis === 'rotate') {
                if (this.gizmoRotationRing && this.gizmoRotationRing.children) {
                    this.gizmoRotationRing.traverse((child) => {
                        if (child.isMesh && child.material) {
                            child.material.color.setHex(glowColor);
                        }
                    });
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
                // Don't reset scale - let it maintain dynamic scale
            }

            // Reset rotation ring
            if (this.gizmoRotationRing) {
                this.gizmoRotationRing.traverse((child) => {
                    if (child.isMesh && child.material) {
                        child.material.color.setHex(0xffa500);
                    }
                });
                // Don't reset scale - let it maintain dynamic scale
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
                    // Don't reset scale - let it maintain dynamic scale
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
            let depth = 0;
            while (obj && !obj.userData.axis && depth < 5) {
                obj = obj.parent;
                depth++;
            }
            if (obj && obj.userData.axis) {
                const axis = obj.userData.axis;
                console.log('Gizmo intersection detected - Axis:', axis, 'Object name:', obj.name);
                return axis;
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

        // Get the selected color (default to white if not set)
        const selectedColor = window.selectedColor || 'White';

        // Create new ghost for placement with selected color
        const brick = this.brickManager.getBrickWithColor(name, selectedColor);
        console.log('Got brick from manager:', brick);
        if (brick) {
            // Clone the brick to avoid modifying the original
            this.ghostBrick = brick.clone();
            this.ghostBrick.name = name; // Preserve base name
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

    // Method to update ghost brick color when color selection changes
    updateGhostColor() {
        if (this.ghostBrick && this.selectedBrickName) {
            // Get the current selected color
            const selectedColor = window.selectedColor || 'White';

            // Remember current visibility and position/rotation
            const wasVisible = this.ghostBrick.visible;
            const currentPosition = this.ghostBrick.position.clone();
            const currentRotation = this.ghostBrick.rotation.clone();

            // Remove current ghost
            this.removeGhost();

            // Create new ghost with updated color
            const brick = this.brickManager.getBrickWithColor(this.selectedBrickName, selectedColor);
            if (brick) {
                this.ghostBrick = brick.clone();
                this.ghostBrick.name = this.selectedBrickName;

                // Make it semi-transparent
                this.ghostBrick.traverse((child) => {
                    if (child.isMesh) {
                        child.material = child.material.clone();
                        child.material.transparent = true;
                        child.material.opacity = 0.5;
                        child.material.depthWrite = false;
                    }
                });

                // Restore position and rotation
                this.ghostBrick.position.copy(currentPosition);
                this.ghostBrick.rotation.copy(currentRotation);

                // Restore visibility state
                this.ghostBrick.visible = wasVisible;
                this.scene.add(this.ghostBrick);
            }
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