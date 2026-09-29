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


function setup_handle_dragging(canvas, handles_x, handles_y, handle_radius)
{
    let isDragging = null; // Is the handle being dragged currently, if so, which one?
    let drag_offset_x = 0; // X Offset between the mouse and the handle's center
    let drag_offset_y = 0; // Y Offset between the mouse and the handle's center

    function is_in_handle(event) {
        const rect = canvas.getBoundingClientRect();
        const mouseX = event.clientX - rect.left;
        const mouseY = event.clientY - rect.top;

        // Check if the click is within a handle's radius
        for(let i = 0; i < handles_x.length; i++) {
            const distance_to_handle = (mouseX - handles_x[i]) ** 2 + (mouseY - handles_y[i]) ** 2;
            if(distance_to_handle <= handle_radius**2) {
                return {
                    idx : i,
                    drag_offset_x: mouseX - handles_x[i],
                    drag_offset_y: mouseY - handles_y[i],
                }
            }
        }
        return null
    }

    function set_grabbing(is_grabbing) {
        canvas.classList.toggle('grabbing', is_grabbing);
    }

    function update_hover_cursor(event) {
        canvas.classList.toggle('hover-handle', is_in_handle(event) !== null);
    }

    canvas.addEventListener('mousedown', (event) => {
        if(event.button !== 0)
            return;
        const grab_data = is_in_handle(event);
        if(grab_data === null)
            return;
        set_grabbing(true);
        isDragging = grab_data.idx;
        drag_offset_x = grab_data.drag_offset_x;
        drag_offset_y = grab_data.drag_offset_y;
    });

    canvas.addEventListener('mousemove', (event) => {
        if (isDragging !== null) {
            const rect = canvas.getBoundingClientRect();
            handles_x[isDragging] = event.clientX - rect.left - drag_offset_x;
            handles_y[isDragging] = event.clientY - rect.top - drag_offset_y;
            return;
        }
        update_hover_cursor(event);
    });

    canvas.addEventListener('mouseup', event => {
        isDragging = null;
        set_grabbing(false);
        update_hover_cursor(event);
    });

    canvas.addEventListener('mouseleave', () => {
        isDragging = null;
        set_grabbing(false);
        canvas.classList.remove('hover-handle');
    });
}