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