(function()
{
    const canvas = document.getElementById('rope_canvas');

    let handles_x = [100];
    let handles_y = [50];
    const HANDLE_RADIUS = 10;
    const ROPE_LENGTH = 200;
    const NUM_ROPE_POINTS = 100;
    const ROPE_POINT_DISTANCE = ROPE_LENGTH / NUM_ROPE_POINTS;

    let rope_positions_y = [...Array(NUM_ROPE_POINTS).keys()].map(i => handles_y[0] + i*ROPE_POINT_DISTANCE); // The current y position of each rope element
    let rope_positions_x = [...Array(NUM_ROPE_POINTS).keys()].map(_ => handles_x[0]); // The current x position of each rope element
    let last_rope_positions_y = [...rope_positions_y]; // The last y position of each rope element
    let last_rope_positions_x = [...rope_positions_x]; // The last x position of each rope element
    let handle_map = [0, NUM_ROPE_POINTS-1]; // Maps handle ids to rope_pointes
    let broken = new Array(NUM_ROPE_POINTS - 1).fill(false); // broken[i]: true once the segment between point i and i+1 has torn

    const drag = setup_dragging(canvas, handles_x, handles_y, HANDLE_RADIUS, rope_positions_x, rope_positions_y, HANDLE_RADIUS);

    // Is this point currently held fixed, either by a named handle or a live drag?
    function is_fixed_index(i) {
        for(let h = 0; h < handles_x.length; h++) {
            if(handle_map[h] === i)
                return true;
        }
        return drag.is_point_pinned(i);
    }

    const button = document.getElementById("toogle_handle");
    function update_buttom_label() {
        if(handles_x.length < 2) {
            button.textContent = "Add second handle";
        } else {
            button.textContent = "Remove second handle";
        }
    }
    update_buttom_label();
    button?.addEventListener('click', () => {
        if(handles_x.length < 2) {
            handles_x.push(150);
            handles_y.push(50);
        } else {
            handles_x.pop();
            handles_y.pop();
        }
        update_buttom_label();
    });

    function animate(dt) {
        // Update the rope-position with the handle, also force the last position, since we don't want the rope to accelerate.
        for(let i = 0; i < handles_x.length; ++i) {
            rope_positions_x[handle_map[i]] = handles_x[i];
            rope_positions_y[handle_map[i]] = handles_y[i];
            last_rope_positions_x[handle_map[i]] = handles_x[i]
            last_rope_positions_y[handle_map[i]] = handles_y[i];
        }
        // Do the same for a point currently being live-dragged, so it doesn't pick up gravity while held.
        for(let i = 0; i < NUM_ROPE_POINTS; i++) {
            if(drag.is_point_pinned(i)) {
                last_rope_positions_x[i] = rope_positions_x[i];
                last_rope_positions_y[i] = rope_positions_y[i];
            }
        }

        // Update the rope positions
        // Step 1: Apply a verlet integration to each rope point.
        for (let i = 0; i < NUM_ROPE_POINTS; i++) {
            if(is_fixed_index(i)) // Skip fixed points (handles or a live drag), they can't move under physics.
                continue;
            const last_x = rope_positions_x[i];
            rope_positions_x[i] += (1-PHYSICS.friction)*(rope_positions_x[i] - last_rope_positions_x[i]);
            last_rope_positions_x[i] = last_x;

            const last_y = rope_positions_y[i];
            rope_positions_y[i] += (1-PHYSICS.friction)*(rope_positions_y[i] - last_rope_positions_y[i]) + PHYSICS.gravity * dt * dt;
            last_rope_positions_y[i] = last_y;
        }

        // Step 2: Constrain the rope points to a maximum distance from each other
        for (let count = 0; count < 4*NUM_ROPE_POINTS; ++count) { // TODO: What number to pick here?
            for (let i = 0; i < rope_positions_x.length - 1; i++) {
                if(broken[i])
                    continue; // this segment has torn, the two sides are independent now

                const dx = rope_positions_x[i + 1] - rope_positions_x[i];
                const dy = rope_positions_y[i + 1] - rope_positions_y[i];
                const distance = Math.max(Math.sqrt(dx ** 2 + dy ** 2), 0.0001);

                if(distance > PHYSICS.tearFactor * ROPE_POINT_DISTANCE) {
                    broken[i] = true;
                    continue;
                }

                const d = 1 - ROPE_POINT_DISTANCE/distance;
                const offsetX = dx * d;
                const offsetY = dy * d;

                const leftFixed = is_fixed_index(i);
                const rightFixed = is_fixed_index(i + 1);
                if(leftFixed && rightFixed) {
                    // both ends held fixed, nothing to adjust
                } else if(leftFixed) {
                    rope_positions_x[i + 1] -= offsetX;
                    rope_positions_y[i + 1] -= offsetY;
                } else if(rightFixed) {
                    rope_positions_x[i] += offsetX;
                    rope_positions_y[i] += offsetY;
                } else {
                    rope_positions_x[i] += offsetX/2;
                    rope_positions_y[i] += offsetY/2;
                    rope_positions_x[i + 1] -= offsetX/2;
                    rope_positions_y[i + 1] -= offsetY/2;
                }
            }
            constrain_to_bounds(rope_positions_x, rope_positions_y, canvas.width, canvas.height);
        }

        apply_contact_friction(rope_positions_x, rope_positions_y, last_rope_positions_x, last_rope_positions_y, canvas.width, canvas.height, PHYSICS.groundFriction);
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
            if(broken[i - 1])
                ctx.moveTo(rope_positions_x[i], rope_positions_y[i]); // segment torn, start a new subpath
            else
                ctx.lineTo(rope_positions_x[i], rope_positions_y[i]);
        }
        ctx.stroke();
    }

    main_cycle_if_visible(canvas, draw, animate);
})();