// The simulation always advances in fixed steps, so its behavior does not depend on the display's
// frame rate. Each frame runs as many steps as real time demands, but never more than
// MAX_STEPS_PER_FRAME: on a slow machine the simulation then runs in slow motion instead of
// spiraling (more steps -> slower frame -> even more steps).
const FIXED_DT = 1 / 120;
const MAX_STEPS_PER_FRAME = 2;
// Tunable rates (friction, damping) are specified relative to this reference frame time.
const REFERENCE_DT = 1 / 60;
// The old code had 8 substeps per reference frame, each damping by exp(-internalFriction).
const INTERNAL_FRICTION_SCALE = 8;

// Calls animate(FIXED_DT, steps_left) once per step and draw(ctx, canvas) once per frame.
// steps_left counts down to 1 across a frame's steps, so handle motion recorded during the
// frame can be spread evenly over them.
function main_cycle_if_visible(canvas, draw, animate) {
    let animationFrameId;
    let lastTime = NaN;
    let accumulator = 0;
    const ctx = canvas.getContext('2d');

    function cycle() {
        var time = performance.now() / 1000;
        if (lastTime) accumulator += Math.min(time - lastTime, 0.1);
        lastTime = time;
        let steps = Math.floor(accumulator / FIXED_DT);
        if (steps > MAX_STEPS_PER_FRAME) {
            steps = MAX_STEPS_PER_FRAME;
            accumulator = 0; // drop the backlog instead of trying to catch up
        } else {
            accumulator -= steps * FIXED_DT;
        }
        for (let i = 0; i < steps; i++) animate(FIXED_DT, steps - i);
        draw(ctx, canvas);
        animationFrameId = requestAnimationFrame(cycle);
    }
    const observer = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
            if (entry.isIntersecting) {
                if (!animationFrameId) cycle();
            } else if (animationFrameId) {
                // Stop animation if canvas is not visible
                cancelAnimationFrame(animationFrameId);
                animationFrameId = null;
                lastTime = NaN; // don't count the time spent hidden as elapsed simulation time
                accumulator = 0;
            }
        });
    });

    // Observe the canvas element
    observer.observe(canvas);
}

