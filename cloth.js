(function () {
    const canvas = document.getElementById('cloth_canvas');

    let handles_x = [100, 300];
    let handles_y = [50, 50];
    const HANDLE_RADIUS = 10;
    const CLOTH_LENGTH = 200;
    const NUM_CLOTH_POINTS = 30;
    const CLOTH_POINT_DISTANCE = CLOTH_LENGTH / (NUM_CLOTH_POINTS - 1);
    const SUBSTEPS = 8; // split each frame into several smaller physics steps, so gravity never
    // outruns the constraint solver (fixes long-term length "creep")
    const ITERATIONS_PER_SUBSTEP = 12; // 8*12 = 96, close to the previous 3*NUM_CLOTH_POINTS total
    const THREAD_BIAS_VERTICAL = 0.8; // vertical ("warp") connections are inherently a bit weaker than horizontal ("weft") ones
    const STRENGTH_VARIANCE = 0.35; // +/-35% random per-connection strength on top of the bias, so no two threads are identical

    function get_position_x(i) {
        return handles_x[0] + (i % NUM_CLOTH_POINTS) * CLOTH_POINT_DISTANCE;
    }
    function get_position_y(i) {
        return handles_y[0] + Math.floor(i / NUM_CLOTH_POINTS) * CLOTH_POINT_DISTANCE;
    }
    let cloth_positions_y = [...Array(NUM_CLOTH_POINTS * NUM_CLOTH_POINTS).keys()].map((i) =>
        get_position_y(i)
    ); // The current y position of each rope element
    let cloth_positions_x = [...Array(NUM_CLOTH_POINTS * NUM_CLOTH_POINTS).keys()].map((i) =>
        get_position_x(i)
    ); // The current x position of each rope element
    let cloth_positions_z = [...Array(NUM_CLOTH_POINTS * NUM_CLOTH_POINTS).keys()].map(
        (i) => Math.random() - 0.5
    ); // The current z position of each rope element
    let last_cloth_positions_y = [...cloth_positions_y]; // The last y position of each rope element
    let last_cloth_positions_x = [...cloth_positions_x]; // The last x position of each rope element
    let last_cloth_positions_z = [...cloth_positions_z]; // The last x position of each rope element

    // broken_X[index]: true once that connection (from point `index` to its neighbor) has torn
    let broken_right = new Array(NUM_CLOTH_POINTS * NUM_CLOTH_POINTS).fill(false);
    let broken_below = new Array(NUM_CLOTH_POINTS * NUM_CLOTH_POINTS).fill(false);
    let broken_diag1 = new Array(NUM_CLOTH_POINTS * NUM_CLOTH_POINTS).fill(false); // top-left to bottom-right
    let broken_diag2 = new Array(NUM_CLOTH_POINTS * NUM_CLOTH_POINTS).fill(false); // top-right to bottom-left

    // strength_X[index]: per-connection random tear-resistance multiplier (see randomize_strength)
    let strength_right = new Array(NUM_CLOTH_POINTS * NUM_CLOTH_POINTS);
    let strength_below = new Array(NUM_CLOTH_POINTS * NUM_CLOTH_POINTS);
    let strength_diag1 = new Array(NUM_CLOTH_POINTS * NUM_CLOTH_POINTS);
    let strength_diag2 = new Array(NUM_CLOTH_POINTS * NUM_CLOTH_POINTS);

    function randomize_strength() {
        for (let i = 0; i < strength_right.length; i++) {
            const variance = () => 1 + (Math.random() - 0.5) * STRENGTH_VARIANCE;
            strength_right[i] = variance();
            strength_below[i] = THREAD_BIAS_VERTICAL * variance();
            strength_diag1[i] = variance();
            strength_diag2[i] = variance();
        }
    }
    randomize_strength();

    const drag = setup_dragging(
        canvas,
        handles_x,
        handles_y,
        HANDLE_RADIUS,
        cloth_positions_x,
        cloth_positions_y,
        HANDLE_RADIUS
    );

    // Is this point currently held fixed, either by being anchored along the top row
    // (like a curtain hung from a rod - not just the two corners) or a live drag?
    function is_fixed(i) {
        return i < NUM_CLOTH_POINTS || drag.is_point_pinned(i);
    }

    // Applies a distance-constraint correction between points a and b, respecting whether either is fixed.
    function apply_correction(a, b, offsetX, offsetY, offsetZ) {
        const aFixed = is_fixed(a),
            bFixed = is_fixed(b);
        if (aFixed && bFixed) {
            // both ends held fixed, nothing to adjust
        } else if (aFixed) {
            cloth_positions_x[b] -= 2 * offsetX;
            cloth_positions_y[b] -= 2 * offsetY;
            cloth_positions_z[b] -= 2 * offsetZ;
        } else if (bFixed) {
            cloth_positions_x[a] += 2 * offsetX;
            cloth_positions_y[a] += 2 * offsetY;
            cloth_positions_z[a] += 2 * offsetZ;
        } else {
            cloth_positions_x[a] += offsetX;
            cloth_positions_y[a] += offsetY;
            cloth_positions_z[a] += offsetZ;
            cloth_positions_x[b] -= offsetX;
            cloth_positions_y[b] -= offsetY;
            cloth_positions_z[b] -= offsetZ;
        }

        // Internal friction: damp the RELATIVE velocity between this pair, right here inside the
        // solver's own relaxation (applying it only once per substep, after the solver, turned out
        // too late to matter for the rope - the tear-check already sees the un-damped transient
        // distances). Kills whip-like waves without resisting the cloth's overall bulk motion.
        if (PHYSICS.internalFriction > 0 && !(aFixed && bFixed)) {
            const damp = PHYSICS.internalFriction / ITERATIONS_PER_SUBSTEP;
            const rel_vx =
                cloth_positions_x[b] -
                last_cloth_positions_x[b] -
                (cloth_positions_x[a] - last_cloth_positions_x[a]);
            const rel_vy =
                cloth_positions_y[b] -
                last_cloth_positions_y[b] -
                (cloth_positions_y[a] - last_cloth_positions_y[a]);
            const rel_vz =
                cloth_positions_z[b] -
                last_cloth_positions_z[b] -
                (cloth_positions_z[a] - last_cloth_positions_z[a]);
            if (aFixed) {
                last_cloth_positions_x[b] += damp * rel_vx;
                last_cloth_positions_y[b] += damp * rel_vy;
                last_cloth_positions_z[b] += damp * rel_vz;
            } else if (bFixed) {
                last_cloth_positions_x[a] -= damp * rel_vx;
                last_cloth_positions_y[a] -= damp * rel_vy;
                last_cloth_positions_z[a] -= damp * rel_vz;
            } else {
                last_cloth_positions_x[a] -= damp * 0.5 * rel_vx;
                last_cloth_positions_y[a] -= damp * 0.5 * rel_vy;
                last_cloth_positions_z[a] -= damp * 0.5 * rel_vz;
                last_cloth_positions_x[b] += damp * 0.5 * rel_vx;
                last_cloth_positions_y[b] += damp * 0.5 * rel_vy;
                last_cloth_positions_z[b] += damp * 0.5 * rel_vz;
            }
        }
    }

    // Restores the cloth to its initial, undamaged, flat layout.
    function reset() {
        handles_x[0] = 100;
        handles_y[0] = 50;
        handles_x[1] = 300;
        handles_y[1] = 50;
        for (let i = 0; i < NUM_CLOTH_POINTS * NUM_CLOTH_POINTS; i++) {
            cloth_positions_x[i] = get_position_x(i);
            cloth_positions_y[i] = get_position_y(i);
            cloth_positions_z[i] = Math.random() - 0.5;
            last_cloth_positions_x[i] = cloth_positions_x[i];
            last_cloth_positions_y[i] = cloth_positions_y[i];
            last_cloth_positions_z[i] = cloth_positions_z[i];
        }
        broken_right.fill(false);
        broken_below.fill(false);
        broken_diag1.fill(false);
        broken_diag2.fill(false);
        randomize_strength();
    }
    document.getElementById('reset_button')?.addEventListener('click', reset);

    function draw(ctx, canvas) {
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

        // Draw the cloth's structural grid (right/below)
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.75)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let r = 0; r < NUM_CLOTH_POINTS; r++) {
            for (let c = 0; c < NUM_CLOTH_POINTS; c++) {
                const index = r * NUM_CLOTH_POINTS + c;
                if (c < NUM_CLOTH_POINTS - 1 && !broken_right[index]) {
                    ctx.moveTo(cloth_positions_x[index], cloth_positions_y[index]);
                    ctx.lineTo(cloth_positions_x[index + 1], cloth_positions_y[index + 1]);
                }
                if (r < NUM_CLOTH_POINTS - 1 && !broken_below[index]) {
                    ctx.moveTo(cloth_positions_x[index], cloth_positions_y[index]);
                    ctx.lineTo(
                        cloth_positions_x[index + NUM_CLOTH_POINTS],
                        cloth_positions_y[index + NUM_CLOTH_POINTS]
                    );
                }
            }
        }
        ctx.stroke();

        // Also draw the diagonal (shear) connections, faintly. They're real physics constraints
        // too - without drawing them, a patch held only by a diagonal (its structural neighbors
        // all torn away) looks like it's floating disconnected, when it's actually still tethered.
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let r = 0; r < NUM_CLOTH_POINTS; r++) {
            for (let c = 0; c < NUM_CLOTH_POINTS; c++) {
                const index = r * NUM_CLOTH_POINTS + c;
                if (r < NUM_CLOTH_POINTS - 1 && c < NUM_CLOTH_POINTS - 1 && !broken_diag1[index]) {
                    ctx.moveTo(cloth_positions_x[index], cloth_positions_y[index]);
                    ctx.lineTo(
                        cloth_positions_x[index + NUM_CLOTH_POINTS + 1],
                        cloth_positions_y[index + NUM_CLOTH_POINTS + 1]
                    );
                }
                if (r < NUM_CLOTH_POINTS - 1 && c > 0 && !broken_diag2[index]) {
                    ctx.moveTo(cloth_positions_x[index], cloth_positions_y[index]);
                    ctx.lineTo(
                        cloth_positions_x[index + NUM_CLOTH_POINTS - 1],
                        cloth_positions_y[index + NUM_CLOTH_POINTS - 1]
                    );
                }
            }
        }
        ctx.stroke();
    }

    function animate(dt) {
        const sub_dt = dt / SUBSTEPS;

        // Capture where each externally-driven point currently is, so it can be eased
        // toward its live target a little each substep instead of snapping there in one
        // go. This filters out raw mouse/trackpad noise, and lets the solver absorb a
        // moving anchor's motion gradually instead of all at once in the first substep.
        const handle_start_x = [cloth_positions_x[0], cloth_positions_x[NUM_CLOTH_POINTS - 1]];
        const handle_start_y = [cloth_positions_y[0], cloth_positions_y[NUM_CLOTH_POINTS - 1]];
        const point_target = drag.get_point_target();
        const point_start_x = point_target ? cloth_positions_x[point_target.idx] : 0;
        const point_start_y = point_target ? cloth_positions_y[point_target.idx] : 0;
        // PHYSICS.friction is a per-frame retention factor, but Step 1 below now runs once per
        // substep - so take the SUBSTEPS-th root here, otherwise the damping compounds to
        // (1-friction)^SUBSTEPS per frame instead of the intended (1-friction).
        const substep_friction_retention = Math.pow(1 - PHYSICS.friction, 1 / SUBSTEPS);

        for (let step = 0; step < SUBSTEPS; step++) {
            const t = (step + 1) / SUBSTEPS;

            // Update the rope-position with the handle, also force the last position, since we don't want the rope to accelerate.
            cloth_positions_x[0] = handle_start_x[0] + (handles_x[0] - handle_start_x[0]) * t;
            cloth_positions_y[0] = handle_start_y[0] + (handles_y[0] - handle_start_y[0]) * t;
            last_cloth_positions_x[0] = cloth_positions_x[0];
            last_cloth_positions_y[0] = cloth_positions_y[0];
            cloth_positions_x[NUM_CLOTH_POINTS - 1] =
                handle_start_x[1] + (handles_x[1] - handle_start_x[1]) * t;
            cloth_positions_y[NUM_CLOTH_POINTS - 1] =
                handle_start_y[1] + (handles_y[1] - handle_start_y[1]) * t;
            last_cloth_positions_x[NUM_CLOTH_POINTS - 1] = cloth_positions_x[NUM_CLOTH_POINTS - 1];
            last_cloth_positions_y[NUM_CLOTH_POINTS - 1] = cloth_positions_y[NUM_CLOTH_POINTS - 1];
            // The rest of the top row is anchored along a straight rail between the two corner
            // handles, like a curtain hung from a rod - so every point along it bears real
            // tension (and can tear on its own), not just the two corner connections.
            for (let c = 1; c < NUM_CLOTH_POINTS - 1; c++) {
                const frac = c / (NUM_CLOTH_POINTS - 1);
                cloth_positions_x[c] =
                    cloth_positions_x[0] +
                    (cloth_positions_x[NUM_CLOTH_POINTS - 1] - cloth_positions_x[0]) * frac;
                cloth_positions_y[c] =
                    cloth_positions_y[0] +
                    (cloth_positions_y[NUM_CLOTH_POINTS - 1] - cloth_positions_y[0]) * frac;
                last_cloth_positions_x[c] = cloth_positions_x[c];
                last_cloth_positions_y[c] = cloth_positions_y[c];
            }
            // Do the same for a point currently being live-dragged, so it doesn't pick up gravity while held.
            if (point_target) {
                cloth_positions_x[point_target.idx] =
                    point_start_x + (point_target.x - point_start_x) * t;
                cloth_positions_y[point_target.idx] =
                    point_start_y + (point_target.y - point_start_y) * t;
                last_cloth_positions_x[point_target.idx] = cloth_positions_x[point_target.idx];
                last_cloth_positions_y[point_target.idx] = cloth_positions_y[point_target.idx];
            }

            // Update the rope positions
            // Step 1: Apply a verlet integration to each rope point.
            for (let i = 0; i < NUM_CLOTH_POINTS * NUM_CLOTH_POINTS; i++) {
                // Skip the first point, since it is the handle and cannot move
                if (is_fixed(i)) continue;
                const last_x = cloth_positions_x[i];
                cloth_positions_x[i] +=
                    substep_friction_retention * (cloth_positions_x[i] - last_cloth_positions_x[i]);
                last_cloth_positions_x[i] = last_x;

                const last_y = cloth_positions_y[i];
                cloth_positions_y[i] +=
                    substep_friction_retention *
                        (cloth_positions_y[i] - last_cloth_positions_y[i]) +
                    PHYSICS.gravity * sub_dt * sub_dt;
                last_cloth_positions_y[i] = last_y;

                const last_z = cloth_positions_z[i];
                cloth_positions_z[i] +=
                    substep_friction_retention * (cloth_positions_z[i] - last_cloth_positions_z[i]);
                last_cloth_positions_z[i] = last_z;
            }

            // Step 2: Constrain the rope points to a maximum distance from each other
            for (let count = 0; count < ITERATIONS_PER_SUBSTEP; ++count) {
                const forward = count % 2 === 0; // alternate sweep direction each iteration to cancel Gauss-Seidel directional bias
                // Foreach connection between two points
                for (let rr = 0; rr < NUM_CLOTH_POINTS; rr++) {
                    const r = forward ? rr : NUM_CLOTH_POINTS - 1 - rr;
                    for (let cc = 0; cc < NUM_CLOTH_POINTS; cc++) {
                        const c = forward ? cc : NUM_CLOTH_POINTS - 1 - cc;
                        const index = r * NUM_CLOTH_POINTS + c;
                        if (c < NUM_CLOTH_POINTS - 1 && !broken_right[index]) {
                            // Visit to the right
                            const b = index + 1;
                            const dx = cloth_positions_x[b] - cloth_positions_x[index];
                            const dy = cloth_positions_y[b] - cloth_positions_y[index];
                            const dz = cloth_positions_z[b] - cloth_positions_z[index];
                            const distance = Math.max(
                                Math.sqrt(dx ** 2 + dy ** 2 + dz ** 2),
                                0.0001
                            );

                            if (
                                distance >
                                PHYSICS.tearFactor * strength_right[index] * CLOTH_POINT_DISTANCE
                            ) {
                                broken_right[index] = true;
                            } else {
                                const d = distance - CLOTH_POINT_DISTANCE;
                                const offsetX = ((dx / distance) * d) / 2;
                                const offsetY = ((dy / distance) * d) / 2;
                                const offsetZ = ((dz / distance) * d) / 2;
                                apply_correction(index, b, offsetX, offsetY, offsetZ);
                            }
                        }
                        if (r < NUM_CLOTH_POINTS - 1 && !broken_below[index]) {
                            // Visit below
                            const b = index + NUM_CLOTH_POINTS;
                            const dx = cloth_positions_x[b] - cloth_positions_x[index];
                            const dy = cloth_positions_y[b] - cloth_positions_y[index];
                            const dz = cloth_positions_z[b] - cloth_positions_z[index];
                            const distance = Math.max(
                                Math.sqrt(dx ** 2 + dy ** 2 + dz ** 2),
                                0.0001
                            );

                            if (
                                distance >
                                PHYSICS.tearFactor * strength_below[index] * CLOTH_POINT_DISTANCE
                            ) {
                                broken_below[index] = true;
                            } else {
                                const d = distance - CLOTH_POINT_DISTANCE;
                                const offsetX = ((dx / distance) * d) / 2;
                                const offsetY = ((dy / distance) * d) / 2;
                                const offsetZ = ((dz / distance) * d) / 2;
                                apply_correction(index, b, offsetX, offsetY, offsetZ);
                            }
                        }
                        // Visit diagonal(top left to buttom right)
                        if (
                            r < NUM_CLOTH_POINTS - 1 &&
                            c < NUM_CLOTH_POINTS - 1 &&
                            !broken_diag1[index]
                        ) {
                            const b = index + NUM_CLOTH_POINTS + 1;
                            const dx = cloth_positions_x[b] - cloth_positions_x[index];
                            const dy = cloth_positions_y[b] - cloth_positions_y[index];
                            const dz = cloth_positions_z[b] - cloth_positions_z[index];
                            const distance = Math.max(
                                Math.sqrt(dx ** 2 + dy ** 2 + dz ** 2),
                                0.0001
                            );
                            const rest = Math.sqrt(2) * CLOTH_POINT_DISTANCE;

                            if (distance > PHYSICS.tearFactor * strength_diag1[index] * rest) {
                                broken_diag1[index] = true;
                            } else {
                                const d = distance - rest;
                                const offsetX = ((dx / distance) * d) / 2;
                                const offsetY = ((dy / distance) * d) / 2;
                                const offsetZ = ((dz / distance) * d) / 2;
                                apply_correction(index, b, offsetX, offsetY, offsetZ);
                            }
                        }
                        // Visit diagonal(top right to buttom left)
                        if (r < NUM_CLOTH_POINTS - 1 && c > 0 && !broken_diag2[index]) {
                            const b = index + NUM_CLOTH_POINTS - 1;
                            const dx = cloth_positions_x[b] - cloth_positions_x[index];
                            const dy = cloth_positions_y[b] - cloth_positions_y[index];
                            const dz = cloth_positions_z[b] - cloth_positions_z[index];
                            const distance = Math.max(
                                Math.sqrt(dx ** 2 + dy ** 2 + dz ** 2),
                                0.0001
                            );
                            const rest = Math.sqrt(2) * CLOTH_POINT_DISTANCE;

                            if (distance > PHYSICS.tearFactor * strength_diag2[index] * rest) {
                                broken_diag2[index] = true;
                            } else {
                                const d = distance - rest;
                                const offsetX = ((dx / distance) * d) / 2;
                                const offsetY = ((dy / distance) * d) / 2;
                                const offsetZ = ((dz / distance) * d) / 2;
                                apply_correction(index, b, offsetX, offsetY, offsetZ);
                            }
                        }
                    }
                }
                constrain_to_bounds(
                    cloth_positions_x,
                    cloth_positions_y,
                    canvas.width,
                    canvas.height
                );
            }
        }

        apply_contact_friction(
            cloth_positions_x,
            cloth_positions_y,
            last_cloth_positions_x,
            last_cloth_positions_y,
            canvas.width,
            canvas.height,
            PHYSICS.groundFriction
        );
    }

    main_cycle_if_visible(canvas, draw, animate);
})();
