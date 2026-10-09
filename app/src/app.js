import { copyFields, normalizeContent } from './copy-fields.js';
import { GestureGate, handMetrics, paginateLetter, nextState } from './interaction.js';
import { makeBlessingShape } from './blessing-shapes.js';

const $ = (id) => document.getElementById(id);
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const screens = [...document.querySelectorAll('.screen')];
let config, draft, loaded = false, locked = false, importing = false;
let photoTransitioning = false;
let state = { stage: 'welcome', index: 0, page: 0, blessingStep: 0 };
let pages = [''], cameraState = 'off', handTracked = false, stream, detector, detectorPromise;
let cameraGeneration = 0, cameraTimer, lastVideoTime = -1, lastDetectTime = 0;
const gate = new GestureGate();
const hand = { x: .5, y: .5, targetX: .5, targetY: .5, active: false, open: false };
const music = $('music');
const isVideo = (src) => /\.(mp4|webm)$/i.test(src);
const mediaSizes = new Map();
function rememberSize(src, media) {
  const width = media.videoWidth || media.naturalWidth, height = media.videoHeight || media.naturalHeight;
  if (width && height) mediaSizes.set(src, { width, height });
}
function syncMemoryFrame(src) {
  if (state.stage === 'memories' && config.memories[state.index]?.src === src) {
    const size = mediaSizes.get(src);
    $('photo-card').classList.toggle('portrait', !!size && size.height > size.width);
  }
}
let musicMuted = false, volume = .45, fadeFrame, started = false;
let resizeTimer, toastTimer;
let videoReplayTimer = null;
const motionPause = 1500;
let activeMemoryLayer = 0;
let memoryBridgeTimer = null;
const memoryBridgeDuration = 2400;
const memoryBridgeRevealDelay = 1300;

function startMemoryBridge(direction = 'left') {
  const bridge = $('memory-bridge');
  if (!bridge) return;
  clearTimeout(memoryBridgeTimer);
  bridge.dataset.direction = direction;
  bridge.classList.remove('active');
  // Restart the CSS timeline even if a fast replay reaches this transition twice.
  void bridge.offsetWidth;
  bridge.classList.add('active');
  memoryBridgeTimer = setTimeout(stopMemoryBridge, memoryBridgeDuration);
}
function stopMemoryBridge() {
  clearTimeout(memoryBridgeTimer);
  memoryBridgeTimer = null;
  $('memory-bridge')?.classList.remove('active');
}

