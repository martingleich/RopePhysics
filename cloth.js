(function () {
    const canvas = document.getElementById('cloth_canvas');

    let handles_x = [100, 300];
    let handles_y = [50, 50];
    const HANDLE_RADIUS = 10;
    const CLOTH_LENGTH = 200;
    const NUM_CLOTH_POINTS = 30;
    const CLOTH_POINT_DISTANCE = CLOTH_LENGTH / (NUM_CLOTH_POINTS - 1);
    const SUBSTEPS = 4; // substeps per fixed step (see FIXED_DT in common.js); more, shorter substeps beat more iterations
    const ITERATIONS_PER_SUBSTEP = 3; // solver iterations per substep
    const THREAD_BIAS_VERTICAL = 0.8; // vertical ("warp") connections are inherently a bit weaker than horizontal ("weft") ones
    const STRENGTH_VARIANCE = 0.35; // +/-35% random per-connection strength on top of the bias, so no two threads are identical

    const NUM_POINTS = NUM_CLOTH_POINTS * NUM_CLOTH_POINTS;
    const cloth_positions_x = new Float64Array(NUM_POINTS); // The current x position of each cloth point
    const cloth_positions_y = new Float64Array(NUM_POINTS); // The current y position of each cloth point
    const cloth_positions_z = new Float64Array(NUM_POINTS); // The current z position of each cloth point
    const last_cloth_positions_x = new Float64Array(NUM_POINTS);
    const last_cloth_positions_y = new Float64Array(NUM_POINTS);
    const last_cloth_positions_z = new Float64Array(NUM_POINTS);
    // Inverse mass: 0 for a point held fixed (top row / live drag), 1 otherwise. Recomputed once
    // per substep, so the solver's inner loop needs no per-constraint "is this fixed?" lookups.
    const inv_mass = new Float64Array(NUM_POINTS);

    function get_position_x(i) {
        return handles_x[0] + (i % NUM_CLOTH_POINTS) * CLOTH_POINT_DISTANCE;
    }
    function get_position_y(i) {
        return handles_y[0] + Math.floor(i / NUM_CLOTH_POINTS) * CLOTH_POINT_DISTANCE;
    }

    // Flat constraint list, built once. Kinds 0/1 are the structural grid (right, below), kinds
    // 2/3 the diagonal shear connections (top-left to bottom-right, top-right to bottom-left).
    const KIND_RIGHT = 0,
        KIND_BELOW = 1,
        KIND_DIAG1 = 2,
        KIND_DIAG2 = 3;
    const list_a = [];
    const list_b = [];
    const list_kind = [];
    for (let r = 0; r < NUM_CLOTH_POINTS; r++) {
        for (let c = 0; c < NUM_CLOTH_POINTS; c++) {
            const index = r * NUM_CLOTH_POINTS + c;
            const add = (other, kind) => {
                list_a.push(index);
                list_b.push(other);
                list_kind.push(kind);
            };
            if (c < NUM_CLOTH_POINTS - 1) add(index + 1, KIND_RIGHT);
            if (r < NUM_CLOTH_POINTS - 1) add(index + NUM_CLOTH_POINTS, KIND_BELOW);
            if (r < NUM_CLOTH_POINTS - 1 && c < NUM_CLOTH_POINTS - 1)
                add(index + NUM_CLOTH_POINTS + 1, KIND_DIAG1);
            if (r < NUM_CLOTH_POINTS - 1 && c > 0) add(index + NUM_CLOTH_POINTS - 1, KIND_DIAG2);
        }
    }
    const NUM_CONSTRAINTS = list_a.length;
    const cA = Uint32Array.from(list_a);
    const cB = Uint32Array.from(list_b);
    const cKind = Uint8Array.from(list_kind);
    const cRest = new Float64Array(NUM_CONSTRAINTS); // rest length of each connection
    for (let k = 0; k < NUM_CONSTRAINTS; k++)
        cRest[k] = cKind[k] >= KIND_DIAG1 ? Math.SQRT2 * CLOTH_POINT_DISTANCE : CLOTH_POINT_DISTANCE;
    // cLimit[k]: rest length times the per-connection random tear-resistance multiplier. The
    // connection tears permanently once stretched beyond PHYSICS.tearFactor * cLimit[k].
    const cLimit = new Float64Array(NUM_CONSTRAINTS);
    const cBroken = new Uint8Array(NUM_CONSTRAINTS); // 1 once that connection has torn

    function randomize_strength() {
        for (let k = 0; k < NUM_CONSTRAINTS; k++) {
            const variance = 1 + (Math.random() - 0.5) * STRENGTH_VARIANCE;
            cLimit[k] = cRest[k] * variance * (cKind[k] === KIND_BELOW ? THREAD_BIAS_VERTICAL : 1);
        }
    }

    // Restores the cloth to its initial, undamaged, flat layout.
    function reset() {
        handles_x[0] = 100;
        handles_y[0] = 50;
        handles_x[1] = 300;
        handles_y[1] = 50;
        for (let i = 0; i < NUM_POINTS; i++) {
            cloth_positions_x[i] = get_position_x(i);
            cloth_positions_y[i] = get_position_y(i);
            cloth_positions_z[i] = Math.random() - 0.5;
            last_cloth_positions_x[i] = cloth_positions_x[i];
            last_cloth_positions_y[i] = cloth_positions_y[i];
            last_cloth_positions_z[i] = cloth_positions_z[i];
        }
        cBroken.fill(0);
        randomize_strength();
    }
    reset();
    document.getElementById('reset_button')?.addEventListener('click', reset);

    const drag = setup_dragging(
        canvas,
        handles_x,
        handles_y,
        HANDLE_RADIUS,
        cloth_positions_x,
        cloth_positions_y,
        // A click grabs the nearest point if within reach, plus everything within the "Grab size"
        // radius of the click. The reach never drops below the handle radius, so a grab size of 0
        // still grabs a single point as easily as before.
        () => Math.max(PHYSICS.grabSize, HANDLE_RADIUS),
        () => PHYSICS.grabSize
    );

    // Distance constraints, relaxed Gauss-Seidel style. Fixed points have inv_mass 0, so they
    // never move and the free end takes the whole correction.
    function solve_constraints(forward) {
        const tear = PHYSICS.tearFactor;
        for (let j = 0; j < NUM_CONSTRAINTS; j++) {
            const k = forward ? j : NUM_CONSTRAINTS - 1 - j;
            if (cBroken[k] === 1) continue;
            const a = cA[k],
                b = cB[k];
            const dx = cloth_positions_x[b] - cloth_positions_x[a];
            const dy = cloth_positions_y[b] - cloth_positions_y[a];
            const dz = cloth_positions_z[b] - cloth_positions_z[a];
            const dist_sq = dx * dx + dy * dy + dz * dz;
            const limit = tear * cLimit[k];
            if (dist_sq > limit * limit) {
                cBroken[k] = 1;
                continue;
            }
            const wa = inv_mass[a],
                wb = inv_mass[b];
            const w_sum = wa + wb;
            if (w_sum === 0) continue; // both ends held fixed, nothing to adjust
            const distance = Math.max(Math.sqrt(dist_sq), 0.0001);
            const s = (distance - cRest[k]) / (distance * w_sum);
            const ca = s * wa,
                cb = s * wb;
            cloth_positions_x[a] += dx * ca;
            cloth_positions_y[a] += dy * ca;
            cloth_positions_z[a] += dz * ca;
            cloth_positions_x[b] -= dx * cb;
            cloth_positions_y[b] -= dy * cb;
            cloth_positions_z[b] -= dz * cb;
        }
    }

    // Internal friction: damp the RELATIVE velocity between connected points. Kills whip-like
    // waves without resisting the cloth's overall bulk motion. Applied once per substep, after
    // the solver has settled; the exponential keeps it stable for any slider value and
    // independent of the step size.
    function apply_internal_friction(sub_dt) {
        if (PHYSICS.internalFriction <= 0) return;
        const damp =
            1 -
            Math.exp((-PHYSICS.internalFriction * INTERNAL_FRICTION_SCALE * sub_dt) / REFERENCE_DT);
        for (let k = 0; k < NUM_CONSTRAINTS; k++) {
            if (cBroken[k] === 1) continue;
            const a = cA[k],
                b = cB[k];
            const wa = inv_mass[a],
                wb = inv_mass[b];
            const w_sum = wa + wb;
            if (w_sum === 0) continue;
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
            const fa = (damp * wa) / w_sum,
                fb = (damp * wb) / w_sum;
            last_cloth_positions_x[a] -= fa * rel_vx;
            last_cloth_positions_y[a] -= fa * rel_vy;
            last_cloth_positions_z[a] -= fa * rel_vz;
            last_cloth_positions_x[b] += fb * rel_vx;
            last_cloth_positions_y[b] += fb * rel_vy;
            last_cloth_positions_z[b] += fb * rel_vz;
        }
    }

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

        // Draw the structural grid (right/below), then the diagonal (shear) connections,
        // faintly. The shear connections are real physics constraints too - without drawing
        // them, a patch held only by a diagonal (its structural neighbors all torn away) looks
        // like it's floating disconnected, when it's actually still tethered.
        for (let pass = 0; pass < 2; pass++) {
            const shear = pass === 1;
            ctx.strokeStyle = shear ? 'rgba(255, 255, 255, 0.25)' : 'rgba(255, 255, 255, 0.75)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            for (let k = 0; k < NUM_CONSTRAINTS; k++) {
                if (cBroken[k] === 1 || cKind[k] >= KIND_DIAG1 !== shear) continue;
                ctx.moveTo(cloth_positions_x[cA[k]], cloth_positions_y[cA[k]]);
                ctx.lineTo(cloth_positions_x[cB[k]], cloth_positions_y[cB[k]]);
            }
            ctx.stroke();
        }
    }

    // Advances the simulation by dt. steps_left is how many animate() calls (this one included)
    // remain in the current frame; the handles cover their remaining distance to the latest
    // mouse target evenly across them, which filters out raw mouse/trackpad noise and lets the
    // solver absorb a moving anchor's motion gradually instead of all at once.
    function animate(dt, steps_left) {
        const sub_dt = dt / SUBSTEPS;
        const point_targets = drag.get_point_targets();
        // PHYSICS.friction is the fraction of velocity lost per REFERENCE_DT.
        const substep_friction_retention = Math.pow(1 - PHYSICS.friction, sub_dt / REFERENCE_DT);
        const gravity_step = PHYSICS.gravity * sub_dt * sub_dt;
        const last_corner = NUM_CLOTH_POINTS - 1;

        // Inverse masses: the top row and a live-dragged point are fixed. Which points are fixed
        // doesn't change within a step, so this is computed once here, not per substep.
        inv_mass.fill(1);
        inv_mass.fill(0, 0, NUM_CLOTH_POINTS);
        if (point_targets)
            for (let n = 0; n < point_targets.count; n++) inv_mass[point_targets.idx[n]] = 0;

        for (let step = 0; step < SUBSTEPS; step++) {
            const ease = 1 / (steps_left * SUBSTEPS - step); // share of the remaining distance to cover now

            // Move the handle points toward their targets, also force the last position, since we don't want the cloth to accelerate.
            cloth_positions_x[0] += (handles_x[0] - cloth_positions_x[0]) * ease;
            cloth_positions_y[0] += (handles_y[0] - cloth_positions_y[0]) * ease;
            last_cloth_positions_x[0] = cloth_positions_x[0];
            last_cloth_positions_y[0] = cloth_positions_y[0];
            cloth_positions_x[last_corner] += (handles_x[1] - cloth_positions_x[last_corner]) * ease;
            cloth_positions_y[last_corner] += (handles_y[1] - cloth_positions_y[last_corner]) * ease;
            last_cloth_positions_x[last_corner] = cloth_positions_x[last_corner];
            last_cloth_positions_y[last_corner] = cloth_positions_y[last_corner];
            // The rest of the top row is anchored along a straight rail between the two corner
            // handles, like a curtain hung from a rod - so every point along it bears real
            // tension (and can tear on its own), not just the two corner connections.
            for (let c = 1; c < last_corner; c++) {
                const frac = c / last_corner;
                cloth_positions_x[c] =
                    cloth_positions_x[0] +
                    (cloth_positions_x[last_corner] - cloth_positions_x[0]) * frac;
                cloth_positions_y[c] =
                    cloth_positions_y[0] +
                    (cloth_positions_y[last_corner] - cloth_positions_y[0]) * frac;
                last_cloth_positions_x[c] = cloth_positions_x[c];
                last_cloth_positions_y[c] = cloth_positions_y[c];
            }
            // Do the same for the points currently being live-dragged, so it doesn't pick up gravity while held.
            if (point_targets) {
                for (let n = 0; n < point_targets.count; n++) {
                    const p = point_targets.idx[n];
                    cloth_positions_x[p] += (point_targets.x[n] - cloth_positions_x[p]) * ease;
                    cloth_positions_y[p] += (point_targets.y[n] - cloth_positions_y[p]) * ease;
                    last_cloth_positions_x[p] = cloth_positions_x[p];
                    last_cloth_positions_y[p] = cloth_positions_y[p];
                }
            }

            // Step 1: Apply a verlet integration to each cloth point (fixed points can't move).
            for (let i = 0; i < NUM_POINTS; i++) {
                if (inv_mass[i] === 0) continue;
                const last_x = cloth_positions_x[i];
                cloth_positions_x[i] +=
                    substep_friction_retention * (cloth_positions_x[i] - last_cloth_positions_x[i]);
                last_cloth_positions_x[i] = last_x;

                const last_y = cloth_positions_y[i];
                cloth_positions_y[i] +=
                    substep_friction_retention *
                        (cloth_positions_y[i] - last_cloth_positions_y[i]) +
                    gravity_step;
                last_cloth_positions_y[i] = last_y;

                const last_z = cloth_positions_z[i];
                cloth_positions_z[i] +=
                    substep_friction_retention * (cloth_positions_z[i] - last_cloth_positions_z[i]);
                last_cloth_positions_z[i] = last_z;
            }

            // Step 2: Constrain the cloth points to a fixed distance from each other. The sweep
            // direction alternates each iteration to cancel Gauss-Seidel directional bias.
            for (let count = 0; count < ITERATIONS_PER_SUBSTEP; ++count) {
                solve_constraints(count % 2 === 0);
            }
            constrain_to_bounds(cloth_positions_x, cloth_positions_y, canvas.width, canvas.height);
            apply_internal_friction(sub_dt);
        }

        apply_contact_friction(
            cloth_positions_x,
            cloth_positions_y,
            last_cloth_positions_x,
            last_cloth_positions_y,
            canvas.width,
            canvas.height,
            PHYSICS.groundFriction,
            dt
        );
    }

    main_cycle_if_visible(canvas, draw, animate);
})();
