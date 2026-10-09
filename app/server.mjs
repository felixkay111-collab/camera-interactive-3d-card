import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promises as fs, createReadStream } from 'node:fs';
import { randomUUID } from 'node:crypto';

const root = path.dirname(fileURLToPath(import.meta.url));
const dataFile = path.join(root, 'content.json');
const exampleFile = path.join(root, 'config', 'content.example.json');
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif', '.mp4': 'video/mp4', '.webm': 'video/webm', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.ogg': 'audio/ogg', '.wasm': 'application/wasm', '.task': 'application/octet-stream' };
const mimeExt = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif', 'video/mp4': '.mp4', 'video/webm': '.webm', 'audio/mpeg': '.mp3', 'audio/wav': '.wav', 'audio/x-wav': '.wav', 'audio/mp4': '.m4a', 'audio/ogg': '.ogg' };
let configWrite = Promise.resolve();

async function readConfig() {
  try { return JSON.parse(await fs.readFile(dataFile, 'utf8')); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return JSON.parse(await fs.readFile(exampleFile, 'utf8'));
  }
}

function send(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}
async function body(req, limit) {
  const chunks = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > limit) throw Object.assign(new Error('文件太大，请选择较小的文件。'), { status: 413 }); chunks.push(chunk); }
  return Buffer.concat(chunks);
}
function sameOrigin(req) {
  const origin = req.headers.origin;
  return !origin || origin === `http://${req.headers.host}`;
}
function validateConfig(input) {
  if (!input || typeof input !== 'object' || !Array.isArray(input.memories) || input.memories.length < 1 || input.memories.length > 50) throw new Error('回忆数量需要在 1 到 50 项之间。');
  const memories = input.memories.map((m) => {
    if (!m || typeof m.src !== 'string' || !/^\/(?:media|demo)\/[a-zA-Z0-9_.-]+\.(?:jpg|jpeg|png|webp|gif|mp4|webm|svg)$/.test(m.src)) throw new Error('回忆素材路径无效。');
    return { src: m.src, caption: String(m.caption || '').slice(0, 200), placeholder: m.placeholder === true };
  });
  if (input.music !== '/music/dream.wav' && !/^\/media\/[a-zA-Z0-9_.-]+\.(mp3|wav|m4a|ogg)$/.test(input.music || '')) throw new Error('音乐路径无效。');
  const subtitles = {};
  if (input.subtitles && typeof input.subtitles === 'object' && !Array.isArray(input.subtitles)) {
    for (const [key, value] of Object.entries(input.subtitles)) {
      if (/^[a-zA-Z][a-zA-Z0-9]*$/.test(key) && typeof value === 'string') subtitles[key] = value.slice(0, 500);
    }
  }
  return { theme: String(input.theme ?? '致xxx').slice(0, 100), greeting: String(input.greeting ?? '致xxx').slice(0, 100), finale: String(input.finale ?? '生日快乐').slice(0, 100), finaleMessage: String(input.finaleMessage ?? '').slice(0, 1000), subtitles, memories, letter: String(input.letter || '').slice(0, 30000), music: input.music, letterPlaceholder: input.letterPlaceholder === true, motionMissing: input.motionMissing === true };
}

