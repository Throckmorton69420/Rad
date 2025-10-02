// utils/glassEffectGenerator.ts

// Helper function to draw a rounded rectangle path
function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

/**
 * Generates data URLs for displacement and specular highlight maps
 * to create a realistic liquid glass effect.
 */
export const generateGlassMaps = ({
  width = 512,
  height = 512,
  borderRadius = 36,
  bezelWidth = 50,
  refractionStrength = 70,
  highlightStrength = 0.9,
}: {
  width?: number;
  height?: number;
  borderRadius?: number;
  bezelWidth?: number;
  refractionStrength?: number;
  highlightStrength?: number;
}): { displacement: string; highlight: string } => {
  // --- 1. Generate Displacement Map ---
  const dispCanvas = document.createElement('canvas');
  dispCanvas.width = width;
  dispCanvas.height = height;
  const dispCtx = dispCanvas.getContext('2d');

  if (!dispCtx) return { displacement: '', highlight: '' };

  const imageData = dispCtx.createImageData(width, height);
  const data = imageData.data;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let distToBezel = -1;
      let normalX = 0;
      let normalY = 0;

      // Simplified distance and normal calculation for a rounded rectangle
      const dx = Math.max(0, Math.abs(x - width / 2) - (width / 2 - borderRadius));
      const dy = Math.max(0, Math.abs(y - height / 2) - (height / 2 - borderRadius));
      const distToCenterRect = Math.sqrt(dx * dx + dy * dy) - borderRadius;
      
      if (distToCenterRect < 0) { // Inside the main shape
        const d_left = x;
        const d_right = width - x;
        const d_top = y;
        const d_bottom = height - y;

        distToBezel = Math.min(d_left, d_right, d_top, d_bottom);

        // A better approximation for corners
        if (x < borderRadius && y < borderRadius) distToBezel = borderRadius - Math.sqrt((borderRadius - x)**2 + (borderRadius - y)**2);
        else if (x > width - borderRadius && y < borderRadius) distToBezel = borderRadius - Math.sqrt((x - (width-borderRadius))**2 + (borderRadius-y)**2);
        else if (x < borderRadius && y > height - borderRadius) distToBezel = borderRadius - Math.sqrt((borderRadius - x)**2 + (y - (height-borderRadius))**2);
        else if (x > width - borderRadius && y > height - borderRadius) distToBezel = borderRadius - Math.sqrt((x-(width-borderRadius))**2 + (y-(height-borderRadius))**2);

        // Get normal vector (points from center outward)
        const vecX = x - width / 2;
        const vecY = y - height / 2;
        const len = Math.sqrt(vecX*vecX + vecY*vecY);
        if (len > 0) {
            normalX = vecX / len;
            normalY = vecY / len;
        }
      }

      const index = (y * width + x) * 4;
      if (distToBezel >= 0 && distToBezel <= bezelWidth) {
        const normalizedDist = 1 - (distToBezel / bezelWidth);
        // Using a stronger power curve concentrates the effect near the edge.
        const magnitude = Math.pow(normalizedDist, 2.5) * refractionStrength;
        
        data[index] = 128 - normalX * magnitude; // Red channel for X displacement
        data[index + 1] = 128 - normalY * magnitude; // Green channel for Y displacement
        data[index + 2] = 128; // Blue channel (unused)
        data[index + 3] = 255; // Alpha
      } else {
        data[index] = 128;
        data[index + 1] = 128;
        data[index + 2] = 128;
        data[index + 3] = 255;
      }
    }
  }
  dispCtx.putImageData(imageData, 0, 0);
  const displacement = dispCanvas.toDataURL();

  // --- 2. Generate Specular Highlight Map ---
  const highCanvas = document.createElement('canvas');
  highCanvas.width = width;
  highCanvas.height = height;
  const highCtx = highCanvas.getContext('2d');

  if (!highCtx) return { displacement, highlight: '' };

  highCtx.fillStyle = 'black';
  highCtx.fillRect(0, 0, width, height);
  
  // Create a blurred, stroked path for the highlight
  highCtx.save();
  roundedRect(highCtx, 2, 2, width - 4, height - 4, borderRadius - 2);
  highCtx.strokeStyle = `rgba(255, 255, 255, ${highlightStrength})`;
  highCtx.lineWidth = 2.5;
  highCtx.filter = 'blur(5px)';
  highCtx.stroke();
  highCtx.restore();

  // Create a sharper inner line
  highCtx.save();
  roundedRect(highCtx, 1.5, 1.5, width - 3, height - 3, borderRadius - 1.5);
  highCtx.strokeStyle = `rgba(255, 255, 255, ${highlightStrength * 0.6})`;
  highCtx.lineWidth = 1;
  highCtx.filter = 'blur(2px)';
  highCtx.stroke();
  highCtx.restore();

  // Mask the highlight to a top-down gradient
  highCtx.globalCompositeOperation = 'destination-in';
  const gradient = highCtx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, `rgba(255, 255, 255, 1)`);
  gradient.addColorStop(0.4, `rgba(255, 255, 255, 0)`);
  highCtx.fillStyle = gradient;
  highCtx.fillRect(0, 0, width, height);

  const highlight = highCanvas.toDataURL();

  return { displacement, highlight };
};