function toast(message, duration = 4500) {
  $('toast').textContent = message; $('toast').classList.add('visible');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').classList.remove('visible'), duration);
}
function formatCopy(text) {
  return text.replaceAll('{count}', String(config.memories.length)).replaceAll('{ready}', String(config.memories.filter(m => !m.placeholder).length));
}
function applyPersonalization() {
  const theme = config?.theme ?? '致xxx';
  const greeting = config?.greeting ?? theme;
  document.querySelector('.brand').setAttribute('aria-label', theme + '首页');
  document.title = theme;
  $('page-title') && ($('page-title').textContent = theme);
  $('brand-title') && ($('brand-title').firstChild.textContent = theme);
  if ($('welcome-title')) {
    const title = $('welcome-title'); title.replaceChildren(document.createTextNode(greeting));
    const star = document.createElement('span'); star.className = 'title-star'; star.textContent = '✧'; title.append(star);
  }

  if ($('finale-title')) {
    const title = document.createElement('em'); title.textContent = config?.finale ?? '生日快乐';
    $('finale-title').replaceChildren(title);
  }
  $('finale-message') && ($('finale-message').textContent = config?.finaleMessage || '');
  for (const element of document.querySelectorAll('[data-subtitle]')) {
    const value = config?.subtitles?.[element.dataset.subtitle];
    if (typeof value === 'string') element.textContent = formatCopy(value);
  }
}
function musicalLevel() { return musicMuted ? 0 : volume * (state.stage === 'letter' ? .43 : .72); }
function fadeMusic(duration = 1500) {
  cancelAnimationFrame(fadeFrame);
  const from = music.volume, to = musicalLevel(), start = performance.now();
  const frame = (now) => { const t = Math.min(1, (now - start) / duration); music.volume = from + (to - from) * t; if (t < 1) fadeFrame = requestAnimationFrame(frame); };
  fadeFrame = requestAnimationFrame(frame);
  $('music-toggle').textContent = musicMuted ? '♪̸' : '♫';
  $('music-toggle').setAttribute('aria-label', musicMuted ? '开启音乐' : '关闭音乐');
  $('music-toggle').setAttribute('aria-pressed', String(!musicMuted));
}
function playMusic(restart = false) {
  if (restart) music.currentTime = 0;
  music.volume = 0;
  music.play().then(() => fadeMusic(2500)).catch(() => toast('音乐暂未播放，点一下右上角的音乐按钮即可。'));
}
function resetGesture() { gate.reset(); $('hold-fill').style.width = '0%'; }
function instructions() {
  const blessingStep = state.blessingStep ?? 0;
  const blessingMessages = ['比一个 OK 手势，再松开 · 召唤星光花束', '比一个 OK 手势，再松开 · 翻开第一段回忆'];
  const subtitles = config?.subtitles || {};
  const message = { welcome: '', tutorial: subtitles.tutorialInstruction ?? '比一个 OK 手势，再松开 · 召唤星光蛋糕', blessing: [subtitles.blessingBouquetInstruction ?? blessingMessages[0], subtitles.blessingMemoryInstruction ?? blessingMessages[1]][Math.min(1, blessingStep)], memories: state.index === config?.memories?.length - 1 ? subtitles.memoryLastInstruction ?? '比一个 OK 手势，再松开 · 看看还有什么惊喜' : subtitles.memoryInstruction ?? '比一个 OK 手势，再松开 · 翻到下一段回忆', envelope: subtitles.envelopeInstruction ?? '张开手掌，停留一秒 · 打开信', letter: state.page + 1 < pages.length ? subtitles.letterInstruction ?? '比一个 OK 手势，再松开 · 继续读信' : subtitles.letterLastInstruction ?? '比一个 OK 手势，再松开 · 收下最后的祝福', finale: subtitles.finaleInstruction ?? '这份爱，一直都在' }[state.stage];
  if (state.stage === 'blessing') {
    const titles = [config?.subtitles?.blessingCakeTitle ?? '属于你的电子蛋糕', config?.subtitles?.blessingBouquetTitle ?? '属于你的电子花束'];
    const descriptions = [config?.subtitles?.blessingCakeDescription ?? '握起手掌，星光聚成蛋糕；张开手掌，星光散开。\n左右移动手掌，转动这份祝福。', config?.subtitles?.blessingBouquetDescription ?? '握起手掌，星光聚成花束；张开手掌，星光散开。\n左右移动手掌，看看花瓣和缎带。'];
    $('blessing-title').textContent = titles[Math.min(1, blessingStep)];
    $('blessing-description').textContent = descriptions[Math.min(1, blessingStep)];
  }
  $('instruction').textContent = cameraState === 'starting' ? subtitles.cameraStarting ?? '正在准备摄像头 · 也可点击右箭头' : cameraState === 'ready' && !handTracked && state.stage !== 'finale' ? subtitles.noHand ?? '伸出一只手，让星光找到你' : message;
  $('interaction-bar').hidden = state.stage === 'welcome';
  $('previous').disabled = (state.stage === 'tutorial' || (state.stage === 'blessing' && blessingStep === 0)) || locked;
  $('next').disabled = state.stage === 'finale' || locked;
  $('camera-light').classList.toggle('tracked', handTracked);
}
function memoryLayer(layerIndex) {
  return document.querySelector(`.memory-layer[data-layer="${layerIndex}"]`);
}
function createMemoryLayer(layerIndex) {
  const layer = document.createElement('div');
  layer.className = 'memory-layer';
  layer.dataset.layer = String(layerIndex);
  const image = document.createElement('img');
  image.alt = '家庭回忆照片';
  image.draggable = false;
  const player = document.createElement('video');
  player.muted = true;
  player.playsInline = true;
  player.preload = 'auto';
  player.setAttribute('aria-label', '动态家庭回忆');
  layer.append(image, player);
  $('memory-stage').append(layer);
  return layer;
}
function prepareMemoryLayer(layerIndex, memory, playVideo = false) {
  const layer = memoryLayer(layerIndex);
  if (!layer) return;
  layer.dataset.src = memory.src;
  const image = layer.querySelector('img');
  const player = layer.querySelector('video');
  const video = isVideo(memory.src);
  const onSize = () => { rememberSize(memory.src, video ? player : image); syncMemoryFrame(memory.src); };
  image.onload = onSize; player.onloadedmetadata = onSize;
  image.hidden = video;
  player.hidden = !video;
  player.pause();
  player.onended = null;
  if (video) {
    player.loop = false;
    player.src = memory.src;
    player.currentTime = 0;
    player.onended = () => {
      clearTimeout(videoReplayTimer);
      videoReplayTimer = setTimeout(() => {
        if (state.stage === 'memories' && activeMemoryLayer === layerIndex && isVideo(config.memories[state.index].src)) {
          player.currentTime = 0;
          player.play().catch(() => {});
        }
      }, motionPause);
    };
    if (playVideo) player.play().catch(() => toast('视频暂未播放，点击下一页仍能继续。'));
  } else {
    image.src = memory.src;
    image.alt = memory.caption || `第${state.index + 1}段家庭回忆`;
    if (image.complete) onSize();
  }
}
function renderMemory() {
  const memory = config.memories[state.index];
  clearTimeout(videoReplayTimer);
  syncMemoryFrame(memory.src);
  const currentLayer = memoryLayer(activeMemoryLayer);
  if (!currentLayer || currentLayer.dataset.src !== memory.src) {
    currentLayer?.remove();
    createMemoryLayer(activeMemoryLayer);
  }
  prepareMemoryLayer(activeMemoryLayer, memory, true);
  document.querySelectorAll('.memory-layer').forEach((layer) => layer.classList.toggle('is-visible', layer.dataset.layer === String(activeMemoryLayer)));
  $('memory-caption').textContent = memory.caption;
  $('sample-label').hidden = !memory.placeholder;
  $('memory-number').replaceChildren(document.createTextNode(String(state.index + 1).padStart(2, '0') + ' '));
  const total = document.createElement('span'); total.textContent = `/ ${String(config.memories.length).padStart(2, '0')}`; $('memory-number').append(total);
  $('memory-dots').replaceChildren(...config.memories.map((_, i) => {
    const dot = document.createElement('span'); dot.className = `memory-dot ${i <= state.index ? 'seen' : ''} ${i === state.index ? 'current' : ''}`;
    dot.setAttribute('aria-label', `第${i + 1}段${i === state.index ? '，当前' : ''}`); return dot;
  }));
}
function layoutLetter() {
  const element = $('letter-body'), style = getComputedStyle(element);
  const canvas = document.createElement('canvas'), context = canvas.getContext('2d');
  context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
  const spacing = parseFloat(style.letterSpacing) || 0;
  pages = paginateLetter(config.letter || '', Math.max(100, element.clientWidth - 4), Math.max(90, element.clientHeight - 3), (text) => context.measureText(text).width + [...text].length * spacing, parseFloat(style.lineHeight));
  state.page = Math.min(state.page, pages.length - 1);
  renderLetter();
}
function renderLetter() {
  $('letter-body').textContent = pages[state.page];
  $('letter-page').textContent = `${String(state.page + 1).padStart(2, '0')} / ${String(pages.length).padStart(2, '0')}`;
  instructions();
}
function renderFinale() {
  // A small representative collage keeps long albums and multiple videos light.
  const count = Math.min(12, config.memories.length);
  const selected = Array.from({ length: count }, (_, i) => config.memories[Math.floor(i * config.memories.length / count)]);
  $('finale-photos').replaceChildren(...selected.map((memory, i) => {
    const frame = document.createElement('div'); frame.className = 'finale-photo'; frame.style.animationDelay = `${.15 + i * .12}s`;
    const side = i % 2, row = Math.floor(i / 2), rows = Math.ceil(count / 2);
    Object.assign(frame.style, { left: side ? '84%' : '2%', right: 'auto', top: `${rows === 1 ? 40 : row * 82 / (rows - 1)}%`, bottom: 'auto', width: rows > 4 ? '8vw' : '12vw', height: rows > 4 ? '9vh' : '14vh', transform: `rotate(${side ? 7 : -7}deg)` });
    const image = isVideo(memory.src) ? document.createElement('video') : new Image(); image.src = memory.src;
    if (isVideo(memory.src)) { image.muted = true; image.playsInline = true; image.preload = 'metadata'; image.onloadedmetadata = () => { image.currentTime = 0; }; } else image.alt = '';
    frame.append(image); return frame;
  }));
  fireworkNext = performance.now() + 600;
}
async function switchScene(next, animation = true) {
  if (locked) return;
  locked = true; instructions();
  const old = $(state.stage), photoTurn = state.stage === 'memories' && next.stage === 'memories';
  const bridgeTransition = animation && state.stage === 'blessing' && next.stage === 'memories';
  if (animation && photoTurn) {
    photoTransitioning = true;
    hand.active = false; hand.open = false;
    handTracked = false;
    gate.reset();
    $('hand-cursor').hidden = true;
    const card = $('photo-card');
    const direction = next.index > state.index ? 'left' : 'right';
    const outgoingLayer = memoryLayer(activeMemoryLayer);
    const incomingLayerIndex = 1 - activeMemoryLayer;
    // Never recycle a hidden layer. Reusing it can make the browser restore
    // the previous decoded frame while the card is in the intentional gap.
    memoryLayer(incomingLayerIndex)?.remove();
    const incomingLayer = createMemoryLayer(incomingLayerIndex);
    clearTimeout(videoReplayTimer);
    prepareMemoryLayer(incomingLayerIndex, config.memories[next.index], false);
    incomingLayer.classList.remove('is-visible', 'memory-layer-arriving', 'memory-layer-slide-away');
    outgoingLayer.classList.remove('memory-layer-arriving');
    outgoingLayer.dataset.direction = direction;
    incomingLayer.dataset.direction = direction;
    outgoingLayer.classList.add('memory-layer-slide-away');
    card.dataset.direction = direction;
    // Keep the existing transition timing; only the recycled-card flash is
    // suppressed below.
    await wait(900);
    // Hide the card before removing the outgoing node. This prevents the old
    // decoded frame from flashing during the intentional dark pause.
    card.classList.add('transition-gap');
    outgoingLayer.remove();
    activeMemoryLayer = incomingLayerIndex;
  } else if (bridgeTransition) {
    startMemoryBridge('left');
    // Keep the first photo in its compositor layer at zero opacity while the
    // independent bridge forms. This avoids a visibility pop when it arrives.
    $('photo-card').classList.add('transition-gap', 'memory-bridge-card');
    old.classList.add('leaving');
    await wait(650);
  } else if (animation && state.stage === 'envelope' && next.stage === 'letter') {
    document.querySelector('.envelope-scene').classList.add('opening');
    await wait(1300);
    old.classList.add('leaving'); await wait(600);
  } else if (animation) { old.classList.add('leaving'); await wait(600); }
  document.querySelectorAll('.memory-layer video').forEach((video) => video.pause());
  clearTimeout(videoReplayTimer);
  $('finale-photos').querySelectorAll('video').forEach((video) => video.pause());
  state = { ...next };
  resetGesture();
  for (const screen of screens) screen.classList.remove('active', 'leaving');
  $(state.stage).classList.add('active');
  if (state.stage === 'blessing') resizeBlessingCanvas();
  $('photo-card').classList.remove('slide-away', 'arriving');
  $('photo-card').removeAttribute('data-direction');
  $('photo-card').style.transform = '';
  if (state.stage === 'memories') {
    renderMemory();
    // Let the new source attach while the card is still hidden, then reveal it
    // on the next compositor frame.
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const incomingLayer = memoryLayer(activeMemoryLayer);
    if (bridgeTransition) {
      // Hold the card until the frame is fully formed, then let the photo
      // enter during the last part of the bridge for a connected handoff.
      await wait(memoryBridgeRevealDelay);
      const card = $('photo-card');
      card.classList.remove('transition-gap', 'memory-bridge-card');
      card.classList.add('memory-bridge-reveal');
      setTimeout(() => card.classList.remove('memory-bridge-reveal'), 900);
      incomingLayer.classList.add('memory-layer-arriving');
      setTimeout(() => incomingLayer.classList.remove('memory-layer-arriving'), 720);
      const bridgeTail = Math.max(0, memoryBridgeDuration - 650 - memoryBridgeRevealDelay);
      await wait(bridgeTail);
      stopMemoryBridge();
    } else {
      $('photo-card').classList.remove('transition-gap');
      incomingLayer.classList.add('memory-layer-arriving');
      setTimeout(() => incomingLayer.classList.remove('memory-layer-arriving'), 720);
    }
    setTimeout(() => { photoTransitioning = false; instructions(); }, 720);
  } else {
    stopMemoryBridge();
    $('photo-card').classList.remove('transition-gap');
    photoTransitioning = false;
  }
  if (state.stage === 'envelope') document.querySelector('.envelope-scene').classList.remove('opening');
  if (state.stage === 'letter') { layoutLetter(); requestAnimationFrame(layoutLetter); }
  if (state.stage === 'finale') renderFinale();
  if (state.stage !== 'welcome') fadeMusic();
  await wait(180); locked = false; instructions();
}
function next() {
  if (locked || $('setup-dialog').open || state.stage === 'welcome' || state.stage === 'finale') return;
  switchScene(nextState(state, config.memories.length, pages.length));
}
function previous() {
  if (locked || $('setup-dialog').open) return;
  if (state.stage === 'memories') switchScene(state.index ? { ...state, index: state.index - 1 } : { ...state, stage: 'tutorial' });
  else if (state.stage === 'blessing') switchScene(state.blessingStep ? { ...state, blessingStep: state.blessingStep - 1 } : { ...state, stage: 'tutorial' });
  else if (state.stage === 'envelope') switchScene({ ...state, stage: 'memories', index: config.memories.length - 1 });
  else if (state.stage === 'letter') switchScene(state.page ? { ...state, page: state.page - 1 } : { ...state, stage: 'envelope' });
  else if (state.stage === 'finale') switchScene({ ...state, stage: 'letter', page: pages.length - 1 });
}
async function start(withCamera) {
  if (!loaded || locked) return;
  started = true;
  playMusic(true);
  if (withCamera && !document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => {});
  await switchScene({ stage: 'tutorial', index: 0, page: 0, blessingStep: 0 });
  if (config.memories.some((m) => m.placeholder) || config.letterPlaceholder) toast('当前含演示内容，正式展示前请在“准备回忆”中换成你的素材。', 7000);
  else if (config.motionMissing) toast('有动态素材暂时使用静态画面；替换为 GIF 或浏览器兼容视频即可恢复动态。', 6500);
  if (withCamera) enableCamera();
  else { stopCamera(); cameraState = 'off'; instructions(); }
}

