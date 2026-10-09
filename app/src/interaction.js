export class GestureGate {
  constructor() { this.reset(); }
  reset() {
    this.pinched = false; this.armed = false; this.openSince = null;
    this.pinchCandidateSince = null; this.fistLocked = false;
    this.lastPinch = -Infinity; this.lastSeen = -Infinity;
  }
  update({ ratio, open, tracked, now, pinch: pinchDetected = ratio < .34, fist = false }) {
    if (!tracked) {
      this.openSince = null; this.armed = false; this.pinched = false;
      this.pinchCandidateSince = null; this.fistLocked = false;
      return { pinch: false, progress: 0 };
    }
    this.lastSeen = now;
    let pinch = false;
    if (fist) {
      // A closed palm can also put the thumb and index close together. Lock
      // the gate until the hand opens or clearly releases the fingers.
      this.fistLocked = true; this.pinched = false; this.armed = false;
      this.pinchCandidateSince = null; this.openSince = null;
    } else {
      if (ratio > .44) { this.fistLocked = false; this.pinched = false; this.armed = true; }
      if (!this.fistLocked && pinchDetected && !this.pinched) {
        this.pinchCandidateSince ??= now;
        if (now - this.pinchCandidateSince >= 90) {
          pinch = this.armed && now - this.lastPinch >= 800;
          this.pinched = true; this.armed = false; this.pinchCandidateSince = null;
          if (pinch) this.lastPinch = now;
        }
      } else if (!pinchDetected) this.pinchCandidateSince = null;
    }
    if (open && !this.pinched && !this.fistLocked) this.openSince ??= now;
    else this.openSince = null;
    return { pinch, progress: this.openSince === null ? 0 : Math.min(1, (now - this.openSince) / 1000) };
  }
}

export function handMetrics(points) {
  const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const width = Math.max(.025, distance(points[5], points[17]));
  const ratio = distance(points[4], points[8]) / width;
  // Distance from the wrist handles the raised hand's orientation without a y-axis assumption.
  const fingerPairs = [[8, 6], [12, 10], [16, 14], [20, 18]];
  const fingerReach = fingerPairs.map(([tip, joint]) => distance(points[tip], points[0]) > distance(points[joint], points[0]) * 1.06);
  const fingerExtended = fingerPairs.map(([tip, joint]) => distance(points[tip], points[0]) > distance(points[joint], points[0]) * 1.15);
  const extended = fingerExtended.every(Boolean);
  const thumbOut = distance(points[4], points[9]) > distance(points[3], points[9]) * 1.08;
  const center = [0, 5, 9, 13, 17].reduce((v, i) => ({ x: v.x + points[i].x / 5, y: v.y + points[i].y / 5 }), { x: 0, y: 0 });
  const indexReach = fingerReach[0];
  const foldedCount = fingerReach.filter((value) => !value).length;
  const otherFingersOpen = fingerReach.slice(1).filter(Boolean).length >= 2;
  // The OK sign is deliberately more forgiving than a precision pinch:
  // thumb and index form a small loop while most other fingers stay open.
  const pinch = ratio < .34 && otherFingersOpen;
  const fist = foldedCount >= 3 && !indexReach;
  return { ratio, pinch, ok: pinch, fist, open: extended && thumbOut && ratio > .65, x: 1 - center.x, y: center.y };
}

export function paginateLetter(text, width, height, measure, lineHeight = 38) {
  const linesPerPage = Math.max(2, Math.floor(height / lineHeight));
  const paragraphs = String(text).replace(/\r\n?/g, '\n').split('\n');
  const lines = [];
  for (const paragraph of paragraphs) {
    if (!paragraph) { lines.push(''); continue; }
    let line = '';
    for (const char of paragraph) {
      if (line && measure(line + char) > width) { lines.push(line); line = char; }
      else line += char;
    }
    lines.push(line);
  }
  const pages = [];
  for (let i = 0; i < lines.length; i += linesPerPage) pages.push(lines.slice(i, i + linesPerPage).join('\n'));
  return pages.length ? pages : [''];
}

export function nextState(state, count = 8, pages = 1) {
  if (state.stage === 'tutorial') return { stage: 'blessing', index: 0, page: 0, blessingStep: 0 };
  if (state.stage === 'blessing') {
    const step = state.blessingStep ?? 0;
    return step === 0 ? { ...state, blessingStep: 1 } : { stage: 'memories', index: 0, page: 0, blessingStep: 0 };
  }
  if (state.stage === 'memories') return state.index + 1 < count ? { ...state, index: state.index + 1 } : { ...state, stage: 'envelope' };
  if (state.stage === 'envelope') return { ...state, stage: 'letter', page: 0 };
  if (state.stage === 'letter') return state.page + 1 < pages ? { ...state, page: state.page + 1 } : { ...state, stage: 'finale' };
  return state;
}
