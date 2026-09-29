(function () {
    const canvas = document.getElementById('rope_canvas');

    let handles_x = [100];
    let handles_y = [50];
    const HANDLE_RADIUS = 10;
    const ROPE_LENGTH = 200;
    const NUM_ROPE_POINTS = 100;
    const ROPE_POINT_DISTANCE = ROPE_LENGTH / NUM_ROPE_POINTS;
    const SUBSTEPS = 8; // split each frame into several smaller physics steps, so gravity never
    // outruns the constraint solver (fixes long-term length "creep")
    const ITERATIONS_PER_SUBSTEP = 50; // 8*50 = 400, same total solver work as before substepping
    const STRENGTH_VARIANCE = 0.4; // +/-40% random per-segment strength, so segments aren't perfectly uniform

    let rope_positions_y = [...Array(NUM_ROPE_POINTS).keys()].map(
        (i) => handles_y[0] + i * ROPE_POINT_DISTANCE
    ); // The current y position of each rope element
    let rope_positions_x = [...Array(NUM_ROPE_POINTS).keys()].map((_) => handles_x[0]); // The current x position of each rope element
    let last_rope_positions_y = [...rope_positions_y]; // The last y position of each rope element
    let last_rope_positions_x = [...rope_positions_x]; // The last x position of each rope element
    let handle_map = [0, NUM_ROPE_POINTS - 1]; // Maps handle ids to rope_pointes
    let broken = new Array(NUM_ROPE_POINTS - 1).fill(false); // broken[i]: true once the segment between point i and i+1 has torn
    let segment_strength = new Array(NUM_ROPE_POINTS - 1); // per-segment random tear-resistance multiplier

    function randomize_segment_strength() {
        for (let i = 0; i < segment_strength.length; i++)
            segment_strength[i] = 1 + (Math.random() - 0.5) * STRENGTH_VARIANCE;
    }
    randomize_segment_strength();

    const drag = setup_dragging(
        canvas,
        handles_x,
        handles_y,
        HANDLE_RADIUS,
        rope_positions_x,
        rope_positions_y,
        HANDLE_RADIUS
    );

    // Is this point currently held fixed, either by a named handle or a live drag?
    function is_fixed_index(i) {
        for (let h = 0; h < handles_x.length; h++) {
            if (handle_map[h] === i) return true;
        }
        return drag.is_point_pinned(i);
    }

    const button = document.getElementById('toogle_handle');
    function update_buttom_label() {
        if (handles_x.length < 2) {
            button.textContent = 'Add second handle';
        } else {
            button.textContent = 'Remove second handle';
        }
    }
    update_buttom_label();
    button?.addEventListener('click', () => {
        if (handles_x.length < 2) {
            // Spawn the new handle exactly where the rope's free end already is, so pinning
            // it doesn't teleport that point and instantly overstretch its last segment.
            handles_x.push(rope_positions_x[NUM_ROPE_POINTS - 1]);
            handles_y.push(rope_positions_y[NUM_ROPE_POINTS - 1]);
        } else {
            handles_x.pop();
            handles_y.pop();
        }
        update_buttom_label();
    });

    // Restores the rope to its initial, undamaged, single-handle state.
    function reset() {
        handles_x.length = 0;
        handles_x.push(100);
        handles_y.length = 0;
        handles_y.push(50);
        for (let i = 0; i < NUM_ROPE_POINTS; i++) {
            rope_positions_x[i] = handles_x[0];
            rope_positions_y[i] = handles_y[0] + i * ROPE_POINT_DISTANCE;
            last_rope_positions_x[i] = rope_positions_x[i];
            last_rope_positions_y[i] = rope_positions_y[i];
        }
        broken.fill(false);
        randomize_segment_strength();
        update_buttom_label();
    }
    document.getElementById('reset_button')?.addEventListener('click', reset);

    function animate(dt) {
        const sub_dt = dt / SUBSTEPS;

        // Capture where each externally-driven point currently is, so it can be eased
        // toward its live target a little each substep instead of snapping there in one
        // go. This filters out raw mouse/trackpad noise, and lets the solver absorb a
        // moving anchor's motion gradually instead of all at once in the first substep.
        const handle_start_x = handles_x.map((_, i) => rope_positions_x[handle_map[i]]);
        const handle_start_y = handles_y.map((_, i) => rope_positions_y[handle_map[i]]);
        const point_target = drag.get_point_target();
        const point_start_x = point_target ? rope_positions_x[point_target.idx] : 0;
        const point_start_y = point_target ? rope_positions_y[point_target.idx] : 0;
        // PHYSICS.friction is a per-frame retention factor, but Step 1 below now runs once per
        // substep - so take the SUBSTEPS-th root here, otherwise the damping compounds to
        // (1-friction)^SUBSTEPS per frame instead of the intended (1-friction).
        const substep_friction_retention = Math.pow(1 - PHYSICS.friction, 1 / SUBSTEPS);
        // Internal friction is applied inside Step 2's iteration loop below (not once per
        // substep) - it has to influence the solver's own relaxation to actually suppress
        // whip-wave propagation; applied only afterward, it's too late to matter.
        const internal_damp_per_iteration = PHYSICS.internalFriction / ITERATIONS_PER_SUBSTEP;

        for (let step = 0; step < SUBSTEPS; step++) {
            const t = (step + 1) / SUBSTEPS;

            // Update the rope-position with the handle, also force the last position, since we don't want the rope to accelerate.
            for (let i = 0; i < handles_x.length; ++i) {
                rope_positions_x[handle_map[i]] =
                    handle_start_x[i] + (handles_x[i] - handle_start_x[i]) * t;
                rope_positions_y[handle_map[i]] =
                    handle_start_y[i] + (handles_y[i] - handle_start_y[i]) * t;
                last_rope_positions_x[handle_map[i]] = rope_positions_x[handle_map[i]];
                last_rope_positions_y[handle_map[i]] = rope_positions_y[handle_map[i]];
            }
            // Do the same for a point currently being live-dragged, so it doesn't pick up gravity while held.
            if (point_target) {
                rope_positions_x[point_target.idx] =
                    point_start_x + (point_target.x - point_start_x) * t;
                rope_positions_y[point_target.idx] =
                    point_start_y + (point_target.y - point_start_y) * t;
                last_rope_positions_x[point_target.idx] = rope_positions_x[point_target.idx];
                last_rope_positions_y[point_target.idx] = rope_positions_y[point_target.idx];
            }

            // Update the rope positions
            // Step 1: Apply a verlet integration to each rope point.
            for (let i = 0; i < NUM_ROPE_POINTS; i++) {
                if (is_fixed_index(i))
                    // Skip fixed points (handles or a live drag), they can't move under physics.
                    continue;
                const last_x = rope_positions_x[i];
                rope_positions_x[i] +=
                    substep_friction_retention * (rope_positions_x[i] - last_rope_positions_x[i]);
                last_rope_positions_x[i] = last_x;

                const last_y = rope_positions_y[i];
                rope_positions_y[i] +=
                    substep_friction_retention * (rope_positions_y[i] - last_rope_positions_y[i]) +
                    PHYSICS.gravity * sub_dt * sub_dt;
                last_rope_positions_y[i] = last_y;
            }

            // Step 2: Constrain the rope points to a maximum distance from each other
            for (let count = 0; count < ITERATIONS_PER_SUBSTEP; ++count) {
                const forward = count % 2 === 0; // alternate sweep direction each iteration to cancel Gauss-Seidel directional bias
                for (let k = 0; k < rope_positions_x.length - 1; k++) {
                    const i = forward ? k : rope_positions_x.length - 2 - k;
                    if (broken[i]) continue; // this segment has torn, the two sides are independent now

                    const dx = rope_positions_x[i + 1] - rope_positions_x[i];
                    const dy = rope_positions_y[i + 1] - rope_positions_y[i];
                    const distance = Math.max(Math.sqrt(dx ** 2 + dy ** 2), 0.0001);

                    if (distance > PHYSICS.tearFactor * segment_strength[i] * ROPE_POINT_DISTANCE) {
                        broken[i] = true;
                        continue;
                    }

                    const d = 1 - ROPE_POINT_DISTANCE / distance;
                    const offsetX = dx * d;
                    const offsetY = dy * d;

                    const leftFixed = is_fixed_index(i);
                    const rightFixed = is_fixed_index(i + 1);
                    if (leftFixed && rightFixed) {
                        // both ends held fixed, nothing to adjust
                    } else if (leftFixed) {
                        rope_positions_x[i + 1] -= offsetX;
                        rope_positions_y[i + 1] -= offsetY;
                    } else if (rightFixed) {
                        rope_positions_x[i] += offsetX;
                        rope_positions_y[i] += offsetY;
                    } else {
                        rope_positions_x[i] += offsetX / 2;
                        rope_positions_y[i] += offsetY / 2;
                        rope_positions_x[i + 1] -= offsetX / 2;
                        rope_positions_y[i + 1] -= offsetY / 2;
                    }

                    // Internal friction: damp the RELATIVE velocity between this pair, right here
                    // inside the solver's own relaxation. This specifically kills whip-like waves
                    // traveling along the rope (adjacent points moving very differently from each
                    // other) without resisting the rope's overall bulk motion through space, where
                    // neighbors move together and relative velocity is already near zero - that's
                    // what air friction is for, and why cranking air friction up to fix whip-
                    // snapping made the whole rope feel sluggish instead. Applying this only once
                    // per substep (after the solver, not inside it) turned out too late to matter -
                    // the tear-check above already sees the un-damped transient distances.
                    if (internal_damp_per_iteration > 0) {
                        const rel_vx =
                            rope_positions_x[i + 1] -
                            last_rope_positions_x[i + 1] -
                            (rope_positions_x[i] - last_rope_positions_x[i]);
                        const rel_vy =
                            rope_positions_y[i + 1] -
                            last_rope_positions_y[i + 1] -
                            (rope_positions_y[i] - last_rope_positions_y[i]);

                        if (leftFixed) {
                            last_rope_positions_x[i + 1] += internal_damp_per_iteration * rel_vx;
                            last_rope_positions_y[i + 1] += internal_damp_per_iteration * rel_vy;
                        } else if (rightFixed) {
                            last_rope_positions_x[i] -= internal_damp_per_iteration * rel_vx;
                            last_rope_positions_y[i] -= internal_damp_per_iteration * rel_vy;
                        } else {
                            last_rope_positions_x[i] -= internal_damp_per_iteration * 0.5 * rel_vx;
                            last_rope_positions_y[i] -= internal_damp_per_iteration * 0.5 * rel_vy;
                            last_rope_positions_x[i + 1] +=
                                internal_damp_per_iteration * 0.5 * rel_vx;
                            last_rope_positions_y[i + 1] +=
                                internal_damp_per_iteration * 0.5 * rel_vy;
                        }
                    }
                }
                constrain_to_bounds(
                    rope_positions_x,
                    rope_positions_y,
                    canvas.width,
                    canvas.height
                );
            }
        }

        apply_contact_friction(
            rope_positions_x,
            rope_positions_y,
            last_rope_positions_x,
            last_rope_positions_y,
            canvas.width,
            canvas.height,
            PHYSICS.groundFriction
        );
    }
    function draw(ctx, canvas) {
        // Clear the background
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = 'darkblue';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Draw the handles
        for (let i = 0; i < handles_x.length; i++) {
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
            if (broken[i - 1])
                ctx.moveTo(rope_positions_x[i], rope_positions_y[i]); // segment torn, start a new subpath
            else ctx.lineTo(rope_positions_x[i], rope_positions_y[i]);
        }
        ctx.stroke();
    }

    main_cycle_if_visible(canvas, draw, animate);
})();