async function loadDetector() {
  if (detector) return detector;
  if (!detectorPromise) {
    detectorPromise = (async () => {
      const { FilesetResolver, HandLandmarker } = await import('/vendor/vision_bundle.mjs');
      const files = await FilesetResolver.forVisionTasks('/vendor/wasm');
      const options = { baseOptions: { modelAssetPath: '/vendor/hand_landmarker.task', delegate: 'GPU' }, runningMode: 'VIDEO', numHands: 1, minHandDetectionConfidence: .55, minHandPresenceConfidence: .55, minTrackingConfidence: .5 };
      try { return await HandLandmarker.createFromOptions(files, options); }
      catch { options.baseOptions.delegate = 'CPU'; return await HandLandmarker.createFromOptions(files, options); }
    })().then((model) => detector = model).catch((error) => { detectorPromise = null; throw error; });
  }
  return detectorPromise;
}
function stopCamera() {
  cameraGeneration++;
  clearTimeout(cameraTimer);
  stream?.getTracks().forEach((track) => track.stop()); stream = null;
  $('camera').srcObject = null; cameraState = 'off';
  handTracked = false; hand.active = false; hand.open = false; $('hand-cursor').hidden = true; resetGesture();
}
async function enableCamera() {
  stopCamera();
  const generation = cameraGeneration;
  cameraState = 'starting'; instructions();
  try {
    // Warm the local model while the browser is asking for permission.
    const modelReady = loadDetector(); modelReady.catch(() => {});
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('请通过启动脚本打开本地网页。');
    let permissionTimer;
    const permission = navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 24, max: 30 }, facingMode: 'user' }, audio: false });
    permission.then((lateStream) => { if (generation !== cameraGeneration) lateStream.getTracks().forEach((track) => track.stop()); }).catch(() => {});
    const nextStream = await Promise.race([permission, new Promise((_, reject) => { permissionTimer = setTimeout(() => reject(Object.assign(new Error('等待摄像头授权超时'), { name: 'PermissionTimeout' })), 25000); })]).finally(() => clearTimeout(permissionTimer));
    if (generation !== cameraGeneration) { nextStream.getTracks().forEach((t) => t.stop()); return; }
    stream = nextStream; $('camera').srcObject = stream; await $('camera').play();
    let modelTimer;
    await Promise.race([modelReady, new Promise((_, reject) => { modelTimer = setTimeout(() => reject(new Error('手势模型加载超时')), 45000); })]).finally(() => clearTimeout(modelTimer));
    if (generation !== cameraGeneration) return;
    cameraState = 'ready'; lastVideoTime = -1; resetGesture(); instructions();
    toast('摄像头已准备好 · 把一只手放在画面前，先张开，再比一个 OK 手势。');
    const track = stream.getVideoTracks()[0];
    track.addEventListener('ended', () => { if (generation === cameraGeneration) cameraFailed('摄像头已断开，仍可用箭头或按钮继续。'); });
    track.addEventListener('mute', () => { if (generation === cameraGeneration) { handTracked = false; hand.active = false; hand.open = false; resetGesture(); instructions(); } });
    cameraTimer = setTimeout(() => detectFrame(generation), 0);
  } catch (error) {
    if (generation !== cameraGeneration) return;
    const messages = { PermissionTimeout: '尚未取得摄像头授权。可继续用按钮；在 Edge / Chrome 中允许摄像头，再按 C 重试。', NotAllowedError: '摄像头权限未开启。可用按钮继续；需要手势时，在地址栏允许摄像头，再按 C 重试。', NotFoundError: '没有找到摄像头。接上 USB 摄像头后按 C 重试，或用按钮继续。', NotReadableError: '摄像头可能正被其他程序使用。关闭占用程序后按 C 重试。' };
    cameraFailed(messages[error.name] || '手势识别暂时无法启动，可用按钮或键盘继续；按 C 重试摄像头。');
    console.warn('Camera/hand tracking:', error);
  }
}
function cameraFailed(message) { stopCamera(); cameraState = 'failed'; instructions(); toast(message, 9000); }
function detectFrame(generation) {
  if (generation !== cameraGeneration || cameraState !== 'ready') return;
  // MediaPipe inference is synchronous. During a slide, let the compositor finish
  // the transition instead of competing with it on the main thread.
  if (locked) {
    cameraTimer = setTimeout(() => detectFrame(generation), 220);
    return;
  }
  const now = performance.now(), video = $('camera');
  try {
    if (video.readyState >= 2 && video.currentTime !== lastVideoTime && now - lastDetectTime > 90) {
      lastVideoTime = video.currentTime; lastDetectTime = now;
      const result = detector.detectForVideo(video, now);
      const points = result.landmarks?.[0];
      if (points) {
        const m = handMetrics(points);
        handTracked = true; hand.active = true; hand.open = m.open;
        hand.targetX = Math.max(.05, Math.min(.95, (m.x - .1) / .8));
        hand.targetY = Math.max(.08, Math.min(.92, (m.y - .12) / .76));
        $('hand-cursor').hidden = state.stage === 'welcome' || $('setup-dialog').open;
        $('hand-cursor').classList.toggle('pinched', m.ok);
        if (!$('setup-dialog').open) {
          const event = gate.update({ ...m, tracked: true, now, pinch: m.ok, fist: m.fist });
          if (state.stage === 'envelope') { $('hold-fill').style.width = `${event.progress * 100}%`; if (event.progress >= 1) next(); }
          else if (event.pinch) next();
        } else resetGesture();
      } else {
        handTracked = false; hand.active = false; $('hand-cursor').hidden = true;
        gate.update({ tracked: false, now }); $('hold-fill').style.width = '0%';
      }
      instructions();
    }
  } catch (error) { console.warn('Hand detection:', error); cameraFailed('手势识别中断了，照片会停在这里。可用按钮继续，或按 C 重试。'); return; }
  cameraTimer = setTimeout(() => detectFrame(generation), 45);
}

