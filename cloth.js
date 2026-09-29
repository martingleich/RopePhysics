(function()
{
    const canvas = document.getElementById('cloth_canvas');

    let handles_x = [100, 300];
    let handles_y = [50, 50];
    const HANDLE_RADIUS = 10;
    const CLOTH_LENGTH = 200;
    const NUM_CLOTH_POINTS = 30;
    const CLOTH_POINT_DISTANCE = CLOTH_LENGTH / (NUM_CLOTH_POINTS-1);

    function get_position_x(i) {
        return handles_x[0] + i % NUM_CLOTH_POINTS * CLOTH_POINT_DISTANCE;
    }
    function get_position_y(i) {
        return handles_y[0] + Math.floor(i / NUM_CLOTH_POINTS) * CLOTH_POINT_DISTANCE
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

    setup_handle_dragging(canvas, handles_x, handles_y, HANDLE_RADIUS);

    const GRAVITY = 1000;
    function draw(ctx, canvas)
    {
        // Clear the background
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = 'darkblue';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Draw the handle
        ctx.fillStyle = 'red';
        ctx.beginPath();
        ctx.arc(handles_x[0], handles_y[0], HANDLE_RADIUS, 0, Math.PI * 2);
        ctx.fill();
        // Draw the second handle
        ctx.fillStyle = 'green';
        ctx.beginPath();
        ctx.arc(handles_x[1], handles_y[1], HANDLE_RADIUS, 0, Math.PI * 2);
        ctx.fill();

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
    }

    function animate(dt) {
        // Update the rope-position with the handle, also force the last position, since we don't want the rope to accelerate.
        cloth_positions_x[0] = handles_x[0]
        cloth_positions_y[0] = handles_y[0];
        last_cloth_positions_x[0] = handles_x[0]
        last_cloth_positions_y[0] = handles_y[0];
        cloth_positions_x[NUM_CLOTH_POINTS-1] = handles_x[1]
        cloth_positions_y[NUM_CLOTH_POINTS-1] = handles_y[1];
        last_cloth_positions_x[NUM_CLOTH_POINTS-1] = handles_x[1]
        last_cloth_positions_y[NUM_CLOTH_POINTS-1] = handles_y[1];

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
            cloth_positions_y[i] += (1-FRICTION)*(cloth_positions_y[i] - last_cloth_positions_y[i]) + GRAVITY * dt * dt;
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
                        const distance = Math.max(Math.sqrt(dx ** 2 + dy ** 2 + dz**2), 0.0001);
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
                        const distance = Math.max(Math.sqrt(dx ** 2 + dy ** 2 + dz**2), 0.0001);
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
                        const distance = Math.max(Math.sqrt(dx ** 2 + dy ** 2 + dz**2), 0.0001);
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
                        const distance = Math.max(Math.sqrt(dx ** 2 + dy ** 2 + dz**2), 0.0001);
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

    main_cycle_if_visible(canvas, draw, animate);
})();