const { app, nativeImage } = require('electron');

function makeIcon() {
  const width = 64;
  const height = 64;
  const radius = 14;
  const pixels = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const nearestX = Math.min(x, width - 1 - x);
      const nearestY = Math.min(y, height - 1 - y);
      const cornerX = Math.max(0, radius - nearestX);
      const cornerY = Math.max(0, radius - nearestY);
      const inside = cornerX * cornerX + cornerY * cornerY <= radius * radius;
      const offset = (y * width + x) * 4;
      const shade = Math.round(52 - (30 * (x + y)) / (width + height - 2));
      pixels[offset] = shade;
      pixels[offset + 1] = shade;
      pixels[offset + 2] = shade;
      pixels[offset + 3] = inside ? 255 : 0;
    }
  }
  return nativeImage.createFromBitmap(pixels, { width, height, scaleFactor: 1 });
}

app.whenReady().then(() => {
  const icon = makeIcon();
  const size = icon.getSize();
  const result = { empty: icon.isEmpty(), width: size.width, height: size.height };
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exitCode = result.empty || size.width !== 64 || size.height !== 64 ? 1 : 0;
  app.quit();
});
