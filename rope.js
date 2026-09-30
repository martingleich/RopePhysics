(function () {
    const canvas = document.getElementById('rope_canvas');

    let handles_x = [100];
    let handles_y = [50];
    const HANDLE_RADIUS = 10;
    const ROPE_LENGTH = 200;
    const NUM_ROPE_POINTS = 100;
    const ROPE_POINT_DISTANCE = ROPE_LENGTH / NUM_ROPE_POINTS;
    const SUBSTEPS = 4; // substeps per fixed step (see FIXED_DT in common.js); more, shorter substeps beat more iterations
    const ITERATIONS_PER_SUBSTEP = 12; // solver iterations per substep
    const STRENGTH_VARIANCE = 0.4; // +/-40% random per-segment strength, so segments aren't perfectly uniform

    const rope_positions_y = Float64Array.from(
        { length: NUM_ROPE_POINTS },
        (_, i) => handles_y[0] + i * ROPE_POINT_DISTANCE
    ); // The current y position of each rope element
    const rope_positions_x = new Float64Array(NUM_ROPE_POINTS).fill(handles_x[0]); // The current x position of each rope element
    const last_rope_positions_y = Float64Array.from(rope_positions_y); // The last y position of each rope element
    const last_rope_positions_x = Float64Array.from(rope_positions_x); // The last x position of each rope element
    // Inverse mass: 0 for a point held fixed (handle or live drag), 1 otherwise. Recomputed once
    // per substep, so the solver's inner loop needs no per-segment "is this fixed?" lookups.
    const inv_mass = new Float64Array(NUM_ROPE_POINTS);
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

    // Distance constraints, relaxed Gauss-Seidel style. Fixed points have inv_mass 0, so they
    // never move and the free end takes the whole correction.
    function solve_segments(forward) {
        const tear = PHYSICS.tearFactor;
        const last = NUM_ROPE_POINTS - 1;
        for (let k = 0; k < last; k++) {
            const i = forward ? k : last - 1 - k;
            if (broken[i]) continue; // this segment has torn, the two sides are independent now

            const dx = rope_positions_x[i + 1] - rope_positions_x[i];
            const dy = rope_positions_y[i + 1] - rope_positions_y[i];
            const dist_sq = dx * dx + dy * dy;
            const limit = tear * segment_strength[i] * ROPE_POINT_DISTANCE;
            if (dist_sq > limit * limit) {
                broken[i] = true;
                continue;
            }

            const wa = inv_mass[i],
                wb = inv_mass[i + 1];
            const w_sum = wa + wb;
            if (w_sum === 0) continue; // both ends held fixed, nothing to adjust
            const distance = Math.max(Math.sqrt(dist_sq), 0.0001);
            const s = (1 - ROPE_POINT_DISTANCE / distance) / w_sum;
            rope_positions_x[i] += dx * s * wa;
            rope_positions_y[i] += dy * s * wa;
            rope_positions_x[i + 1] -= dx * s * wb;
            rope_positions_y[i + 1] -= dy * s * wb;
        }
    }

    // Internal friction: damp the RELATIVE velocity between neighboring points. This kills
    // whip-like waves traveling along the rope without resisting its bulk motion through space
    // (where neighbors move together and relative velocity is already near zero) - that's what
    // air friction is for, and why cranking air friction up made the whole rope feel sluggish.
    // Applied once per substep, after the solver has settled; the exponential keeps it stable
    // for any slider value and independent of the step size.
    function apply_internal_friction(sub_dt) {
        if (PHYSICS.internalFriction <= 0) return;
        const damp =
            1 -
            Math.exp((-PHYSICS.internalFriction * INTERNAL_FRICTION_SCALE * sub_dt) / REFERENCE_DT);
        for (let i = 0; i < NUM_ROPE_POINTS - 1; i++) {
            if (broken[i]) continue;
            const wa = inv_mass[i],
                wb = inv_mass[i + 1];
            const w_sum = wa + wb;
            if (w_sum === 0) continue;
            const rel_vx =
                rope_positions_x[i + 1] -
                last_rope_positions_x[i + 1] -
                (rope_positions_x[i] - last_rope_positions_x[i]);
            const rel_vy =
                rope_positions_y[i + 1] -
                last_rope_positions_y[i + 1] -
                (rope_positions_y[i] - last_rope_positions_y[i]);
            const fa = (damp * wa) / w_sum,
                fb = (damp * wb) / w_sum;
            last_rope_positions_x[i] -= fa * rel_vx;
            last_rope_positions_y[i] -= fa * rel_vy;
            last_rope_positions_x[i + 1] += fb * rel_vx;
            last_rope_positions_y[i + 1] += fb * rel_vy;
        }
    }

    // Advances the simulation by dt. steps_left is how many animate() calls (this one included)
    // remain in the current frame; the handles cover their remaining distance to the latest
    // mouse target evenly across them, which filters out raw mouse/trackpad noise and lets the
    // solver absorb a moving anchor's motion gradually instead of all at once.
    function animate(dt, steps_left) {
        const sub_dt = dt / SUBSTEPS;
        const point_target = drag.get_point_target();
        // PHYSICS.friction is the fraction of velocity lost per REFERENCE_DT.
        const substep_friction_retention = Math.pow(1 - PHYSICS.friction, sub_dt / REFERENCE_DT);
        const gravity_step = PHYSICS.gravity * sub_dt * sub_dt;

        // Inverse masses: handles and a live-dragged point are fixed. Which points are fixed
        // doesn't change within a step, so this is computed once here, not per substep.
        inv_mass.fill(1);
        for (let i = 0; i < handles_x.length; ++i) inv_mass[handle_map[i]] = 0;
        if (point_target) inv_mass[point_target.idx] = 0;

        for (let step = 0; step < SUBSTEPS; step++) {
            const ease = 1 / (steps_left * SUBSTEPS - step); // share of the remaining distance to cover now

            // Move the handle points toward their targets, also force the last position, since we don't want the rope to accelerate.
            for (let i = 0; i < handles_x.length; ++i) {
                const p = handle_map[i];
                rope_positions_x[p] += (handles_x[i] - rope_positions_x[p]) * ease;
                rope_positions_y[p] += (handles_y[i] - rope_positions_y[p]) * ease;
                last_rope_positions_x[p] = rope_positions_x[p];
                last_rope_positions_y[p] = rope_positions_y[p];
            }
            // Do the same for a point currently being live-dragged, so it doesn't pick up gravity while held.
            if (point_target) {
                const p = point_target.idx;
                rope_positions_x[p] += (point_target.x - rope_positions_x[p]) * ease;
                rope_positions_y[p] += (point_target.y - rope_positions_y[p]) * ease;
                last_rope_positions_x[p] = rope_positions_x[p];
                last_rope_positions_y[p] = rope_positions_y[p];
            }

            // Step 1: Apply a verlet integration to each rope point (fixed points can't move).
            for (let i = 0; i < NUM_ROPE_POINTS; i++) {
                if (inv_mass[i] === 0) continue;
                const last_x = rope_positions_x[i];
                rope_positions_x[i] +=
                    substep_friction_retention * (rope_positions_x[i] - last_rope_positions_x[i]);
                last_rope_positions_x[i] = last_x;

                const last_y = rope_positions_y[i];
                rope_positions_y[i] +=
                    substep_friction_retention * (rope_positions_y[i] - last_rope_positions_y[i]) +
                    gravity_step;
                last_rope_positions_y[i] = last_y;
            }

            // Step 2: Constrain the rope points to a fixed distance from each other. The sweep
            // direction alternates each iteration to cancel Gauss-Seidel directional bias.
            for (let count = 0; count < ITERATIONS_PER_SUBSTEP; ++count) {
                solve_segments(count % 2 === 0);
            }
            constrain_to_bounds(rope_positions_x, rope_positions_y, canvas.width, canvas.height);
            apply_internal_friction(sub_dt);
        }

        apply_contact_friction(
            rope_positions_x,
            rope_positions_y,
            last_rope_positions_x,
            last_rope_positions_y,
            canvas.width,
            canvas.height,
            PHYSICS.groundFriction,
            dt
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
