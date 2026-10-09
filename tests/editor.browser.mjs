import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const project = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const scratch = path.join(project, '.test-tmp');
await fs.mkdir(scratch, { recursive: true });
const temp = await fs.mkdtemp(path.join(scratch, 'editor-'));
let server, context;
try {
  for (const name of ['index.html', 'favicon.svg', 'server.mjs', 'src', 'styles', 'config', 'demo', 'music']) {
    await fs.cp(path.join(project, 'app', name), path.join(temp, name), { recursive: true });
  }
  server = spawn(process.execPath, ['server.mjs'], { cwd: temp, env: { ...process.env, BIRTHDAY_PORT: '19887' }, stdio: ['ignore', 'pipe', 'pipe'] });
  const url = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Startup timed out')), 10000);
    server.once('error', reject);
    server.stdout.on('data', data => { const match = String(data).match(/http:\/\/localhost:\d+/); if (match) { clearTimeout(timer); resolve(match[0]); } });
  });
  context = await chromium.launchPersistentContext(path.join(temp, 'browser-profile'), { channel: 'msedge', headless: true, viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => { if (response.status() >= 400) errors.push(response.status() + ' ' + response.url()); });
  await page.goto(url);
  await page.waitForFunction(() => !document.getElementById('start').disabled);
  await page.click('#settings');
  await page.screenshot({ path: path.join(scratch, 'editor-text.png') });
  const labels = await page.locator('[data-subtitle-key]').count();
  assert.ok(labels >= 40, 'All presentation text fields should be editable');
  await page.fill('#theme-input', '致测试对象');
  await page.fill('#greeting-input', '新的开场');
  await page.fill('#finale-input', '新的祝福');
  await page.fill('#finale-message-input', '第一行\n第二行');
  await page.evaluate(() => {
    for (const input of document.querySelectorAll('[data-subtitle-key]')) {
      input.value = input.dataset.subtitleKey === 'blessingCakeTitle' ? '' : '已编辑：' + input.dataset.subtitleKey;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
    const description = document.querySelector('[data-subtitle-key="welcomeDescription"]');
    description.value = '<b>纯文字</b>\n第二行'; description.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.click('[data-editor-tab="memories"]');
  await page.click('#clear-memories');
  await page.click('#save-content');
  assert.equal(await page.locator('#setup-dialog').evaluate(e => e.open), true, 'Empty album cannot be saved');
  const images = await page.evaluate(() => {
    const make = (w,h,color) => { const c=document.createElement('canvas'); c.width=w;c.height=h;const ctx=c.getContext('2d');ctx.fillStyle=color;ctx.fillRect(0,0,w,h);return c.toDataURL('image/png').split(',')[1]; };
    return [make(120,200,'#ba8e88'),make(240,120,'#8db3aa')];
  });
  const webm = await page.evaluate(async () => {
    const c=document.createElement('canvas');c.width=160;c.height=100;
    const ctx=c.getContext('2d'), stream=c.captureStream(10);
    const recorder=new MediaRecorder(stream,{mimeType:'video/webm'}), chunks=[];
    recorder.ondataavailable=e=>chunks.push(e.data);
    const done=new Promise(resolve=>recorder.onstop=resolve);recorder.start();
    for(let i=0;i<10;i++){ctx.fillStyle=i%2?'#ddc89e':'#8db3aa';ctx.fillRect(0,0,160,100);await new Promise(r=>setTimeout(r,100));}
    recorder.stop();await done;stream.getTracks().forEach(t=>t.stop());
    return Array.from(new Uint8Array(await new Blob(chunks).arrayBuffer()));
  });
  const payloads=[
    {name:'01-portrait.png',mimeType:'image/png',buffer:Buffer.from(images[0],'base64')},
    {name:'02-motion.webm',mimeType:'video/webm',buffer:Buffer.from(webm)},
    {name:'03-landscape.png',mimeType:'image/png',buffer:Buffer.from(images[1],'base64')}
  ];
  await page.setInputFiles('#memory-files', payloads);
  await page.waitForFunction(() => !document.body.classList.contains('saving'));
  assert.equal(await page.locator('.asset-row').count(),3);
  await page.locator('.asset-row').nth(0).locator('.asset-details input').fill('竖版回忆');
  await page.locator('.asset-row').nth(2).locator('.move-button').first().click();
  // A photo slot can be replaced by a video, and a video slot by a photo.
  await page.locator('.asset-row').nth(1).locator('input[type=file]').setInputFiles(payloads[1]);
  await page.waitForFunction(() => !document.body.classList.contains('saving'));
  await page.locator('.asset-row').nth(2).locator('input[type=file]').setInputFiles(payloads[2]);
  await page.waitForFunction(() => !document.body.classList.contains('saving'));
  await page.screenshot({ path: path.join(scratch, 'editor-media.png') });
  await page.click('[data-editor-tab="letter"]');
  await page.fill('#letter-input', '测试信件\n\n保留段落。');
  await page.click('#save-content');
  await page.waitForFunction(() => !document.getElementById('setup-dialog').open);
  let config = await (await fetch(url+'/api/config')).json();
  assert.equal(config.memories.length,3); assert.match(config.memories[1].src,/webm$/);
  assert.equal(config.memories[0].caption,'竖版回忆');assert.equal(config.letter,'测试信件\n\n保留段落。');
  assert.equal(Object.keys(config.subtitles).length,labels);
  await page.reload();
  await page.waitForFunction(() => !document.getElementById('start').disabled);
  assert.equal(await page.title(),'致测试对象');
  assert.equal(await page.locator('[data-subtitle="welcomeDescription"]').textContent(),'<b>纯文字</b>\n第二行');
  assert.equal(await page.locator('[data-subtitle="welcomeDescription"] b').count(),0);
  await page.click('#settings');await page.fill('#theme-input','取消这次修改');await page.click('#cancel-edit');assert.equal(await page.title(),'致测试对象');
  await page.click('#demo');
  const settled = async (stage) => {
    await page.waitForFunction(stage => document.getElementById(stage).classList.contains('active') && !document.getElementById('next').disabled,stage);
  };
  await settled('tutorial');await page.click('#next');await settled('blessing');
  assert.equal(await page.locator('#blessing-title').textContent(),'');
  await page.click('#next');await settled('blessing');
  assert.equal(await page.locator('#blessing-title').textContent(),'已编辑：blessingBouquetTitle');
  await page.click('#next');await settled('memories');
  await page.waitForFunction(() => document.getElementById('photo-card').classList.contains('portrait'));
  assert.match(await page.locator('#memory-number').textContent(),/01\s*\/ 03/);
  await page.click('#next');await settled('memories');
  await page.waitForFunction(() => !document.getElementById('photo-card').classList.contains('portrait'));
  // Observe an actual ended -> play interval, including the intentional 1.5s gap.
  const pause = await page.evaluate(() => new Promise(resolve => {
    const video=document.querySelector('.memory-layer.is-visible video');
    video.addEventListener('ended',()=>{const ended=performance.now();video.addEventListener('play',()=>resolve(performance.now()-ended),{once:true});},{once:true});
  }));
  assert.ok(pause >= 1450, 'Video loops should pause for 1.5 seconds');
  await page.click('#next');await settled('memories');
  await page.click('#settings');await page.click('[data-editor-tab="memories"]');
  await page.locator('.asset-row').last().locator('.remove-button').click();
  await page.locator('.asset-row').last().locator('.remove-button').click();
  await page.click('#save-content');await page.waitForFunction(() => !document.getElementById('setup-dialog').open);
  assert.match(await page.locator('#memory-number').textContent(),/01\s*\/ 01/);
  assert.equal(await page.locator('#memory-ring span').count(),1);
  await page.click('#next');await settled('envelope');await page.click('#previous');await settled('memories');
  await page.click('#next');await settled('envelope');await page.click('#next');await settled('letter');
  assert.match(await page.locator('#letter-body').textContent(),/保留段落/);
  await page.click('#next');await page.waitForFunction(() => document.getElementById('finale').classList.contains('active'));
  assert.equal(await page.locator('#finale-title').textContent(),'新的祝福');
  assert.equal(await page.locator('#finale-photos .finale-photo').count(),1);
  assert.equal(await page.locator('#finale-message').textContent(),'第一行\n第二行');
  assert.deepEqual(errors,[]);
  console.log('Browser editor, mixed media, save/reload/cancel, portrait frames, video loop and full sequence: passed');
} finally {
  await context?.close();
  if (server && server.exitCode === null) { const exited=new Promise(r=>server.once('exit',r));server.kill();await exited; }
  await fs.rm(temp,{recursive:true,force:true,maxRetries:3,retryDelay:200});
}
