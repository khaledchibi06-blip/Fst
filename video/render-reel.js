// يركّب طبقة reel.html (شفافة) فوق فيديو الورشة ويضيف الموسيقى
// الاستعمال: node video/render-reel.js <الفيديو_الأساسي.mp4> <الموسيقى.wav> <الإخراج.mp4>
const path = require('node:path');
const { spawn } = require('node:child_process');
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');

const FPS = 30;
const DURATION = 40;
const [base, music, output] = process.argv.slice(2);

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1080, height: 1920 } });
  await page.goto('file://' + path.join(__dirname, 'reel.html'));
  await page.waitForTimeout(500);

  const ff = spawn('ffmpeg', [
    '-y', '-loglevel', 'error',
    '-i', base,
    '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'png', '-i', '-',
    '-i', music,
    '-filter_complex', '[0:v][1:v]overlay=format=auto,format=yuv420p[v];[2:a]volume=0.75[a]',
    '-map', '[v]', '-map', '[a]',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '19', '-profile:v', 'high',
    '-c:a', 'aac', '-b:a', '192k', '-t', String(DURATION), '-movflags', '+faststart', output,
  ], { stdio: ['pipe', 'inherit', 'inherit'] });

  const total = FPS * DURATION;
  for (let i = 0; i < total; i++) {
    await page.evaluate((t) => window.seek(t), i / FPS);
    const png = await page.screenshot({ type: 'png', omitBackground: true });
    if (!ff.stdin.write(png)) await new Promise((r) => ff.stdin.once('drain', r));
    if (i % 90 === 0) process.stdout.write(`\r${Math.round((i / total) * 100)}%`);
  }
  ff.stdin.end();
  await new Promise((r, j) => ff.on('close', (c) => (c === 0 ? r() : j(new Error('ffmpeg ' + c)))));
  await browser.close();
  console.log('\rتم: ' + output);
})();