// Lets the user drag the named handles (handles_x/y, always pinned), or grab simulated points
// (positions_x/y) and drag them while the mouse is held, releasing them back into the simulation
// on mouseup. Named handles take priority when both overlap a click.
//
// A click on the simulation starts a drag when a point lies within grab_radius of the cursor
// (a number, or a function returning one, so it can follow a live setting). The nearest point is
// always grabbed. If grab_extent (a function returning a radius) is given, every point within
// that radius of the click is grabbed too, and the whole group is dragged along rigidly.
// Returns { get_point_targets() } so the caller's physics step can pin and move the grabbed points.
function setup_dragging(
    canvas,
    handles_x,
    handles_y,
    handle_radius,
    positions_x,
    positions_y,
    grab_radius,
    grab_extent = null
) {
    let dragging = null; // null, or { kind: 'handle' | 'point', idx }
    let drag_offset_x = 0; // X Offset between the mouse and the dragged handle's center
    let drag_offset_y = 0; // Y Offset between the mouse and the dragged handle's center
    // The grabbed simulation points. x/y hold each point's latest raw mouse-tracked target (not
    // applied directly - the caller eases toward it across a frame's substeps; see
    // get_point_targets()). The object and its arrays are reused, so a drag allocates nothing per step.
    const grabbed = { count: 0, idx: [], x: [], y: [] };
    const rel_x = []; // Each grabbed point's offset from the mouse at the moment of the grab
    const rel_y = [];
    let rel_min_x = 0,
        rel_max_x = 0,
        rel_min_y = 0,
        rel_max_y = 0; // Extent of those offsets, to keep the whole group inside the canvas

    function radius_of(value) {
        return typeof value === 'function' ? value() : value;
    }

    function mouse_pos(event) {
        const rect = canvas.getBoundingClientRect();
        return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    }

    function find_handle(x, y) {
        for (let i = 0; i < handles_x.length; i++) {
            const distance_to_handle = (x - handles_x[i]) ** 2 + (y - handles_y[i]) ** 2;
            if (distance_to_handle <= handle_radius ** 2) return i;
        }
        return null;
    }

    // Finds whichever simulated point is nearest the cursor, within grab_radius.
    function find_point(x, y) {
        let best = null;
        let best_distance = radius_of(grab_radius) ** 2;
        for (let i = 0; i < positions_x.length; i++) {
            const distance_to_point = (x - positions_x[i]) ** 2 + (y - positions_y[i]) ** 2;
            if (distance_to_point <= best_distance) {
                best_distance = distance_to_point;
                best = i;
            }
        }
        return best;
    }

    function hit_test(event) {
        const { x, y } = mouse_pos(event);
        const handle_idx = find_handle(x, y);
        if (handle_idx !== null) return { kind: 'handle', idx: handle_idx, x, y };
        const point_idx = find_point(x, y);
        if (point_idx !== null) return { kind: 'point', idx: point_idx, x, y };
        return null;
    }

    // Collects the nearest point plus, if grab_extent is set, everything within that radius.
    function grab_points(nearest, x, y) {
        const extent_sq = grab_extent ? radius_of(grab_extent) ** 2 : -1;
        grabbed.count = 0;
        rel_min_x = rel_min_y = Infinity;
        rel_max_x = rel_max_y = -Infinity;
        for (let i = 0; i < positions_x.length; i++) {
            const distance_sq = (x - positions_x[i]) ** 2 + (y - positions_y[i]) ** 2;
            if (i !== nearest && distance_sq > extent_sq) continue;
            const n = grabbed.count++;
            grabbed.idx[n] = i;
            // Start each target at the point's current position, so there's nothing to
            // ease toward yet if animate() runs before the next mousemove arrives.
            grabbed.x[n] = positions_x[i];
            grabbed.y[n] = positions_y[i];
            rel_x[n] = positions_x[i] - x;
            rel_y[n] = positions_y[i] - y;
            rel_min_x = Math.min(rel_min_x, rel_x[n]);
            rel_max_x = Math.max(rel_max_x, rel_x[n]);
            rel_min_y = Math.min(rel_min_y, rel_y[n]);
            rel_max_y = Math.max(rel_max_y, rel_y[n]);
        }
    }

    function set_grabbing(is_grabbing) {
        canvas.classList.toggle('grabbing', is_grabbing);
    }

    function update_hover_cursor(event) {
        canvas.classList.toggle('hover-handle', hit_test(event) !== null);
    }

    canvas.addEventListener('mousedown', (event) => {
        if (event.button !== 0) return;
        const hit = hit_test(event);
        if (hit === null) return;
        set_grabbing(true);
        dragging = { kind: hit.kind, idx: hit.idx };
        if (hit.kind === 'handle') {
            drag_offset_x = hit.x - handles_x[hit.idx];
            drag_offset_y = hit.y - handles_y[hit.idx];
        } else {
            grab_points(hit.idx, hit.x, hit.y);
        }
    });

    canvas.addEventListener('mousemove', (event) => {
        if (dragging !== null) {
            const { x, y } = mouse_pos(event);
            if (dragging.kind === 'handle') {
                handles_x[dragging.idx] = Math.min(
                    Math.max(x - drag_offset_x, handle_radius),
                    canvas.width - handle_radius
                );
                handles_y[dragging.idx] = Math.min(
                    Math.max(y - drag_offset_y, handle_radius),
                    canvas.height - handle_radius
                );
            } else {
                // Record the raw targets only. The caller eases the actual simulated points
                // toward them a little each substep, instead of snapping them here directly -
                // that smooths out raw mouse/trackpad noise instead of injecting it undamped.
                // The mouse is clamped so the group as a whole stays inside the canvas.
                const mx = Math.min(Math.max(x, -rel_min_x), canvas.width - rel_max_x);
                const my = Math.min(Math.max(y, -rel_min_y), canvas.height - rel_max_y);
                for (let n = 0; n < grabbed.count; n++) {
                    grabbed.x[n] = mx + rel_x[n];
                    grabbed.y[n] = my + rel_y[n];
                }
            }
            return;
        }
        update_hover_cursor(event);
    });

    canvas.addEventListener('mouseup', (event) => {
        dragging = null;
        set_grabbing(false);
        update_hover_cursor(event);
    });

    canvas.addEventListener('mouseleave', () => {
        dragging = null;
        set_grabbing(false);
        canvas.classList.remove('hover-handle');
    });

    return {
        // The currently-grabbed points and their raw mouse targets ({ count, idx[], x[], y[] }),
        // or null if a handle is being dragged (or nothing is). The caller pins these points and
        // eases them toward their targets over a frame's substeps rather than snapping straight there.
        get_point_targets() {
            return dragging !== null && dragging.kind === 'point' ? grabbed : null;
        },
    };
}