// The only animated background is this local canvas. All assets and tracking stay local.
const canvas = $('sky'), ctx = canvas.getContext('2d');
let cw = innerWidth, ch = innerHeight, stars = [], particles = [], trails = [], fireworkNext = Infinity, lastFrame = performance.now();
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const blessingCanvas = $('blessing-canvas'), blessingCtx = blessingCanvas.getContext('2d');
let blessingW = 0, blessingH = 0, blessingParticles = [], blessingShapeStep = -1;
let blessingYaw = .22, blessingPitch = .3;
const starSprites = new Map();
function resizeCanvas() {
  cw = innerWidth; ch = innerHeight;
  const ratio = Math.min(devicePixelRatio || 1, 1.7);
  canvas.width = Math.round(cw * ratio); canvas.height = Math.round(ch * ratio);
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  stars = Array.from({ length: Math.min(145, Math.round(cw * ch / 9000)) }, () => ({ x: Math.random() * cw, y: Math.random() * ch, r: .45 + Math.random() * 1.2, phase: Math.random() * Math.PI * 2, speed: .3 + Math.random() * .5 }));
}
function resizeBlessingCanvas() {
  const rect = blessingCanvas.getBoundingClientRect(), ratio = Math.min(devicePixelRatio || 1, 1.7);
  blessingW = Math.max(1, rect.width); blessingH = Math.max(1, rect.height);
  blessingCanvas.width = Math.round(blessingW * ratio); blessingCanvas.height = Math.round(blessingH * ratio);
  blessingCtx.setTransform(ratio, 0, 0, ratio, 0, 0);
}
function syncBlessingShape(step) {
  if (step === blessingShapeStep) return;
  const shape = makeBlessingShape(step === 0 ? 'cake' : 'bouquet');
  if (!blessingParticles.length) {
    blessingParticles = shape.map((target) => ({ ...target, x: (Math.random() - .5) * 1.6, y: (Math.random() - .5) * 1.3, z: (Math.random() - .5) * .7, tx: target.x, ty: target.y, tz: target.z, sx: (Math.random() - .5) * 2.7, sy: (Math.random() - .5) * 2.2, sz: (Math.random() - .5) * 1.3 }));
  } else {
    blessingParticles.forEach((particle, index) => Object.assign(particle, { tx: shape[index].x, ty: shape[index].y, tz: shape[index].z, color: shape[index].color, size: shape[index].size, sx: (Math.random() - .5) * 2.7, sy: (Math.random() - .5) * 2.2, sz: (Math.random() - .5) * 1.3 }));
  }
  blessingShapeStep = step;
}
function drawStarParticle(context, x, y, radius, color, alpha) {
  // Cache each colored star and glow: thousands of live shadowBlur operations
  // would compete with the camera recognizer for the frame budget.
  let sprite = starSprites.get(color);
  if (!sprite) {
    sprite = document.createElement('canvas'); sprite.width = sprite.height = 48;
    const s = sprite.getContext('2d');
    s.fillStyle = color; s.shadowColor = color; s.shadowBlur = 6;
    s.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = -Math.PI / 2 + i * Math.PI / 4, r = i % 2 ? 2.3 : 7;
      const px = 24 + Math.cos(a) * r, py = 24 + Math.sin(a) * r;
      i ? s.lineTo(px, py) : s.moveTo(px, py);
    }
    s.closePath(); s.fill(); starSprites.set(color, sprite);
  }
  // Keep the star's visible core large enough to read like the reference
  // cake's cream and fruit particles while retaining its pointed silhouette.
  const size = radius * 48 / 7 * 2.35;
  context.globalAlpha = alpha;
  context.drawImage(sprite, x - size / 2, y - size / 2, size, size);
}
function drawBlessing(now, dt) {
  blessingCtx.clearRect(0, 0, blessingW, blessingH);
  if (state.stage !== 'blessing') return;
  const step = Math.min(1, state.blessingStep ?? 0); syncBlessingShape(step);
  const particleMode = cameraState !== 'ready' ? 'gather' : handTracked ? (hand.open ? 'scatter' : 'gather') : 'hold';
  // Mirrored hand position covers a broad arc, with a little top view so the
  // cake surfaces and layered rose petals are visible even at the center.
  if (cameraState !== 'ready' || handTracked) {
    const turn = Math.max(-1, Math.min(1, (hand.x - .5) / .32));
    const smooth = reducedMotion ? 1 : 1 - Math.exp(-dt * 5);
    blessingYaw += (.22 + turn * 1.31 - blessingYaw) * smooth;
    blessingPitch += (.3 + (hand.y - .5) * .7 - blessingPitch) * smooth;
  }
  const cosY = Math.cos(blessingYaw), sinY = Math.sin(blessingYaw);
  const unitX = Math.min(blessingW * .64, blessingH * .96);
  const unitY = Math.min(blessingW * .48, blessingH * .68);
  const projected = [];
  for (const particle of blessingParticles) {
    const blend = reducedMotion ? 1 : Math.min(1, dt * 4.4);
    if (particleMode !== 'hold') {
      const targetX = particleMode === 'scatter' ? particle.sx + (hand.x - .5) * .45 : particle.tx;
      const targetY = particleMode === 'scatter' ? particle.sy + (hand.y - .5) * .35 : particle.ty;
      const targetZ = particleMode === 'scatter' ? particle.sz : particle.tz;
      particle.x += (targetX - particle.x) * blend; particle.y += (targetY - particle.y) * blend; particle.z += (targetZ - particle.z) * blend;
    }
    const x1 = particle.x * cosY - particle.z * sinY, z1 = particle.x * sinY + particle.z * cosY;
    const y1 = particle.y * Math.cos(blessingPitch) - z1 * Math.sin(blessingPitch), z2 = particle.y * Math.sin(blessingPitch) + z1 * Math.cos(blessingPitch);
    const perspective = 1 / (1 - z2 * .27), x = blessingW / 2 + x1 * unitX * perspective, y = blessingH * .55 + y1 * unitY * perspective;
    projected.push({ x, y, z: z2, radius: particle.size * perspective * Math.max(.7, unitX / 180), color: particle.color, phase: particle.phase });
  }
  projected.sort((a, b) => a.z - b.z);
  for (const particle of projected) {
    const depth = Math.max(.38, Math.min(.94, .64 + particle.z * .32));
    drawStarParticle(blessingCtx, particle.x, particle.y, Math.max(.65, particle.radius), particle.color, depth * (.86 + .14 * Math.sin(now * .0007 + particle.phase)));
  }
  blessingCtx.globalAlpha = 1;
}
function shootingStar(x, y, tx, ty) { trails.push({ x: x * cw, y: y * ch, tx: tx * cw, ty: ty * ch, born: performance.now() }); }
function burst(now) {
  const x = (.12 + Math.random() * .76) * cw, y = (.15 + Math.random() * .45) * ch;
  for (let i = 0; i < (reducedMotion ? 0 : 38); i++) {
    const angle = (i / 38) * Math.PI * 2, speed = 22 + Math.random() * 33;
    particles.push({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, life: 1, decay: .18 + Math.random() * .15, r: .8 + Math.random() * .6 });
  }
  fireworkNext = now + 2600 + Math.random() * 1900;
}
function draw(now) {
  const dt = Math.min(.05, (now - lastFrame) / 1000); lastFrame = now;
  ctx.clearRect(0, 0, cw, ch);
  hand.x += (hand.targetX - hand.x) * .13; hand.y += (hand.targetY - hand.y) * .13;
  const hx = hand.x * cw, hy = hand.y * ch;
  for (const s of stars) {
    let x = s.x, y = s.y;
    if (hand.active && !reducedMotion) {
      const dx = hx - x, dy = hy - y, dist = Math.hypot(dx, dy);
      if (dist < 240) { const attraction = .12 * (1 - dist / 240); x += dx * attraction; y += dy * attraction; }
    }
    const opacity = .18 + .32 * (.5 + .5 * Math.sin(now * .00028 * s.speed + s.phase));
    ctx.fillStyle = `rgba(231,207,166,${opacity})`; ctx.beginPath(); ctx.arc(x, y, s.r, 0, Math.PI * 2); ctx.fill();
  }
  if (hand.active && !$('setup-dialog').open && state.stage !== 'welcome') {
    $('hand-cursor').style.transform = `translate(${hx}px,${hy}px)`;
    const glow = ctx.createRadialGradient(hx, hy, 0, hx, hy, 110);
    glow.addColorStop(0, 'rgba(239,209,161,.10)'); glow.addColorStop(1, 'rgba(239,209,161,0)');
    ctx.fillStyle = glow; ctx.fillRect(hx - 110, hy - 110, 220, 220);
    if (state.stage === 'memories' && !locked && !photoTransitioning && !$('photo-card').classList.contains('arriving') && !reducedMotion) $('photo-card').style.transform = `rotateX(${(hand.y - .5) * -6}deg) rotateY(${(hand.x - .5) * 8}deg)`;
  }
  trails = trails.filter((s) => {
    const t = Math.min(1, (now - s.born) / 850), x = s.x + (s.tx - s.x) * t, y = s.y + (s.ty - s.y) * t;
    ctx.strokeStyle = `rgba(244,215,167,${(1 - t) * .8})`; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x - 45, y + 20); ctx.lineTo(x, y); ctx.stroke();
    ctx.fillStyle = `rgba(250,227,187,${1 - t})`; ctx.beginPath(); ctx.arc(x, y, 2.5, 0, 7); ctx.fill(); return t < 1;
  });
  if (state.stage === 'finale' && now > fireworkNext && !document.hidden) burst(now);
  particles = particles.filter((p) => {
    p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 9 * dt; p.life -= p.decay * dt;
    if (p.life <= 0) return false;
    ctx.fillStyle = `rgba(232,195,133,${p.life * .75})`; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill(); return true;
  });
  drawBlessing(now, dt);
  requestAnimationFrame(draw);
}
resizeCanvas(); resizeBlessingCanvas(); requestAnimationFrame(draw);
window.addEventListener('resize', () => { resizeCanvas(); resizeBlessingCanvas(); clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { if (state.stage === 'letter') layoutLetter(); }, 200); });
window.addEventListener('pagehide', () => { stopCamera(); music.pause(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) { hand.active = false; handTracked = false; hand.open = false; resetGesture(); $('hand-cursor').hidden = true; } });


