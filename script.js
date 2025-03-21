(function()
{
    const canvas = document.getElementById('rope_canvas');
    const ctx = canvas.getContext('2d');

    let animationFrameId;

    let handle_pos_x = 100;
    let handle_pos_y = 50;
    let handles_x = [100];
    let handles_y = [50];
    const HANDLE_RADIUS = 10;
    const ROPE_LENGTH = 200;
    const NUM_ROPE_POINTS = 100;
    const ROPE_POINT_DISTANCE = ROPE_LENGTH / NUM_ROPE_POINTS;

    let rope_positions_y = [...Array(NUM_ROPE_POINTS).keys()].map(i => handle_pos_y + i*ROPE_POINT_DISTANCE); // The current y position of each rope element
    let rope_positions_x = Array(NUM_ROPE_POINTS).fill(handle_pos_x); // The current x position of each rope element
    let last_rope_positions_y = [...rope_positions_y]; // The last y position of each rope element
    let last_rope_positions_x = [...rope_positions_x]; // The last x position of each rope element

    let isDragging = null; // Is the handle being dragged currently, if so, which one?
    let drag_offset_x = 0; // X Offset between the mouse and the handle's center
    let drag_offset_y = 0; // Y Offset between the mouse and the handle's center

    canvas.addEventListener('mousedown', (event) => {
        const rect = canvas.getBoundingClientRect();
        if(event.button === 0) {
            const mouseX = event.clientX - rect.left;
            const mouseY = event.clientY - rect.top;

            // Check if the click is within the handle's radius
            for(let i = 0; i < handles_x.length; i++) {
                const distance_to_handle = (mouseX - handles_x[i]) ** 2 + (mouseY - handles_y[i]) ** 2;
                if(distance_to_handle <= HANDLE_RADIUS**2) {
                    isDragging = i;
                    drag_offset_x = mouseX - handles_x[i];
                    drag_offset_y = mouseY - handles_y[i];
                    break;
                }
            }
        } else if(event.button === 2) {
            // Right click to add/remove a second handle
            if(handles_x.length < 2) {
                handles_x.push(event.clientX - rect.left);
                handles_y.push(event.clientY - rect.top);
            } else {
                handles_x.pop();
                handles_y.pop();
            }
        }
    });

    canvas.addEventListener('mousemove', (event) => {
        if (isDragging !== null) {
            const rect = canvas.getBoundingClientRect();
            handles_x[isDragging] = event.clientX - rect.left - drag_offset_x;
            handles_y[isDragging] = event.clientY - rect.top - drag_offset_y;
        }
    });

    canvas.addEventListener('mouseup', () => {
        isDragging = null;
    });

    canvas.addEventListener('mouseleave', () => {
        isDragging = null;
    });

    const GRAVITY = 2000;
    let lastTime = NaN

    function animate() {
        var time = performance.now() / 1000;
        var dt = lastTime ? Math.min(time - lastTime, 1/20) : 0;
        lastTime = time;

        // Update the rope-position with the handle, also force the last position, since we don't want the rope to accelerate.
        rope_positions_x[0] = handles_x[0];
        rope_positions_y[0] = handles_y[0];
        last_rope_positions_x[0] = rope_positions_x[0]
        last_rope_positions_y[0] = rope_positions_y[0];
        if(handles_x.length > 1) {
            rope_positions_x[NUM_ROPE_POINTS-1] = handles_x[1];
            rope_positions_y[NUM_ROPE_POINTS-1] = handles_y[1];
            last_rope_positions_x[NUM_ROPE_POINTS-1] = rope_positions_x[NUM_ROPE_POINTS-1];
            last_rope_positions_y[NUM_ROPE_POINTS-1] = rope_positions_y[NUM_ROPE_POINTS-1];
        }

        if(dt > 0) {
            integrate(dt);
        }

        // Clear the background
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = 'darkblue';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Draw the handles
        for(let i = 0; i < handles_x.length; i++) {
            ctx.fillStyle = i === 0 ? 'red' : 'green';
            ctx.beginPath();
            ctx.arc(handles_x[i], handles_y[i], HANDLE_RADIUS, 0, Math.PI * 2);
            ctx.fill();
        }
        // Draw the rope
        ctx.strokeStyle = 'white';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(rope_positions_x[0], rope_positions_y[0]);
        for (let i = 1; i < rope_positions_x.length; i++) {
            ctx.lineTo(rope_positions_x[i], rope_positions_y[i]);
        }
        ctx.stroke();

        animationFrameId = requestAnimationFrame(animate);
    }

    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                // Start animation if canvas is visible
                if (!animationFrameId) {
                    animate();
                }
            } else if (animationFrameId) { // Stop animation if canvas is not visible
                cancelAnimationFrame(animationFrameId);
                animationFrameId = null;
            }
        });
    });

    // Observe the canvas element
    observer.observe(canvas);

    function integrate(dt) {
        // Update the rope positions
        // Step 1: Apply a verlet integration to each rope point.
        const FRICTION = 0.005;
        for (let i = 1; i <= NUM_ROPE_POINTS - handles_x.length; i++) { // Skip the first point, since it is the handle and cannot move
            const last_x = rope_positions_x[i];
            rope_positions_x[i] += (1-FRICTION)*(rope_positions_x[i] - last_rope_positions_x[i]);
            last_rope_positions_x[i] = last_x;

            const last_y = rope_positions_y[i];
            rope_positions_y[i] += (1-FRICTION)*(rope_positions_y[i] - last_rope_positions_y[i]) + 0.5 * GRAVITY * dt * dt;
            last_rope_positions_y[i] = last_y;
        }

        // Step 2: Constrain the rope points to a maximum distance from each other
        for (let count = 0; count < 3*NUM_ROPE_POINTS; ++count) { // TODO: What number to pick here?
            for (let i = 0; i < rope_positions_x.length - 1; i++) {
                const dx = rope_positions_x[i + 1] - rope_positions_x[i];
                const dy = rope_positions_y[i + 1] - rope_positions_y[i];
                const distance = Math.sqrt(dx ** 2 + dy ** 2);
                const d = 1 - ROPE_POINT_DISTANCE/distance;
                const offsetX = dx * d;
                const offsetY = dy * d;

                if(i == 0) {
                    rope_positions_x[i + 1] -= offsetX;
                    rope_positions_y[i + 1] -= offsetY;
                } else if(i == NUM_ROPE_POINTS - handles_x.length) {
                    rope_positions_x[i] += offsetX;
                    rope_positions_y[i] += offsetY;
                } else {
                    rope_positions_x[i] += offsetX/2;
                    rope_positions_y[i] += offsetY/2;
                    rope_positions_x[i + 1] -= offsetX/2;
                    rope_positions_y[i + 1] -= offsetY/2;
                }
            }
        }
    }
})();

