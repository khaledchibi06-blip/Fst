// يصوّر الإعلان إطاراً بإطار ويحوّله إلى فيديو MP4
// الاستعمال: node video/render.js <ملف_الموسيقى.wav> <ملف_الإخراج.mp4>
const path = require('node:path');
const { spawn } = require('node:child_process');
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');

const FPS = 30;
const DURATION = 22;
const [music, output] = process.argv.slice(2);

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1080, height: 1920 } });
  await page.goto('file://' + path.join(__dirname, 'ad.html'));
  await page.waitForTimeout(500);

  const ff = spawn('ffmpeg', [
    '-y', '-loglevel', 'error',
    '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-',
    ...(music ? ['-i', music] : []),
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-profile:v', 'high',
    ...(music ? ['-c:a', 'aac', '-b:a', '192k', '-shortest'] : []),
    '-movflags', '+faststart', output,
  ], { stdio: ['pipe', 'inherit', 'inherit'] });

  const total = FPS * DURATION;
  for (let i = 0; i < total; i++) {
    await page.evaluate((t) => window.seek(t), i / FPS);
    const jpg = await page.screenshot({ type: 'jpeg', quality: 95 });
    if (!ff.stdin.write(jpg)) await new Promise((r) => ff.stdin.once('drain', r));
    if (i % 60 === 0) process.stdout.write(`\r${Math.round((i / total) * 100)}%`);
  }
  ff.stdin.end();
  await new Promise((r, j) => ff.on('close', (c) => (c === 0 ? r() : j(new Error('ffmpeg ' + c)))));
  await browser.close();
  console.log('\rتم: ' + output);
})();