function constrain_to_bounds(positions_x, positions_y, width, height) {
    for (let i = 0; i < positions_x.length; i++) {
        positions_x[i] = Math.min(Math.max(positions_x[i], 0), width);
        positions_y[i] = Math.min(Math.max(positions_y[i], 0), height);
    }
}

// Dampens the tangential (sliding) velocity of points touching a boundary, then clamps positions.
// Call this once per step (not per solver iteration), otherwise the damping compounds far too fast.
// `friction` is the damping per REFERENCE_DT; dt is the time this call covers.
function apply_contact_friction(
    positions_x,
    positions_y,
    last_positions_x,
    last_positions_y,
    width,
    height,
    friction,
    dt
) {
    friction = 1 - Math.pow(1 - friction, dt / REFERENCE_DT);
    for (let i = 0; i < positions_x.length; i++) {
        if (positions_y[i] < 0 || positions_y[i] > height) {
            // touching ceiling or floor: dampen horizontal sliding
            const vx = positions_x[i] - last_positions_x[i];
            last_positions_x[i] += vx * friction;
        }
        if (positions_x[i] < 0 || positions_x[i] > width) {
            // touching a wall: dampen vertical sliding
            const vy = positions_y[i] - last_positions_y[i];
            last_positions_y[i] += vy * friction;
        }
    }
    constrain_to_bounds(positions_x, positions_y, width, height);
}

const PHYSICS = {
    gravity: 1000,
    friction: 0.005, // air friction: damps each point's absolute velocity (slows everything, including bulk motion). Fraction lost per 1/60 s
    internalFriction: 2.0, // damps relative velocity between connected points only - kills whip-like waves
    // traveling along the rope/cloth without making bulk movement feel sluggish. Per REFERENCE_DT
    // the relative velocity decays by exp(-internalFriction * INTERNAL_FRICTION_SCALE).
    groundFriction: 0.3,
    grabSize: 15, // radius (px) around a click on the cloth or rope within which all points are grabbed together; 0 grabs a single point
    tearFactor: 2.5 // a constraint breaks permanently once stretched beyond this multiple of its rest length
};

function bind_slider(sliderId, outputId, initialValue, onChange) {
    const slider = document.getElementById(sliderId);
    const output = document.getElementById(outputId);
    slider.value = initialValue;
    output.textContent = initialValue;
    slider.addEventListener('input', () => {
        const value = parseFloat(slider.value);
        output.textContent = value;
        onChange(value);
    });
}

// Same as bind_slider, but the top of the range means "disabled" (Infinity), shown as "Off"
// instead of a number, so the user has an explicit way to turn tearing off entirely.
function bind_tear_slider(sliderId, outputId, initialValue, onChange) {
    const slider = document.getElementById(sliderId);
    const output = document.getElementById(outputId);
    const max = parseFloat(slider.max);

    function apply(value) {
        if (value >= max) {
            output.textContent = 'Off';
            onChange(Infinity);
        } else {
            output.textContent = value.toFixed(2);
            onChange(value);
        }
    }

    slider.value = Number.isFinite(initialValue) ? initialValue : max;
    apply(parseFloat(slider.value));
    slider.addEventListener('input', () => apply(parseFloat(slider.value)));
}

bind_slider('gravity_slider', 'gravity_value', PHYSICS.gravity, (v) => (PHYSICS.gravity = v));
bind_slider('friction_slider', 'friction_value', PHYSICS.friction, (v) => (PHYSICS.friction = v));
bind_slider(
    'internal_friction_slider',
    'internal_friction_value',
    PHYSICS.internalFriction,
    (v) => (PHYSICS.internalFriction = v)
);
bind_slider(
    'ground_friction_slider',
    'ground_friction_value',
    PHYSICS.groundFriction,
    (v) => (PHYSICS.groundFriction = v)
);
bind_slider('grab_size_slider', 'grab_size_value', PHYSICS.grabSize, (v) => (PHYSICS.grabSize = v));
bind_tear_slider(
    'tear_factor_slider',
    'tear_factor_value',
    PHYSICS.tearFactor,
    (v) => (PHYSICS.tearFactor = v)
);
