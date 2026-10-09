import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

test('local server saves content across restart, serves video ranges, and rejects unsafe writes', async (t) => {
  const project = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  const base = process.env.BIRTHDAY_TEST_TMP || path.join(project, '.test-tmp');
  await fs.mkdir(base, { recursive: true });
  const temp = await fs.mkdtemp(path.join(base, 'birthday-test-'));
  await fs.copyFile(path.join(project, 'app', 'server.mjs'), path.join(temp, 'server.mjs'));
  await fs.mkdir(path.join(temp, 'config'));
  await fs.copyFile(path.join(project, 'app', 'config', 'content.example.json'), path.join(temp, 'config', 'content.example.json'));
  await fs.mkdir(path.join(temp, 'media')); await fs.mkdir(path.join(temp, 'music'));
  await fs.writeFile(path.join(temp, 'index.html'), '<h1>birthday test</h1>');
  await fs.writeFile(path.join(temp, 'media', 'memory.jpg'), Buffer.from([1, 2, 3]));
  await fs.writeFile(path.join(temp, 'media', 'motion.mp4'), Buffer.from([0, 1, 2, 3, 4, 5, 6, 7]));
  await fs.writeFile(path.join(temp, 'music', 'dream.wav'), Buffer.from([0, 1, 2]));
  const config = { memories: Array.from({ length: 8 }, (_, i) => ({ src: i === 7 ? '/media/motion.mp4' : '/media/memory.jpg', caption: '', placeholder: false })), letter: '', music: '/music/dream.wav' };
  let child;
  t.after(async () => { if (child) { child.kill(); await new Promise((r) => child.once('exit', r)); } await fs.rm(temp, { recursive: true, force: true }); });
  async function boot() {
    child = spawn(process.execPath, ['server.mjs'], { cwd: temp, env: { ...process.env, BIRTHDAY_PORT: '18887' }, stdio: ['ignore', 'pipe', 'pipe'] });
    return await new Promise((resolve, reject) => {
      let text = ''; const timer = setTimeout(() => reject(new Error('server startup timed out')), 10000);
      child.stdout.on('data', (chunk) => { text += chunk; const match = text.match(/http:\/\/localhost:(\d+)/); if (match) { clearTimeout(timer); resolve(`http://127.0.0.1:${match[1]}`); } });
      child.once('error', reject);
    });
  }
  let url = await boot();
  let response = await fetch(url); assert.equal(response.status, 200);
  response = await fetch(`${url}/api/config`); const example = await response.json(); assert.equal(example.theme, '致xxx'); assert.equal(example.memories[0].src, '/demo/memory-01.svg');
  response = await fetch(`${url}/media/motion.mp4`, { headers: { Range: 'bytes=2-5' } });
  assert.equal(response.status, 206); assert.equal(response.headers.get('content-type'), 'video/mp4'); assert.equal(response.headers.get('content-range'), 'bytes 2-5/8'); assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [2, 3, 4, 5]);
  response = await fetch(`${url}/media/motion.mp4`, { headers: { Range: 'bytes=99-' } }); assert.equal(response.status, 416);
  config.memories = [config.memories[7], config.memories[0]];
  config.subtitles = { welcomeDescription: '第一行\n第二行', blessingCakeTitle: '', finaleInstruction: '<em>仅显示文字</em>' };
  config.theme = '示例主题'; config.letter = '致xxx：\n\n生日快乐。';
  response = await fetch(`${url}/api/config`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(config) }); assert.equal(response.status, 200);
  response = await fetch(`${url}/api/config`, { method: 'POST', headers: { Origin: 'https://example.com', 'Content-Type': 'application/json' }, body: JSON.stringify(config) }); assert.equal(response.status, 403);
  response = await fetch(`${url}/api/config`, { method: 'POST', body: JSON.stringify({ ...config, memories: config.memories.map((m) => ({ ...m, src: '/../secret.jpg' })) }) }); assert.equal(response.status, 400);
  response = await fetch(`${url}/api/assets?kind=static`, { method: 'POST', headers: { 'Content-Type': 'text/html' }, body: '<script>bad</script>' }); assert.equal(response.status, 400);
  response = await fetch(`${url}/server.mjs`); assert.equal(response.status, 403);
  response = await fetch(`${url}/config/content.example.json`); assert.equal(response.status, 403);
  for (const memories of [[], Array.from({ length: 51 }, () => config.memories[0]), [null], [{ src: '/media/script.js' }]]) {
    response = await fetch(`${url}/api/config`, { method: 'POST', body: JSON.stringify({ ...config, memories }) }); assert.equal(response.status, 400);
  }
  child.kill(); await new Promise((r) => child.once('exit', r)); child = undefined;
  url = await boot();
  response = await fetch(`${url}/api/config`); const saved = await response.json(); assert.equal(saved.letter, config.letter); assert.equal(saved.theme, config.theme);
  assert.deepEqual(saved.memories, config.memories); assert.deepEqual(saved.subtitles, config.subtitles);
  for (const count of [1, 9, 50]) {
    const memories = Array.from({ length: count }, (_, i) => config.memories[i % 2]);
    response = await fetch(`${url}/api/config`, { method: 'POST', body: JSON.stringify({ ...config, memories }) }); assert.equal(response.status, 200);
    response = await fetch(`${url}/api/config`); assert.equal((await response.json()).memories.length, count);
  }
});