const server = http.createServer(async (req, res) => {
  try {
    if (!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(req.headers.host || '')) return send(res, 403, { error: '只允许本机访问。' });
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/')) {
      if (!sameOrigin(req)) return send(res, 403, { error: '只允许本地网页修改素材。' });
      if (url.pathname === '/api/config' && req.method === 'GET') return send(res, 200, await readConfig());
      if (url.pathname === '/api/config' && req.method === 'POST') {
        const config = validateConfig(JSON.parse((await body(req, 500000)).toString('utf8')));
        for (const m of config.memories) await fs.access(path.join(root, m.src));
        await fs.access(path.join(root, config.music));
        configWrite = configWrite.catch(() => {}).then(async () => {
          const temp = `${dataFile}.${randomUUID()}.tmp`;
          await fs.writeFile(temp, JSON.stringify(config, null, 2), 'utf8');
          await fs.rename(temp, dataFile);
        });
        await configWrite;
        return send(res, 200, { ok: true });
      }
      if (url.pathname === '/api/assets' && req.method === 'POST') {
        const kind = url.searchParams.get('kind');
        const mime = (req.headers['content-type'] || '').split(';')[0];
        const ext = mimeExt[mime];
        const supported = kind === 'static' ? ['.jpg', '.png', '.webp'] : kind === 'motion' ? ['.gif', '.mp4', '.webm'] : kind === 'music' ? ['.mp3', '.wav', '.m4a', '.ogg'] : [];
        if (!ext || !supported.includes(ext)) return send(res, 400, { error: '格式不支持。照片使用 JPG、PNG、WebP，动态回忆使用 GIF、MP4 或 WebM。' });
        const bytes = await body(req, kind === 'music' || kind === 'motion' ? 60 * 1024 * 1024 : 35 * 1024 * 1024);
        if (!bytes.length) return send(res, 400, { error: '文件为空。' });
        const name = `${randomUUID()}${ext}`;
        await fs.writeFile(path.join(root, 'media', name), bytes);
        return send(res, 200, { src: `/media/${name}` });
      }
      return send(res, 404, { error: '接口不存在。' });
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: '不支持的请求。' });
    let decoded;
    try { decoded = decodeURIComponent(url.pathname); } catch { return send(res, 400, { error: '路径无效。' }); }
    const relative = decoded === '/' ? 'index.html' : decoded.replace(/^\/+/, '');
    const resolved = path.resolve(root, relative);
    const publicPath = path.relative(root, resolved).replaceAll('\\', '/');
    const isPublic = ['index.html', 'favicon.svg'].includes(publicPath) || /^(?:src|styles|demo|music|vendor|media)\//.test(publicPath);
    if (!resolved.startsWith(root + path.sep) || !isPublic || publicPath.split('/').some(part => part.startsWith('.'))) return send(res, 403, { error: '路径不可访问。' });
    const stat = await fs.stat(resolved);
    if (!stat.isFile()) return send(res, 404, { error: '文件不存在。' });
    const headers = { 'Content-Type': types[path.extname(resolved).toLowerCase()] || 'application/octet-stream', 'Cache-Control': relative.startsWith('vendor/') ? 'public, max-age=86400' : 'no-cache', 'X-Content-Type-Options': 'nosniff' };
    let start = 0, end = stat.size - 1, status = 200;
    if (req.headers.range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
      if (!match || (!match[1] && !match[2])) { res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` }); return res.end(); }
      start = match[1] ? Number(match[1]) : Math.max(0, stat.size - Number(match[2]));
      end = match[1] && match[2] ? Math.min(Number(match[2]), stat.size - 1) : stat.size - 1;
      if (start > end || start >= stat.size) { res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` }); return res.end(); }
      status = 206; headers['Content-Range'] = `bytes ${start}-${end}/${stat.size}`;
    }
    headers['Content-Length'] = end - start + 1; headers['Accept-Ranges'] = 'bytes';
    res.writeHead(status, headers);
    if (req.method === 'HEAD') return res.end();
    createReadStream(resolved, { start, end }).on('error', () => res.destroy()).pipe(res);
  } catch (error) {
    if (res.headersSent) return res.destroy();
    send(res, error.status || (error.code === 'ENOENT' ? 404 : 400), { error: error.code === 'ENOENT' ? '文件不存在。' : error.message });
  }
});

await fs.mkdir(path.join(root, 'media'), { recursive: true });
const preferred = Number(process.env.BIRTHDAY_PORT) || 8787;
let activePort = preferred;
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE' && activePort < preferred + 10) server.listen(++activePort, '127.0.0.1');
  else { console.error(err.message); process.exitCode = 1; }
});
server.once('listening', () => {
    console.log(`\n摄像头交互式3D贺卡 · 致xxx\nhttp://localhost:${activePort}\n保持此窗口打开；按 Ctrl+C 停止。\n`);
    if (process.argv.includes('--open')) import('node:child_process').then(({ spawn }) => {
      if (process.platform === 'win32') spawn('cmd.exe', ['/d', '/c', 'start', '', `http://localhost:${activePort}`], { windowsHide: true, stdio: 'ignore' });
    });
});
server.listen(activePort, '127.0.0.1');