function renderCopyEditor() {
  $('theme-input').value = draft.theme || '';
  $('greeting-input').value = draft.greeting || '';
  $('finale-input').value = draft.finale || '';
  $('finale-message-input').value = draft.finaleMessage || '';
  const groups = [...new Set(copyFields.map(([group]) => group))];
  $('subtitle-editor').replaceChildren(...groups.map((group, groupIndex) => {
    const section = document.createElement('details'); section.open = groupIndex === 0;
    const summary = document.createElement('summary'); summary.textContent = group; section.append(summary);
    const grid = document.createElement('div'); grid.className = 'copy-grid';
    for (const [, key, label] of copyFields.filter(([name]) => name === group)) {
      const field = document.createElement('label'); field.textContent = label;
      const input = document.createElement('textarea'); input.rows = 2; input.maxLength = 500;
      input.value = draft.subtitles[key]; input.dataset.subtitleKey = key;
      input.addEventListener('input', () => draft.subtitles[key] = input.value);
      field.append(input); grid.append(field);
    }
    section.append(grid); return section;
  }));
}
function renderAssetPreview(memory, index) {
  const preview = /\.(mp4|webm)$/i.test(memory.src) ? document.createElement('video') : new Image();
  preview.src = memory.src;
  if (preview.tagName === 'VIDEO') { preview.muted = true; preview.playsInline = true; preview.preload = 'metadata'; preview.addEventListener('loadedmetadata', () => { rememberSize(memory.src, preview); preview.currentTime = .05; }, { once: true }); }
  else { preview.alt = `回忆${index + 1}预览`; preview.onload = () => rememberSize(memory.src, preview); }
  return preview;
}
function renderAssets() {
  $('asset-count').textContent = draft.memories.length ? `共 ${draft.memories.length} 段回忆 · 保存后按此顺序播放` : '列表为空，请添加照片、视频或演示回忆。';
  $('asset-list').replaceChildren(...draft.memories.map((memory, i) => {
    const row = document.createElement('div'); row.className = 'asset-row';
    const number = document.createElement('span'); number.className = 'asset-order'; number.textContent = String(i + 1).padStart(2, '0');
    const preview = renderAssetPreview(memory, i);
    const details = document.createElement('div'); details.className = 'asset-details';
    const type = document.createElement('small'); type.textContent = /\.(mp4|webm)$/i.test(memory.src) ? '视频' : /\.gif$/i.test(memory.src) ? 'GIF' : '照片';
    const caption = document.createElement('input'); caption.value = memory.caption || ''; caption.maxLength = 200; caption.placeholder = memory.placeholder ? '演示素材 · 点击替换' : '字幕 / 回忆说明（可留空）'; caption.setAttribute('aria-label', `第${i + 1}段说明`); caption.addEventListener('input', () => memory.caption = caption.value);
    details.append(type, caption);
    const replace = document.createElement('label'); replace.className = 'mini-file-button'; replace.textContent = '替换';
    const picker = document.createElement('input'); picker.type = 'file'; picker.accept = 'image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm'; picker.hidden = true; picker.addEventListener('change', () => {
      const file = picker.files[0]; picker.value = ''; if (!file) return;
      importingFiles(async () => { await validateMemoryFile(file); memory.src = await upload(file, memoryFileKind(file)); memory.placeholder = false; renderAssets(); });
    }); replace.append(picker);
    const controls = document.createElement('div'); controls.className = 'asset-controls';
    for (const [label, direction] of [['↑', -1], ['↓', 1]]) { const button = document.createElement('button'); button.className = 'move-button'; button.type = 'button'; button.textContent = label; button.disabled = i + direction < 0 || i + direction >= draft.memories.length; button.setAttribute('aria-label', `${label === '↑' ? '上移' : '下移'}回忆${i + 1}`); button.addEventListener('click', () => { [draft.memories[i], draft.memories[i + direction]] = [draft.memories[i + direction], draft.memories[i]]; renderAssets(); }); controls.append(button); }
    const remove = document.createElement('button'); remove.className = 'remove-button'; remove.type = 'button'; remove.textContent = '删除'; remove.addEventListener('click', () => { draft.memories.splice(i, 1); renderAssets(); }); controls.append(remove);
    row.append(number, preview, details, replace, controls); return row;
  }));
}
function openSetup() {
  if (!loaded || importing || locked) return;
  draft = structuredClone(config);
  draft.subtitles ||= {};
  renderCopyEditor();
  $('letter-input').value = config.letterPlaceholder ? '' : config.letter;
  $('save-status').textContent = '素材仅保存在这台电脑的项目文件夹。';
  $('music-name').textContent = draft.music === '/music/dream.wav' ? '原创 · 星光里的晚安（钢琴 / 钟琴 / 氛围和弦）' : '已使用你导入的本地音乐';
  renderAssets(); resetGesture(); $('hand-cursor').hidden = true;
  $('setup-dialog').showModal();
  setEditorTab('copy');
}
function setEditorTab(name) {
  document.querySelectorAll('[data-editor-panel]').forEach(panel => panel.hidden = panel.dataset.editorPanel !== name);
  document.querySelectorAll('[data-editor-tab]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.editorTab === name)));
  $('setup-dialog').scrollTop = 0;
}
async function upload(file, kind) {
  const extMime = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', mp4: 'video/mp4', webm: 'video/webm', mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', ogg: 'audio/ogg' };
  const mime = extMime[file.name.split('.').pop().toLowerCase()] || file.type;
  const res = await fetch(`/api/assets?kind=${kind}`, { method: 'POST', headers: { 'Content-Type': mime }, body: file });
  const data = await res.json(); if (!res.ok) throw new Error(data.error); return data.src;
}
function memoryFileKind(file) { return /\.(gif|mp4|webm)$/i.test(file.name) ? 'motion' : 'static'; }
async function validateMemoryFile(file) {
  if (memoryFileKind(file) === 'static') return validateImage(file);
  return validateMotion(file);
}
async function validateImage(file) {
  const url = URL.createObjectURL(file), image = new Image();
  try { image.src = url; await image.decode(); if (!image.naturalWidth) throw new Error('图片无法读取。'); }
  finally { URL.revokeObjectURL(url); }
}
async function validateMotion(file) {
  if (!/\.(mp4|webm)$/i.test(file.name)) return validateImage(file);
  const url = URL.createObjectURL(file), video = document.createElement('video');
  try {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('视频读取超时，请换一个 MP4 文件。')), 15000);
      video.onloadeddata = () => { clearTimeout(timeout); resolve(); };
      video.onerror = () => { clearTimeout(timeout); reject(new Error('视频格式无法播放，建议使用 H.264 编码的 MP4。')); };
      video.muted = true; video.preload = 'auto'; video.src = url; video.load();
    });
  } finally { video.removeAttribute('src'); video.load(); URL.revokeObjectURL(url); }
}
async function importingFiles(task) {
  if (importing) return;
  importing = true; document.body.classList.add('saving'); $('save-content').disabled = true;
  const enabled = [...$('setup-dialog').querySelectorAll('input,textarea,button')].filter(element => !element.disabled);
  enabled.forEach(element => element.disabled = true);
  try { await task(); $('save-status').textContent = '导入完成，记得点击“保存这份心意”。'; }
  catch (error) { $('save-status').textContent = error.message; toast(error.message); }
  finally { importing = false; document.body.classList.remove('saving'); enabled.forEach(element => element.disabled = false); $('save-content').disabled = false; renderAssets(); }
}
function readiness() {
  const total = config.memories.length, readyMemories = config.memories.filter((m) => !m.placeholder).length, letter = !config.letterPlaceholder && !!config.letter.trim();
  const ready = total > 0 && readyMemories === total && letter;
  $('readiness').classList.toggle('ready', ready);
  $('readiness').textContent = formatCopy(ready ? config.subtitles.readyMessage : config.subtitles.draftMessage);
}
function renderMemoryRing() {
  $('memory-ring').replaceChildren(...config.memories.map((_, i) => {
    const star = document.createElement('span'); star.textContent = '✦';
    const angle = i * Math.PI * 2 / config.memories.length;
    star.style.left = `${Math.cos(angle) * 175 - 9}px`; star.style.top = `${Math.sin(angle) * 112 - 9}px`;
    return star;
  }));
}
async function loadContent() {
  try {
    const res = await fetch('/api/config'); if (!res.ok) throw new Error('读取内容失败');
    config = normalizeContent(await res.json()); loaded = true; applyPersonalization();
    music.src = config.music; music.volume = 0; readiness();
    // Decode every still image before enabling the experience. The first camera
    // gesture should never coincide with a multi-megapixel image decode.
    const pending = config.memories.filter((m) => !isVideo(m.src));
    await Promise.all(Array.from({ length: 3 }, async () => {
      while (pending.length) {
        const m = pending.shift(), img = new Image(); img.src = m.src;
        await img.decode().catch(() => {}); rememberSize(m.src, img);
      }
    }));
    renderMemoryRing();
    $('start').disabled = false; $('demo').disabled = false;
  } catch (error) { $('readiness').textContent = '请用项目里的“启动.bat”打开网页。'; toast('内容未能读取。请保持启动窗口打开，再刷新网页。', 9000); console.error(error); }
}
$('start').disabled = true; $('demo').disabled = true;
$('start').addEventListener('click', () => start(true));
$('demo').addEventListener('click', () => start(false));
document.querySelectorAll('[data-next]').forEach((button) => button.addEventListener('click', next));
$('next').addEventListener('click', next); $('previous').addEventListener('click', previous);
$('replay').addEventListener('click', () => { playMusic(true); particles = []; switchScene({ stage: 'tutorial', index: 0, page: 0, blessingStep: 0 }); });
$('music-toggle').addEventListener('click', () => {
  if (!loaded) return;
  if (music.paused) { musicMuted = false; started = true; playMusic(); }
  else { musicMuted = !musicMuted; fadeMusic(500); }
});
$('volume').addEventListener('input', (event) => { volume = Number(event.target.value) / 100; fadeMusic(200); });
$('fullscreen').addEventListener('click', () => { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen?.().catch(() => toast('当前浏览器未能进入全屏，可按 F11。')); });
$('settings').addEventListener('click', openSetup);
$('cancel-edit').addEventListener('click', () => { if (!importing) $('setup-dialog').close(); });
document.querySelectorAll('[data-editor-tab]').forEach(button => button.addEventListener('click', () => { if (!importing) setEditorTab(button.dataset.editorTab); }));
$('close-setup').addEventListener('click', () => { if (!importing) $('setup-dialog').close(); });
$('setup-dialog').addEventListener('cancel', (event) => { if (importing) event.preventDefault(); });
$('setup-dialog').addEventListener('close', () => { resetGesture(); });
$('memory-files').addEventListener('change', (event) => {
  const files = [...event.target.files].sort((a, b) => a.name.localeCompare(b.name, 'zh-CN', { numeric: true })); event.target.value = '';
  if (!files.length) return;
  if (files.length + draft.memories.length > 50) { toast('最多 50 段回忆，请先删除不需要的素材。'); return; }
  importingFiles(async () => {
    const additions = [];
    for (const [i, file] of files.entries()) {
      $('save-status').textContent = `正在导入回忆 ${i + 1}/${files.length}……`;
      await validateMemoryFile(file);
      additions.push({ src: await upload(file, memoryFileKind(file)), caption: '', placeholder: false });
    }
    draft.memories.push(...additions);
    renderAssets();
  });
});
$('clear-memories').addEventListener('click', () => { draft.memories = []; renderAssets(); });
$('add-memory').addEventListener('click', () => { if (draft.memories.length >= 50) return toast('最多添加 50 段回忆。'); draft.memories.push({ src: '/demo/memory-01.svg', caption: '', placeholder: true }); renderAssets(); });
$('theme-input').addEventListener('input', (event) => { draft.theme = event.target.value; });
$('greeting-input').addEventListener('input', (event) => { draft.greeting = event.target.value; });
$('finale-input').addEventListener('input', (event) => { draft.finale = event.target.value; });
$('finale-message-input').addEventListener('input', (event) => { draft.finaleMessage = event.target.value; });
$('letter-file').addEventListener('change', (event) => {
  const file = event.target.files[0]; event.target.value = ''; if (!file) return;
  importingFiles(async () => {
    if (file.size > 120000) throw new Error('信件文件较大，请使用30,000字以内的纯文本。');
    const bytes = await file.arrayBuffer(); let text;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
    catch { text = new TextDecoder('gb18030').decode(bytes); }
    if (text.length > 30000) throw new Error('信件请控制在30,000字以内。');
    $('letter-input').value = text.replace(/^\uFEFF/, '');
  });
});
$('music-file').addEventListener('change', (event) => {
  const file = event.target.files[0]; event.target.value = ''; if (!file) return;
  importingFiles(async () => { draft.music = await upload(file, 'music'); $('music-name').textContent = file.name; });
});
$('default-music').addEventListener('click', () => { draft.music = '/music/dream.wav'; $('music-name').textContent = '原创 · 星光里的晚安（钢琴 / 钟琴 / 氛围和弦）'; });
$('save-content').addEventListener('click', async () => {
  if (importing) return;
  if (!draft.memories.length) { toast('请至少保留一段回忆，或点击“添加空白回忆”。'); return; }
  const text = $('letter-input').value;
  if (text.length > 30000) { toast('信件请控制在30,000字以内。'); return; }
  if (text.trim()) { draft.letter = text; draft.letterPlaceholder = false; }
  else { draft.letter = ''; draft.letterPlaceholder = false; }
  importing = true; document.body.classList.add('saving'); $('save-content').disabled = true; $('save-status').textContent = '正在把心意保存到本地……';
  const enabled = [...$('setup-dialog').querySelectorAll('input,textarea,button')].filter(element => !element.disabled);
  enabled.forEach(element => element.disabled = true);
  try {
    const res = await fetch('/api/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(draft) });
    const result = await res.json(); if (!res.ok) throw new Error(result.error);
    const musicChanged = config.music !== draft.music;
    config = normalizeContent(structuredClone(draft)); applyPersonalization();
    if (musicChanged) { music.src = config.music; if (started) playMusic(); }
    readiness(); renderMemoryRing();
    if (state.stage === 'memories') { state.index = Math.min(state.index, config.memories.length - 1); renderMemory(); }
    instructions();
    if (state.stage === 'letter') { state.page = 0; layoutLetter(); }
    if (state.stage === 'finale') renderFinale();
    $('setup-dialog').close();
    toast(config.memories.some((m) => m.placeholder) || config.letterPlaceholder ? '已保存。还有演示内容待替换，正式展示前记得检查。' : '心意已保存。下次打开，回忆仍在这里。');
  } catch (error) { $('save-status').textContent = error.message; toast(`保存失败：${error.message}`); }
  finally { importing = false; document.body.classList.remove('saving'); enabled.forEach(element => element.disabled = false); $('save-content').disabled = false; }
});
window.addEventListener('keydown', (event) => {
  if ($('setup-dialog').open || /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName)) return;
  if (event.key === 'ArrowRight' || event.code === 'Space') { event.preventDefault(); next(); }
  if (event.key === 'ArrowLeft') { event.preventDefault(); previous(); }
  if (event.key.toLowerCase() === 'c' && state.stage !== 'welcome') enableCamera();
  if (event.key.toLowerCase() === 'm') $('music-toggle').click();
  if (event.key.toLowerCase() === 's') openSetup();
});
$('memory-image').addEventListener('error', () => toast('这张照片没有读到，请打开“准备回忆”重新导入。'));
$('memory-video').addEventListener('error', () => toast('这段视频无法播放，请换用 H.264 编码的 MP4 或导出的 GIF。'));
music.addEventListener('error', () => { if (loaded) toast('音乐没有读到，请在“准备回忆”中恢复原创音乐或重新导入。'); });
loadContent();