(function()
{
    const canvas = document.getElementById('cloth_canvas');
    const ctx = canvas.getContext('2d');

    let animationFrameId;

    let handle_pos_x = 100;
    let handle_pos_y = 50;
    let handle2_pos_x = 300;
    let handle2_pos_y = 50;
    const HANDLE_RADIUS = 10;
    const CLOTH_LENGTH = 200;
    const NUM_CLOTH_POINTS = 30;
    const CLOTH_POINT_DISTANCE = CLOTH_LENGTH / (NUM_CLOTH_POINTS-1);

    function get_position_x(i) {
        return handle_pos_x + i % NUM_CLOTH_POINTS * CLOTH_POINT_DISTANCE;
    }
    function get_position_y(i) {
        return handle_pos_y + Math.floor(i / NUM_CLOTH_POINTS) * CLOTH_POINT_DISTANCE
    }
    function is_fixed(i) {
        return i === 0 || i === NUM_CLOTH_POINTS - 1;
    }

    let cloth_positions_y = [...Array(NUM_CLOTH_POINTS * NUM_CLOTH_POINTS).keys()].map(i => get_position_y(i)); // The current y position of each rope element
    let cloth_positions_x = [...Array(NUM_CLOTH_POINTS * NUM_CLOTH_POINTS).keys()].map(i => get_position_x(i)); // The current x position of each rope element
    let cloth_positions_z = [...Array(NUM_CLOTH_POINTS * NUM_CLOTH_POINTS).keys()].map(i => Math.random()-0.5); // The current z position of each rope element
    let last_cloth_positions_y = [...cloth_positions_y]; // The last y position of each rope element
    let last_cloth_positions_x = [...cloth_positions_x]; // The last x position of each rope element
    let last_cloth_positions_z = [...cloth_positions_z]; // The last x position of each rope element

    let isDragging = null; // Is the handle being dragged currently, if so, which one?
    let drag_offset_x = 0; // X Offset between the mouse and the handle's center
    let drag_offset_y = 0; // Y Offset between the mouse and the handle's center

    canvas.addEventListener('mousedown', (event) => {
        const rect = canvas.getBoundingClientRect();
        if(event.button === 0) {
            const mouseX = event.clientX - rect.left;
            const mouseY = event.clientY - rect.top;

            // Check if the click is within the handle's radius
            const distance_to_handle_1 = (mouseX - handle_pos_x) ** 2 + (mouseY - handle_pos_y) ** 2;
            const distance_to_handle_2 = (mouseX - handle2_pos_x) ** 2 + (mouseY - handle2_pos_y) ** 2;
            if(distance_to_handle_1 <= HANDLE_RADIUS**2) {
                isDragging = 1;
                drag_offset_x = mouseX - handle_pos_x;
                drag_offset_y = mouseY - handle_pos_y;
            } else if(distance_to_handle_2 <= HANDLE_RADIUS**2) {
                isDragging = 2;
                drag_offset_x = mouseX - handle2_pos_x;
                drag_offset_y = mouseY - handle2_pos_y;
            } else {
                isDragging = null;
            }
        }
    });

    canvas.addEventListener('mousemove', (event) => {
        if (isDragging !== null) {
            const rect = canvas.getBoundingClientRect();
            if(isDragging === 1) {
                handle_pos_x = event.clientX - rect.left - drag_offset_x;
                handle_pos_y = event.clientY - rect.top - drag_offset_y;
            } else if(isDragging === 2) {
                handle2_pos_x = event.clientX - rect.left - drag_offset_x;
                handle2_pos_y = event.clientY - rect.top - drag_offset_y;
            }
        }
    });

    canvas.addEventListener('mouseup', () => {
        isDragging = null;
    });

    canvas.addEventListener('mouseleave', () => {
        isDragging = null;
    });

    const GRAVITY = 2000;
    const DT = 1/60;
    let lastTime = NaN

    function animate() {
        var time = performance.now() / 1000;
        var dt = lastTime ? Math.min(time - lastTime, 1/20) : 0;
        lastTime = time;

        // Update the rope-position with the handle, also force the last position, since we don't want the rope to accelerate.
        cloth_positions_x[0] = handle_pos_x
        cloth_positions_y[0] = handle_pos_y;
        last_cloth_positions_x[0] = handle_pos_x
        last_cloth_positions_y[0] = handle_pos_y;
        cloth_positions_x[NUM_CLOTH_POINTS-1] = handle2_pos_x
        cloth_positions_y[NUM_CLOTH_POINTS-1] = handle2_pos_y;
        last_cloth_positions_x[NUM_CLOTH_POINTS-1] = handle2_pos_x
        last_cloth_positions_y[NUM_CLOTH_POINTS-1] = handle2_pos_y;

        if(dt > 0) {
            integrate(dt);
        }

        // Clear the background
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = 'darkblue';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Draw the handle
        ctx.fillStyle = 'red';
        ctx.beginPath();
        ctx.arc(handle_pos_x, handle_pos_y, HANDLE_RADIUS, 0, Math.PI * 2);
        ctx.fill();
        // Draw the second handle
        if (handle2_pos_x !== null && handle2_pos_y !== null) {
            ctx.fillStyle = 'green';
            ctx.beginPath();
            ctx.arc(handle2_pos_x, handle2_pos_y, HANDLE_RADIUS, 0, Math.PI * 2);
            ctx.fill();
        }

        // Draw the cloth
        ctx.strokeStyle = 'white';
        ctx.lineWidth = 2;
        ctx.beginPath();
        for(let r = 0; r < NUM_CLOTH_POINTS; r++) {
            for(let c = 0; c < NUM_CLOTH_POINTS; c++) {
                const index = r * NUM_CLOTH_POINTS + c;
                if(c < NUM_CLOTH_POINTS - 1) {
                    ctx.moveTo(cloth_positions_x[index], cloth_positions_y[index]);
                    ctx.lineTo(cloth_positions_x[index + 1], cloth_positions_y[index + 1]);
                }
                if(r < NUM_CLOTH_POINTS - 1) {
                    ctx.moveTo(cloth_positions_x[index], cloth_positions_y[index]);
                    ctx.lineTo(cloth_positions_x[index + NUM_CLOTH_POINTS], cloth_positions_y[index + NUM_CLOTH_POINTS]);
                }
            }
        }
        ctx.stroke();

        animationFrameId = requestAnimationFrame(animate);
    }

    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                // Start animation if canvas is visible
                if (!animationFrameId) {
                    animate();
                }
            } else {
                // Stop animation if canvas is not visible
                if (animationFrameId) {
                    cancelAnimationFrame(animationFrameId);
                    animationFrameId = null;
                }
            }
        });
    });

    // Observe the canvas element
    observer.observe(canvas);

    function integrate(dt) {
        // Update the rope positions
        // Step 1: Apply a verlet integration to each rope point.
        const FRICTION = 0.005;
        for (let i = 0; i < NUM_CLOTH_POINTS * NUM_CLOTH_POINTS; i++) { // Skip the first point, since it is the handle and cannot move
            if(is_fixed(i))
                continue;
            const last_x = cloth_positions_x[i];
            cloth_positions_x[i] += (1-FRICTION)*(cloth_positions_x[i] - last_cloth_positions_x[i]);
            last_cloth_positions_x[i] = last_x;

            const last_y = cloth_positions_y[i];
            cloth_positions_y[i] += (1-FRICTION)*(cloth_positions_y[i] - last_cloth_positions_y[i]) + 0.5 * GRAVITY * dt * dt;
            last_cloth_positions_y[i] = last_y;

            const last_z = cloth_positions_z[i];
            cloth_positions_z[i] += (1-FRICTION)*(cloth_positions_z[i] - last_cloth_positions_z[i]);
            last_cloth_positions_z[i] = last_z;
        }

        // Step 2: Constrain the rope points to a maximum distance from each other
        for (let count = 0; count < 3*NUM_CLOTH_POINTS; ++count) { // TODO: What number to pick here?
            // Foreach connection between two points
            for(let r = 0; r < NUM_CLOTH_POINTS; r++) {
                for(let c = 0; c < NUM_CLOTH_POINTS; c++) {
                    const index = r * NUM_CLOTH_POINTS + c;
                    if(c < NUM_CLOTH_POINTS - 1) { // Visit to the right
                        const dx = cloth_positions_x[index + 1] - cloth_positions_x[index];
                        const dy = cloth_positions_y[index + 1] - cloth_positions_y[index];
                        const dz = cloth_positions_z[index + 1] - cloth_positions_z[index];
                        const distance = Math.sqrt(dx ** 2 + dy ** 2 + dz**2);
                        const d = distance - CLOTH_POINT_DISTANCE;
                        const offsetX = (dx / distance) * d / 2;
                        const offsetY = (dy / distance) * d / 2;
                        const offsetZ = (dz / distance) * d / 2;

                        if(index == 0) {
                            cloth_positions_x[index + 1] -= 2*offsetX;
                            cloth_positions_y[index + 1] -= 2*offsetY;
                            cloth_positions_z[index + 1] -= 2*offsetZ;
                        } else if(index + 1 === NUM_CLOTH_POINTS - 1) {
                            cloth_positions_x[index] += 2*offsetX;
                            cloth_positions_y[index] += 2*offsetY;
                            cloth_positions_z[index] += 2*offsetZ;
                        } else {
                            cloth_positions_x[index] += offsetX;
                            cloth_positions_y[index] += offsetY;
                            cloth_positions_z[index] += offsetZ;
                            cloth_positions_x[index + 1] -= offsetX;
                            cloth_positions_y[index + 1] -= offsetY;
                            cloth_positions_z[index + 1] -= offsetZ;
                        }
                    }
                    if(r < NUM_CLOTH_POINTS - 1) { // Visit below
                        const dx = cloth_positions_x[index + NUM_CLOTH_POINTS] - cloth_positions_x[index];
                        const dy = cloth_positions_y[index + NUM_CLOTH_POINTS] - cloth_positions_y[index];
                        const dz = cloth_positions_z[index + NUM_CLOTH_POINTS] - cloth_positions_z[index];
                        const distance = Math.sqrt(dx ** 2 + dy ** 2 + dz**2);
                        const d = distance - CLOTH_POINT_DISTANCE;
                        const offsetX = (dx / distance) * d / 2;
                        const offsetY = (dy / distance) * d / 2;
                        const offsetZ = (dz / distance) * d / 2;

                        if(index == 0 || index == NUM_CLOTH_POINTS - 1) {
                            cloth_positions_x[index + NUM_CLOTH_POINTS] -= 2*offsetX;
                            cloth_positions_y[index + NUM_CLOTH_POINTS] -= 2*offsetY;
                            cloth_positions_z[index + NUM_CLOTH_POINTS] -= 2*offsetZ;
                        } else {
                            cloth_positions_x[index] += offsetX;
                            cloth_positions_y[index] += offsetY;
                            cloth_positions_z[index] += offsetZ;
                            cloth_positions_x[index + NUM_CLOTH_POINTS] -= offsetX;
                            cloth_positions_y[index + NUM_CLOTH_POINTS] -= offsetY;
                            cloth_positions_z[index + NUM_CLOTH_POINTS] -= offsetZ;
                        }
                    }
                    // Visit diagonal(top left to buttom right)
                    if(r < NUM_CLOTH_POINTS - 1 && c < NUM_CLOTH_POINTS - 1) {
                        const dx = cloth_positions_x[index + NUM_CLOTH_POINTS + 1] - cloth_positions_x[index];
                        const dy = cloth_positions_y[index + NUM_CLOTH_POINTS + 1] - cloth_positions_y[index];
                        const dz = cloth_positions_z[index + NUM_CLOTH_POINTS + 1] - cloth_positions_z[index];
                        const distance = Math.sqrt(dx ** 2 + dy ** 2 + dz**2);
                        const d = distance - Math.sqrt(2)*CLOTH_POINT_DISTANCE;
                        const offsetX = (dx / distance) * d / 2;
                        const offsetY = (dy / distance) * d / 2;
                        const offsetZ = (dz / distance) * d / 2;

                        if(is_fixed(index)) {
                            cloth_positions_x[index + NUM_CLOTH_POINTS + 1] -= 2*offsetX;
                            cloth_positions_y[index + NUM_CLOTH_POINTS + 1] -= 2*offsetY;
                            cloth_positions_z[index + NUM_CLOTH_POINTS + 1] -= 2*offsetZ;
                        } else {
                            cloth_positions_x[index] += offsetX;
                            cloth_positions_y[index] += offsetY;
                            cloth_positions_z[index] += offsetZ;
                            cloth_positions_x[index + NUM_CLOTH_POINTS + 1] -= offsetX;
                            cloth_positions_y[index + NUM_CLOTH_POINTS + 1] -= offsetY;
                            cloth_positions_z[index + NUM_CLOTH_POINTS + 1] -= offsetZ;
                        }
                    }
                    // Visit diagonal(top right to buttom left)
                    if(r < NUM_CLOTH_POINTS - 1 && c > 0) {
                        const dx = cloth_positions_x[index + NUM_CLOTH_POINTS - 1] - cloth_positions_x[index];
                        const dy = cloth_positions_y[index + NUM_CLOTH_POINTS - 1] - cloth_positions_y[index];
                        const dz = cloth_positions_z[index + NUM_CLOTH_POINTS - 1] - cloth_positions_z[index];
                        const distance = Math.sqrt(dx ** 2 + dy ** 2 + dz**2);
                        const d = distance - Math.sqrt(2)*CLOTH_POINT_DISTANCE;
                        const offsetX = (dx / distance) * d / 2;
                        const offsetY = (dy / distance) * d / 2;
                        const offsetZ = (dz / distance) * d / 2;

                        if(is_fixed(index)) {
                            cloth_positions_x[index + NUM_CLOTH_POINTS - 1] -= 2*offsetX;
                            cloth_positions_y[index + NUM_CLOTH_POINTS - 1] -= 2*offsetY;
                            cloth_positions_z[index + NUM_CLOTH_POINTS - 1] -= 2*offsetZ;
                        } else {
                            cloth_positions_x[index] += offsetX;
                            cloth_positions_y[index] += offsetY;
                            cloth_positions_z[index] += offsetZ;
                            cloth_positions_x[index + NUM_CLOTH_POINTS - 1] -= offsetX;
                            cloth_positions_y[index + NUM_CLOTH_POINTS - 1] -= offsetY;
                            cloth_positions_z[index + NUM_CLOTH_POINTS - 1] -= offsetZ;
                        }
                    }
                }
            }
        }
    }
})();