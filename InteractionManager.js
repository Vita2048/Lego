import * as THREE from 'three';

export class InteractionManager {
    constructor(scene, camera, canvas, brickManager) {
        this.scene = scene;
        this.camera = camera;
        this.canvas = canvas;
        this.brickManager = brickManager;

        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();
        this.selectedBrickName = null;
        this.ghostBrick = null;
        this.placedBricks = []; // Array of meshes placed in the scene

        this.mode = 'select'; // 'select' | 'place' | 'drag'
        this.selectedObject = null;
        this.selectionBoxHelper = null;

        // Grid settings
        this.gridSize = 1;

        // Lego brick dimensions - stud height for proper stacking
        this.studHeight = 0.17; // Height of the stud that should interlock

        // Drag state
        this.isDragging = false;
        this.dragOffset = new THREE.Vector3();
        this.dragStartPosition = new THREE.Vector3();
        this.draggedObject = null;
        this.dragGhost = null;

        this.initEvents();
    }

    initEvents() {
        this.canvas.addEventListener('mousemove', (e) => this.onMouseMove(e));
        this.canvas.addEventListener('click', (e) => this.onClick(e));
        this.canvas.addEventListener('mousedown', (e) => this.onMouseDown(e));
        this.canvas.addEventListener('mouseup', (e) => this.onMouseUp(e));
        window.addEventListener('keydown', (e) => this.onKeyDown(e));
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
                // Grid snap for x and z
                const x = Math.round(groundPoint.x / this.gridSize) * this.gridSize;
                const z = Math.round(groundPoint.z / this.gridSize) * this.gridSize;

                // Step 2: Cast a downward ray from high above to find the surface height at this XZ
                const highPoint = new THREE.Vector3(x, 100, z); // Start from high above
                const downRay = new THREE.Raycaster(highPoint, new THREE.Vector3(0, -1, 0));

                // Get all objects except ghost and helpers
                const surfaceObjects = this.scene.children.filter(obj =>
                    obj !== this.ghostBrick &&
                    obj.visible &&
                    obj !== this.selectionBoxHelper &&
                    obj !== this.dragGhost
                );

                const hits = downRay.intersectObjects(surfaceObjects, true);
                let y = 0; // Default to ground

                if (hits.length > 0) {
                    const hit = hits[0];

                    if (hit.object.name === 'Ground') {
                        y = 0;
                    } else {
                        // Hit a brick - find its bounding box and place on top
                        let targetBrick = hit.object;
                        while (targetBrick.parent && !this.placedBricks.includes(targetBrick)) {
                            targetBrick = targetBrick.parent;
                        }

                        if (this.placedBricks.includes(targetBrick)) {
                            const targetBbox = new THREE.Box3().setFromObject(targetBrick);
                            // Subtract stud height so studs interlock with brick above
                            y = targetBbox.max.y - this.studHeight;
                        } else {
                            // Fallback: use hit point
                            y = hit.point.y;
                        }
                    }
                }

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
                // Grid snap for x and z
                const x = Math.round(groundPoint.x / this.gridSize) * this.gridSize;
                const z = Math.round(groundPoint.z / this.gridSize) * this.gridSize;

                // Step 2: Cast a downward ray from high above to find the surface height at this XZ
                const highPoint = new THREE.Vector3(x, 100, z);
                const downRay = new THREE.Raycaster(highPoint, new THREE.Vector3(0, -1, 0));

                // Get all objects except ghosts and the brick being dragged
                const surfaceObjects = this.scene.children.filter(obj =>
                    obj !== this.dragGhost &&
                    obj.visible &&
                    obj !== this.selectionBoxHelper &&
                    obj !== this.ghostBrick &&
                    obj !== this.draggedObject
                );

                const hits = downRay.intersectObjects(surfaceObjects, true);
                let y = 0; // Default to ground

                if (hits.length > 0) {
                    const hit = hits[0];

                    if (hit.object.name === 'Ground') {
                        y = 0;
                    } else {
                        // Hit a brick - find its bounding box and place on top
                        let targetBrick = hit.object;
                        while (targetBrick.parent && !this.placedBricks.includes(targetBrick)) {
                            targetBrick = targetBrick.parent;
                        }

                        if (this.placedBricks.includes(targetBrick)) {
                            const targetBbox = new THREE.Box3().setFromObject(targetBrick);
                            // Subtract stud height so studs interlock with brick above
                            y = targetBbox.max.y - this.studHeight;
                        } else {
                            y = hit.point.y;
                        }
                    }
                }

                this.dragGhost.position.set(x, y, z);
            }
        } else if (this.mode === 'select') {
            // Select mode - check for hover over selectable objects
            this.canvas.style.cursor = 'default';

            if (this.selectedObject) {
                // Check if hovering over selected object
                const intersects = this.raycaster.intersectObjects([this.selectedObject], true);
                if (intersects.length > 0) {
                    this.canvas.style.cursor = 'grab';
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
            if (!this.ghostBrick || !this.ghostBrick.visible) return;

            // Clone the ghost to create a real brick
            const newBrick = this.brickManager.getBrick(this.selectedBrickName);
            newBrick.position.copy(this.ghostBrick.position);
            newBrick.rotation.copy(this.ghostBrick.rotation);

            this.scene.add(newBrick);
            this.placedBricks.push(newBrick);
        } else if (this.mode === 'drag') {
            // End drag mode - place the brick at the ghost's position (already calculated correctly)
            if (this.dragGhost && this.draggedObject) {
                this.draggedObject.position.copy(this.dragGhost.position);
                this.preventOverlaps(this.draggedObject);
            }

            // Clean up drag mode
            this.endDragMode();
        } else if (this.mode === 'select') {
            this.raycaster.setFromCamera(this.mouse, this.camera);
            const intersects = this.raycaster.intersectObjects(this.placedBricks, true);

            if (intersects.length > 0) {
                const hitBrick = this.placedBricks.find(b => b === intersects[0].object);
                if (hitBrick) {
                    this.startDragMode(hitBrick);
                }
            } else {
                this.deselectObject();
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
        if (this.mode === 'select') {
            this.raycaster.setFromCamera(this.mouse, this.camera);
            const intersects = this.raycaster.intersectObjects(this.placedBricks, true);

            if (intersects.length > 0) {
                const hitBrick = this.placedBricks.find(b => b === intersects[0].object);
                if (hitBrick) {
                    this.startDragMode(hitBrick);
                }
            }
        }
    }

    onMouseUp(event) {
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

    checkCollision(brick, newPosition) {
        // Create a temporary box for the brick at the new position
        const brickBox = new THREE.Box3().setFromObject(brick);
        const tempBox = brickBox.clone();

        // Move the temp box to the new position
        const offset = new THREE.Vector3().subVectors(tempBox.min, brick.position);
        tempBox.min.copy(newPosition).add(offset);
        tempBox.max.copy(newPosition).add(offset).add(new THREE.Vector3().subVectors(brickBox.max, brickBox.min));

        // Check collision with all other placed bricks (except the one being moved)
        for (const otherBrick of this.placedBricks) {
            if (otherBrick === brick) continue; // Skip self

            const otherBox = new THREE.Box3().setFromObject(otherBrick);

            // Check if boxes intersect
            if (tempBox.intersectsBox(otherBox)) {
                return true; // Collision detected
            }
        }

        return false; // No collision
    }
}
