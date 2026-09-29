function main_cycle_if_visible(canvas, draw, animate)
{
    let animationFrameId;
    let lastTime = NaN
    const ctx = canvas.getContext('2d');

    function cycle()
    {
        var time = performance.now() / 1000;
        var dt = lastTime ? Math.min(time - lastTime, 1/20) : 0;
        lastTime = time;
        if(dt > 0)
            animate(dt);
        draw(ctx, canvas);
        animationFrameId = requestAnimationFrame(cycle);
    }
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                if(!animationFrameId)
                    cycle();
            } else if (animationFrameId) { // Stop animation if canvas is not visible
                cancelAnimationFrame(animationFrameId);
                animationFrameId = null;
            }
        });
    });

    // Observe the canvas element
    observer.observe(canvas);
}


// Lets the user drag the named handles (handles_x/y, always pinned), or grab any other
// simulated point (positions_x/y) and drag it while the mouse is held, releasing it back
// into the simulation on mouseup. Named handles take priority when both overlap a click.
// Returns { is_point_pinned(i) } so the caller's physics step can skip a point currently
// being live-dragged, the same way it already skips the named handles.
function setup_dragging(canvas, handles_x, handles_y, handle_radius, positions_x, positions_y, grab_radius)
{
    let dragging = null; // null, or { kind: 'handle' | 'point', idx }
    let drag_offset_x = 0; // X Offset between the mouse and the dragged point's center
    let drag_offset_y = 0; // Y Offset between the mouse and the dragged point's center

    function mouse_pos(event) {
        const rect = canvas.getBoundingClientRect();
        return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    }

    function find_handle(x, y) {
        for(let i = 0; i < handles_x.length; i++) {
            const distance_to_handle = (x - handles_x[i]) ** 2 + (y - handles_y[i]) ** 2;
            if(distance_to_handle <= handle_radius**2)
                return i;
        }
        return null;
    }

    // Finds whichever simulated point is nearest the cursor, within grab_radius.
    function find_point(x, y) {
        let best = null;
        let best_distance = grab_radius ** 2;
        for(let i = 0; i < positions_x.length; i++) {
            const distance_to_point = (x - positions_x[i]) ** 2 + (y - positions_y[i]) ** 2;
            if(distance_to_point <= best_distance) {
                best_distance = distance_to_point;
                best = i;
            }
        }
        return best;
    }

    function hit_test(event) {
        const { x, y } = mouse_pos(event);
        const handle_idx = find_handle(x, y);
        if(handle_idx !== null)
            return { kind: 'handle', idx: handle_idx, x, y };
        const point_idx = find_point(x, y);
        if(point_idx !== null)
            return { kind: 'point', idx: point_idx, x, y };
        return null;
    }

    function set_grabbing(is_grabbing) {
        canvas.classList.toggle('grabbing', is_grabbing);
    }

    function update_hover_cursor(event) {
        canvas.classList.toggle('hover-handle', hit_test(event) !== null);
    }

    canvas.addEventListener('mousedown', (event) => {
        if(event.button !== 0)
            return;
        const hit = hit_test(event);
        if(hit === null)
            return;
        set_grabbing(true);
        dragging = { kind: hit.kind, idx: hit.idx };
        const center_x = hit.kind === 'handle' ? handles_x[hit.idx] : positions_x[hit.idx];
        const center_y = hit.kind === 'handle' ? handles_y[hit.idx] : positions_y[hit.idx];
        drag_offset_x = hit.x - center_x;
        drag_offset_y = hit.y - center_y;
    });

    canvas.addEventListener('mousemove', (event) => {
        if (dragging !== null) {
            const { x, y } = mouse_pos(event);
            if(dragging.kind === 'handle') {
                handles_x[dragging.idx] = Math.min(Math.max(x - drag_offset_x, handle_radius), canvas.width - handle_radius);
                handles_y[dragging.idx] = Math.min(Math.max(y - drag_offset_y, handle_radius), canvas.height - handle_radius);
            } else {
                positions_x[dragging.idx] = Math.min(Math.max(x - drag_offset_x, 0), canvas.width);
                positions_y[dragging.idx] = Math.min(Math.max(y - drag_offset_y, 0), canvas.height);
            }
            return;
        }
        update_hover_cursor(event);
    });

    canvas.addEventListener('mouseup', event => {
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
        is_point_pinned(i) {
            return dragging !== null && dragging.kind === 'point' && dragging.idx === i;
        }
    };
}

function constrain_to_bounds(positions_x, positions_y, width, height) {
    for (let i = 0; i < positions_x.length; i++) {
        positions_x[i] = Math.min(Math.max(positions_x[i], 0), width);
        positions_y[i] = Math.min(Math.max(positions_y[i], 0), height);
    }
}

// Dampens the tangential (sliding) velocity of points touching a boundary, then clamps positions.
// Call this once per frame (not per solver iteration), otherwise the damping compounds far too fast.
function apply_contact_friction(positions_x, positions_y, last_positions_x, last_positions_y, width, height, friction) {
    for (let i = 0; i < positions_x.length; i++) {
        if (positions_y[i] < 0 || positions_y[i] > height) { // touching ceiling or floor: dampen horizontal sliding
            const vx = positions_x[i] - last_positions_x[i];
            last_positions_x[i] += vx * friction;
        }
        if (positions_x[i] < 0 || positions_x[i] > width) { // touching a wall: dampen vertical sliding
            const vy = positions_y[i] - last_positions_y[i];
            last_positions_y[i] += vy * friction;
        }
    }
    constrain_to_bounds(positions_x, positions_y, width, height);
}

const PHYSICS = {
    gravity: 1000,
    friction: 0.005,
    groundFriction: 0.3,
    tearFactor: 1.8, // a constraint breaks permanently once stretched beyond this multiple of its rest length
}

function bind_slider(sliderId, outputId, initialValue, onChange) {
    const slider = document.getElementById(sliderId);
    const output = document.getElementById(outputId);
    slider.value = initialValue
    output.textContent = initialValue
    slider.addEventListener('input', () => {
        const value = parseFloat(slider.value);
        output.textContent = value;
        onChange(value);
    });
}

bind_slider('gravity_slider', 'gravity_value', PHYSICS.gravity, v => PHYSICS.gravity = v);
bind_slider('friction_slider', 'friction_value', PHYSICS.friction, v => PHYSICS.friction = v);
bind_slider('ground_friction_slider', 'ground_friction_value', PHYSICS.groundFriction, v => PHYSICS.groundFriction = v);