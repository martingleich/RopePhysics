(function()
{
    const canvas = document.getElementById('rope_canvas');

    let handles_x = [100];
    let handles_y = [50];
    const HANDLE_RADIUS = 10;
    const ROPE_LENGTH = 200;
    const NUM_ROPE_POINTS = 100;
    const ROPE_POINT_DISTANCE = ROPE_LENGTH / NUM_ROPE_POINTS;
    const GRAVITY = 2000;
    const FRICTION = 0.005;

    let rope_positions_y = [...Array(NUM_ROPE_POINTS).keys()].map(i => handles_y[0] + i*ROPE_POINT_DISTANCE); // The current y position of each rope element
    let rope_positions_x = [...Array(NUM_ROPE_POINTS).keys()].map(_ => handles_x[0]); // The current x position of each rope element
    let last_rope_positions_y = [...rope_positions_y]; // The last y position of each rope element
    let last_rope_positions_x = [...rope_positions_x]; // The last x position of each rope element
    let handle_map = [0, NUM_ROPE_POINTS-1]; // Maps handle ids to rope_pointes

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
        } else if(event.button === 1) {
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

    function animate(dt) {
        // Update the rope-position with the handle, also force the last position, since we don't want the rope to accelerate.
        for(let i = 0; i < handles_x.length; ++i) {
            rope_positions_x[handle_map[i]] = handles_x[i];
            rope_positions_y[handle_map[i]] = handles_y[i];
            last_rope_positions_x[handle_map[i]] = handles_x[i]
            last_rope_positions_y[handle_map[i]] = handles_y[i];
        }

        // Update the rope positions
        // Step 1: Apply a verlet integration to each rope point.
        for (let i = 1; i <= NUM_ROPE_POINTS - handles_x.length; i++) { // Skip the first point, since it is the handle and cannot move
            const last_x = rope_positions_x[i];
            rope_positions_x[i] += (1-FRICTION)*(rope_positions_x[i] - last_rope_positions_x[i]);
            last_rope_positions_x[i] = last_x;

            const last_y = rope_positions_y[i];
            rope_positions_y[i] += (1-FRICTION)*(rope_positions_y[i] - last_rope_positions_y[i]) + 0.5 * GRAVITY * dt * dt;
            last_rope_positions_y[i] = last_y;
        }

        // Step 2: Constrain the rope points to a maximum distance from each other
        for (let count = 0; count < 4*NUM_ROPE_POINTS; ++count) { // TODO: What number to pick here?
            for (let i = 0; i < rope_positions_x.length - 1; i++) {
                const dx = rope_positions_x[i + 1] - rope_positions_x[i];
                const dy = rope_positions_y[i + 1] - rope_positions_y[i];
                const d = 1 - ROPE_POINT_DISTANCE/Math.sqrt(dx ** 2 + dy ** 2);
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
    function draw(ctx, canvas)
    {
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
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(rope_positions_x[0], rope_positions_y[0]);
        for (let i = 1; i < rope_positions_x.length; i++) {
            ctx.lineTo(rope_positions_x[i], rope_positions_y[i]);
        }
        ctx.stroke();
    }

    main_cycle_if_visible(canvas, draw, animate);
})();