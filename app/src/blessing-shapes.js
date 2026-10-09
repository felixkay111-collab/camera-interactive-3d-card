// Surface samples of local 3D sculptures. Every visible point remains a star.
const TAU = Math.PI * 2;
// 2200 cake particles + 1500 reference dust particles + candle topper.
export const BLESSING_PARTICLE_COUNT = 4100;
export function makeBlessingShape(kind) {
  let seed = kind === 'cake' ? 729 : 1031;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const points = [];
  const add = (x, y, z, color, size = 1) => points.push({ x, y, z, color, size: size * (.85 + random() * .45), phase: random() * TAU });
  const pink = '#f5bfc6', cream = '#fff0d5', gold = '#eab96e', red = '#f1788d', green = '#a6be8c';
  const ring = (radius, y, count, color, wave = 0) => {
    for (let i = 0; i < count; i++) { const a = i / count * TAU; add(Math.cos(a) * radius, y + wave * Math.cos(a * 10), Math.sin(a) * radius, color, 1.3); }
  };
  const ellipsoid = (cx, cy, cz, rx, ry, rz, count, color) => {
    for (let i = 0; i < count; i++) {
      const v = 1 - 2 * (i + .5) / count, a = i * 2.399963, r = Math.sqrt(1 - v * v);
      add(cx + Math.cos(a) * r * rx, cy + v * ry, cz + Math.sin(a) * r * rz, color, 1.2);
    }
  };
  if (kind === 'cake') {
    // The three-tier layout is adapted from Besokus/BirthdayCake (MIT).
    // Its mesh is not loaded here: this project rebuilds the form with local
    // star particles so the experience remains self-contained and offline.
    const yMap = (rawY) => -(rawY - 1.5) / 15;
    const refPoint = (x, y, z, color, size = 1) => add(x / 10, yMap(y), z / 10, color, size);
    const cakeColors = [cream, gold, red, '#8d5c53', '#f5d2d8'];
    const layers = [
      { yBase: -6, height: 6, radius: 5 },
      { yBase: 0, height: 5, radius: 3.5 },
      { yBase: 5, height: 4, radius: 2 }
    ];
    // Reference ratios: 60% base tier, 25% middle tier, 15% top tier.
    for (let i = 0; i < 2200; i++) {
      const pick = random();
      const layer = pick > .4 ? layers[0] : pick > .15 ? layers[1] : layers[2];
      const angle = random() * TAU, surface = random() > .2;
      const radius = surface ? layer.radius * (.95 + random() * .1) : random() * layer.radius;
      const y = layer.yBase + random() * layer.height;
      const kindPick = random();
      const color = kindPick < .5 ? cakeColors[0] : kindPick < .7 ? cakeColors[1] : kindPick < .85 ? cakeColors[2] : kindPick < .95 ? cakeColors[3] : cakeColors[4];
      refPoint(Math.cos(angle) * radius, y, Math.sin(angle) * radius, color, kindPick < .7 ? .95 : 1.15);
    }
    // Fill the cake body with the same extra particle budget used by the
    // reference dust system, but keep these gathered targets inside a tier.
    // They still use independent scatter targets when the palm opens.
    for (let i = 0; i < 1500; i++) {
      const pick = random();
      const layer = pick > .4 ? layers[0] : pick > .15 ? layers[1] : layers[2];
      const angle = random() * TAU;
      const radius = layer.radius * Math.sqrt(random()) * .96;
      const y = layer.yBase + random() * layer.height;
      refPoint(Math.cos(angle) * radius, y, Math.sin(angle) * radius, i % 5 ? '#e8d6bd' : gold, .58);
    }
    // Reference candle topper: one holder, one wick, and one rising flame.
    const topY = -6 + 6 + 5 + 4;
    for (let i = 0; i < 150; i++) {
      const angle = random() * TAU, radius = .9 * Math.sqrt(random());
      refPoint(Math.cos(angle) * radius, topY - .35 + (random() - .5) * .7, Math.sin(angle) * radius, gold, 1.25);
    }
    for (let i = 0; i < 90; i++) {
      refPoint((random() - .5) * .1, topY + .55 + random() * .7, (random() - .5) * .1, i % 3 ? '#f8e5b8' : '#d8a46e', 1.1);
    }
    for (let i = 0; i < 160; i++) {
      const t = random(), angle = random() * TAU, radius = .45 * Math.sqrt(random()) * (1 - t * .6);
      refPoint(Math.cos(angle) * radius, topY + 1.2 + t * 2.8, Math.sin(angle) * radius, t < .45 ? '#fff2b0' : t < .8 ? '#f3b85e' : '#e77a63', 1.2);
    }
  } else {
    // Rose heads are distributed in depth, inside an open paper bouquet.
    const heads = [[-.34,-.48,.12],[0,-.56,-.1],[.34,-.48,.1],[-.22,-.29,.35],[.19,-.28,.37],[-.14,-.36,-.3],[.2,-.39,-.27]];
    heads.forEach(([cx, cy, cz], flower) => {
      // Nested curved petal sheets: the inner rings cup around a spiral heart.
      for (let layer = 0; layer < 4; layer++) {
        const petals = 5 + layer, radius = .036 + layer * .042;
        for (let petal = 0; petal < petals; petal++) for (let u = 0; u < 8; u++) for (let v = 0; v < 4; v++) {
          const a = (petal + u / 7 * .94) / petals * TAU + layer * .73 + flower * .4;
          const t = v / 3, r = radius * (.68 + t * .44);
          const height = .025 + layer * .017 + Math.sin(t * Math.PI) * .037;
          const color = v === 3 ? '#ffc0c9' : layer < 2 ? '#ef8498' : '#eea0af';
          add(cx + Math.cos(a) * r, cy + Math.sin(a) * r * .74 - height * .25, cz + height * (1 - t * .4), color, .95);
        }
      }
      for (let i = 0; i < 50; i++) {
        const a = i / 50 * TAU * 2.8, r = .005 + i / 50 * .05;
        add(cx + Math.cos(a) * r, cy + Math.sin(a) * r * .75, cz + .065, red, 1.1);
      }
      for (let i = 0; i < 45; i++) {
        const t = i / 44;
        add(cx * t, .36 + (cy - .36) * t, -.03 + (cz + .03) * t, green, 1);
      }
    });
    // Leaves are curved surfaces visible between the flowers and wrapping.
    for (let leaf = 0; leaf < 9; leaf++) for (let i = 0; i < 50; i++) {
      const t = random(), side = (random() - .5) * 2, a = leaf / 9 * TAU;
      const r = .18 + t * .24, width = Math.sin(t * Math.PI) * .07 * side;
      add(Math.cos(a) * r + width, -.05 - t * .22, Math.sin(a) * r, green, 1);
    }
    // Faceted blush wrapping opens around the roses, tied at the narrow waist.
    for (let i = 0; i < 1350; i++) {
      const a = i * 2.399963, t = (i + .5) / 1350;
      const facet = 1 + .09 * Math.cos(a * 7), r = (.08 + .5 * Math.pow(t, 1.25)) * facet;
      const front = Math.sin(a) > 0;
      const rimY = front ? -.04 + .12 * Math.cos(a * 3) : -.53 + .07 * Math.cos(a * 4);
      add(Math.cos(a) * r, .35 + (rimY - .35) * t, Math.sin(a) * r, i % 8 === 0 ? cream : '#dcb2c6', 1.05);
    }
    // Lower wrapping and two loops with flowing ribbon tails.
    for (let i = 0; i < 300; i++) {
      const a = i * 2.399963, t = (i + .5) / 300, r = .08 + t * .12;
      add(Math.cos(a) * r, .35 + t * .31, Math.sin(a) * r, pink, 1.1);
    }
    for (const side of [-1, 1]) {
      for (let i = 0; i < 90; i++) {
        const a = i / 90 * TAU;
        add(side * (.1 + .105 * Math.cos(a)), .35 + .062 * Math.sin(a), .18 + .02 * Math.sin(a), cream, 1.4);
      }
      for (let i = 0; i < 120; i++) {
        const t = random();
        add(side * (.045 + .13 * t) + (random() - .5) * .045, .39 + t * .38, .16 + .04 * Math.sin(t * 5), cream, 1.2);
      }
    }
  }
  // Keep one particle pool for a seamless cake-to-rose morph.
  return Array.from({ length: BLESSING_PARTICLE_COUNT }, (_, i) => ({ ...points[Math.floor(i * points.length / BLESSING_PARTICLE_COUNT)] }));
}
