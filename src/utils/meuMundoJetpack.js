// GERADO por scripts/build-jetpack-sim.js a partir de
// freelandoo frontend/.../features/meu-mundo/jetpack/sim/*.ts — NÃO EDITAR AQUI.
// Mudou a regra do jogo no front? Rode o script e commite os dois repos juntos.
/* eslint-disable */
"use strict";

// ── sim/rng.ts ───────────────────────────────────────────────────────────────
// Gerador pseudoaleatório com seed (mulberry32): a mesma seed gera sempre o
// mesmo percurso, o que permite reproduzir partidas em testes.

class Rng {
          s        ;
  constructor(seed        ) {
    this.s = seed >>> 0 || 0x9e3779b9;
  }
  next()         {
    let t = (this.s = (this.s + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(a        , b        )         {
    return a + (b - a) * this.next();
  }
  chance(p        )          {
    return this.next() < p;
  }
  pick   (items              )    {
    return items[Math.floor(this.next() * items.length)];
  }
}

function randomSeed()         {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return a[0] || 1;
}

// ── sim/difficulty.ts ────────────────────────────────────────────────────────
// Dificuldade em função da distância (m). Interpola entre pontos-chave e para
// de crescer no último: o jogo fica difícil, mas nunca impossível.

                             
                           
                                     
                
                                        
              
                                                     
                  
                                          
                 
                                           
                  
                                                                            
                
                                                             
                    
                                                
                  
 

                                                     

const KEYS        = [
  { d: 0, speed: 4.2, gap: 4.8, spacing: 8.2, moving: 0, moveAmp: 0, shift: 0.45, fuelEvery: 1, bigFuel: 0.15 },
  { d: 100, speed: 4.8, gap: 4.2, spacing: 7.4, moving: 0, moveAmp: 0, shift: 0.6, fuelEvery: 1.1, bigFuel: 0.15 },
  { d: 300, speed: 5.3, gap: 3.7, spacing: 6.8, moving: 0.3, moveAmp: 0.8, shift: 0.7, fuelEvery: 1.25, bigFuel: 0.2 },
  { d: 600, speed: 5.9, gap: 3.3, spacing: 6.2, moving: 0.4, moveAmp: 1.1, shift: 0.78, fuelEvery: 1.4, bigFuel: 0.22 },
  { d: 1000, speed: 6.4, gap: 3.0, spacing: 5.8, moving: 0.5, moveAmp: 1.3, shift: 0.82, fuelEvery: 1.5, bigFuel: 0.25 },
  { d: 2000, speed: 6.8, gap: 2.8, spacing: 5.5, moving: 0.55, moveAmp: 1.4, shift: 0.85, fuelEvery: 1.6, bigFuel: 0.25 },
];

/** Velocidade máxima que o jogo alcança (o backend usa o mesmo teto para validar). */
const MAX_SPEED = KEYS[KEYS.length - 1].speed;

function phaseOf(d        )                      {
  return d < 100 ? 1 : d < 300 ? 2 : d < 600 ? 3 : d < 1000 ? 4 : 5;
}

function difficultyAt(distance        )             {
  const d = Math.max(0, distance);
  let i = 0;
  while (i < KEYS.length - 2 && d >= KEYS[i + 1].d) i++;
  const a = KEYS[i];
  const b = KEYS[i + 1];
  const t = Math.min(1, (d - a.d) / (b.d - a.d));
  const mix = (k                      ) => a[k] + (b[k] - a[k]) * t;
  return {
    phase: phaseOf(d),
    speed: mix('speed'),
    gap: mix('gap'),
    spacing: mix('spacing'),
    moving: mix('moving'),
    moveAmp: mix('moveAmp'),
    shift: mix('shift'),
    fuelEvery: mix('fuelEvery'),
    bigFuel: mix('bigFuel'),
  };
}

// ── sim/tuning.ts ────────────────────────────────────────────────────────────
// Parâmetros do jogo num lugar só. 1 unidade = 1 metro. Eixo X: avanço do
// percurso; Y: altitude. Tudo aqui é ajustável sem mexer na lógica.

                         
                                                                           
               
                  
                 
                
                  
                                               
                
                  
                 
                                                            
               
               
                                     
                  
                                                       
                  
                                                                                 
                    
                                                                
                     
         
                
                  
                 
                  
                
                                                     
                   
                                                                                 
                
    
                                                         
                         
                                                                  
                    
                                                                     
                   
 

const TUNING         = {
  step: 1 / 120,
  gravity: 18,
  thrust: 30,
  maxUp: 7,
  maxFall: 9,
  floor: 0,
  ceiling: 13,
  startY: 6.5,
  hitW: 0.95,
  hitH: 0.48,
  pickupR: 0.42,
  vulcanR: 0.6,
  powerTime: 5,
  powerSpeed: 2,
  fuel: { max: 100, start: 100, burn: 12, small: 30, big: 60, vulcan: 50, low: 0.2 },
  firstObstacleX: 16,
  lookahead: 34,
  reaction: 0.15,
};

// ── sim/fuel.ts ──────────────────────────────────────────────────────────────
// Tanque do jetpack, independente do movimento. Avisa por eventos quando o
// valor muda, fica baixo, esvazia ou recebe uma cápsula.

                       
                                                          
                        
                          
                                                              

class FuelSystem {
  value        ;
           max        ;
                   start        ;
                   lowRatio        ;
          low = false;
          listeners = new Set                        ();

  constructor(max        , start        , lowRatio        ) {
    this.max = max;
    this.start = start;
    this.lowRatio = lowRatio;
    this.value = Math.min(start, max);
  }

  on(fn                        ) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  get ratio() {
    return this.value / this.max;
  }
  get empty() {
    return this.value <= 0;
  }
  get isLow() {
    return this.low;
  }

  reset() {
    this.value = Math.min(this.start, this.max);
    this.low = false;
    this.emit({ type: 'fuel_changed', value: this.value, ratio: this.ratio });
  }

  /** Põe o valor sem avisar ninguém (restaurar um estado do servidor, mm3d-21). */
  setValue(v        ) {
    this.value = Math.max(0, Math.min(this.max, v));
    this.low = this.ratio < this.lowRatio;
  }

  /** Gasta até `amount`; devolve quanto realmente saiu do tanque. */
  consume(amount        )         {
    if (amount <= 0 || this.value <= 0) return 0;
    const used = Math.min(amount, this.value);
    this.value -= used;
    if (this.value < 1e-9) this.value = 0;
    this.emit({ type: 'fuel_changed', value: this.value, ratio: this.ratio });
    this.checkLow();
    if (this.value === 0) this.emit({ type: 'fuel_empty' });
    return used;
  }

  /** Abastece sem passar do máximo; devolve quanto entrou de fato. */
  collect(amount        )         {
    const added = Math.max(0, Math.min(amount, this.max - this.value));
    this.value += added;
    this.emit({ type: 'fuel_collected', amount, added });
    this.emit({ type: 'fuel_changed', value: this.value, ratio: this.ratio });
    this.checkLow();
    return added;
  }

          checkLow() {
    const low = this.ratio < this.lowRatio;
    if (low && !this.low) this.emit({ type: 'fuel_low' });
    this.low = low;
  }

          emit(e           ) {
    for (const fn of this.listeners) fn(e);
  }
}

// ── sim/generator.ts ─────────────────────────────────────────────────────────
// Gerador infinito do percurso. Cada obstáculo tem uma "linha segura" (pathY):
// uma altitude com folga de gap/2 acima e abaixo, durante toda a largura dele.
// A diferença entre linhas consecutivas nunca passa do que o jogador
// consegue subir/descer no tempo entre os dois (ver reach()), descontando o
// tempo de reação e a amplitude de obstáculos móveis. As cápsulas ficam no
// espaço aberto entre obstáculos, perto da reta que liga as linhas seguras.

/** Distância vertical alcançável em `t` segundos partindo de vy = 0. */
function reach(t        , tune        , dir               )         {
  const time = t - tune.reaction;
  if (time <= 0) return 0;
  const a = dir === 'up' ? tune.thrust - tune.gravity : tune.gravity;
  const vmax = dir === 'up' ? tune.maxUp : tune.maxFall;
  const tv = vmax / a;
  return time < tv ? 0.5 * a * time * time : 0.5 * a * tv * tv + vmax * (time - tv);
}

/** Maior mudança de linha segura permitida entre dois obstáculos. */
function maxShift(freeDistance        , speed        , tune        , frac        )         {
  const t = Math.max(0, freeDistance) / speed;
  return Math.min(reach(t, tune, 'up'), reach(t, tune, 'down')) * frac;
}

function offsetAt(o          , t        )         {
  return o.amp ? o.amp * Math.sin(o.omega * t + o.phase) : 0;
}

/** Linha segura do obstáculo no instante t. */
function pathAt(o          , t        )         {
  return o.pathY + (o.kind === 'beam' ? 0 : offsetAt(o, t));
}

/** Maior trecho (m) sem cápsula antes de o gerador forçar uma. */
const MAX_FUEL_GAP = 30;
/**
 * Intervalo (s de jogo) entre turbos. Pote perdido: o próximo vem
 * VULCAN_EVERY depois dele. Pote pego: só VULCAN_EVERY depois de o poder acabar
 * (5 s de poder a 2x + VULCAN_EVERY após a coleta).
 */
const VULCAN_EVERY = 15;

/**
 * Distância entre um pote pego em x e o próximo: o trecho do poder (mais rápido,
 * powerSpeed) seguido de VULCAN_EVERY segundos de voo normal.
 */
function vulcanGapAfterTaken(x        , tune        )         {
  const power = distanceIn(x, tune.powerTime) * tune.powerSpeed;
  return power + distanceIn(x + power, VULCAN_EVERY);
}

/** Distância percorrida em `seconds` partindo de x (a velocidade sobe com a distância). */
function distanceIn(x        , seconds        )         {
  let d = x;
  const dt = 0.25;
  for (let t = 0; t < seconds; t += dt) d += difficultyAt(d).speed * Math.min(dt, seconds - t);
  return d - x;
}
const OUT = 6; // quanto as peças passam do chão/teto (só visual)

/** Retângulos letais do obstáculo no instante t (escreve em `out`). */
function obstacleRects(o          , t        , tune        , out         = [])         {
  out.length = 0;
  const off = offsetAt(o, t);
  const x0 = o.x;
  const x1 = o.x + o.w;
  if (o.kind === 'beam') {
    const y0 = o.blockY0 <= tune.floor ? tune.floor - OUT : o.blockY0 + off;
    const y1 = o.blockY1 >= tune.ceiling ? tune.ceiling + OUT : o.blockY1 + off;
    out.push({ x0, x1, y0, y1 });
    return out;
  }
  const c = o.pathY + off;
  out.push({ x0, x1, y0: tune.floor - OUT, y1: c - o.gap / 2 });
  out.push({ x0, x1, y0: c + o.gap / 2, y1: tune.ceiling + OUT });
  return out;
}

const WIDTH                               = { pipes: 1.15, wall: 0.8, gate: 0.6, beam: 2.4 };

class Generator {
          rng     ;
          nextX        ;
          lastPath        ;
          lastAmp = 0;
          lastEnd        ;
          fuelDebt = 0;
          lastFuelX = 0;
          nextVulcanX = 0;
          nextId = 1;
          obstaclePool             = [];
          pickupPool           = [];
                   tune        ;

  constructor(seed        , tune        ) {
    this.tune = tune;
    this.rng = new Rng(seed);
    this.nextX = tune.firstObstacleX;
    this.lastPath = tune.startY;
    this.lastEnd = 0;
    this.nextVulcanX = this.vulcanInterval(0);
  }

  /** Posição do próximo pote: ~VULCAN_EVERY s de voo depois de x. */
          vulcanInterval(x        ) {
    return x + distanceIn(x, VULCAN_EVERY * this.rng.range(0.95, 1.08));
  }

  /**
   * O jogador pegou o pote em x: o próximo só depois do poder acabar mais
   * VULCAN_EVERY. Com 15 s entre potes e ~34 m gerados à frente, o próximo
   * ainda não existe no percurso quando isso é chamado.
   */
  vulcanTaken(x        ) {
    const after = x + vulcanGapAfterTaken(x, this.tune);
    this.nextVulcanX = Math.max(this.nextVulcanX, after);
  }

  /** Gera obstáculos e cápsulas até `xMax`. */
  fill(xMax        , obstacles            , pickups          ) {
    while (this.nextX < xMax) this.spawn(obstacles, pickups);
  }

  recycle(o          ) {
    this.obstaclePool.push(o);
  }
  recyclePickup(p        ) {
    this.pickupPool.push(p);
  }

          spawn(obstacles            , pickups          ) {
    const tune = this.tune;
    const rng = this.rng;
    const x = this.nextX;
    const diff = difficultyAt(x);

    let kind               = rng.pick(['pipes', 'pipes', 'wall', 'beam']         );
    // Seca de combustível: o próximo obstáculo fica parado para a cápsula caber.
    const overdue = x - this.lastFuelX > MAX_FUEL_GAP;
    const moving = !overdue && diff.moving > 0 && rng.chance(diff.moving);
    if (moving && kind !== 'beam') kind = 'gate';
    let gap = diff.gap * rng.range(1, 1.12);
    let amp = moving ? rng.range(0.45, 1) * diff.moveAmp : 0;
    // A linha anterior precisa caber na faixa permitida deste obstáculo; senão o
    // limite (clamp) empurraria a linha além do alcance. As passagens só
    // diminuem com a distância, então sem movimento e com o gap mínimo sempre cabe.
    const fits = (g        , a        ) =>
      this.lastPath >= tune.floor + g / 2 + a + 0.6 && this.lastPath <= tune.ceiling - g / 2 - a - 0.6;
    if (!fits(gap, amp)) {
      amp = 0;
      if (kind === 'gate') kind = 'pipes';
      if (!fits(gap, 0)) gap = diff.gap;
    }
    // Mudança de altitude permitida até aqui; o movimento dos dois obstáculos
    // consome parte desse alcance.
    const free = x - this.lastEnd - tune.hitW;
    const reachable = maxShift(free, diff.speed, tune, diff.shift);
    amp = Math.min(amp, Math.max(0, reachable - this.lastAmp));
    if (amp < 0.25) {
      amp = 0;
      if (kind === 'gate') kind = 'pipes';
    }
    const width = WIDTH[kind];
    const limit = reachable - amp - this.lastAmp;
    const lo = tune.floor + gap / 2 + amp + 0.6;
    const hi = tune.ceiling - gap / 2 - amp - 0.6;
    const shift = Math.max(0, limit) * rng.range(-1, 1) * (overdue ? 0.3 : 1);
    const pathY = clamp(this.lastPath + shift, lo, hi);

    const o = this.obstaclePool.pop() ?? ({}            );
    o.id = this.nextId++;
    o.kind = kind;
    o.x = x;
    o.w = width;
    o.pathY = pathY;
    o.gap = gap;
    o.amp = amp;
    o.omega = amp ? (Math.PI * 2) / rng.range(2.6, 3.4) : 0;
    o.phase = amp ? rng.range(0, Math.PI * 2) : 0;
    o.passed = false;
    o.broken = 0;
    o.blockY0 = 0;
    o.blockY1 = 0;
    if (kind === 'beam') this.placeBeam(o, diff);
    obstacles.push(o);

    this.placeFuel(x, pathY, o.kind === 'beam' ? 0 : o.amp, diff, pickups, overdue);

    this.lastPath = pathY;
    this.lastAmp = kind === 'beam' ? 0 : amp;
    this.lastEnd = x + width;
    this.nextX = x + width + diff.spacing * rng.range(0.92, 1.12);
  }

  /** Bloco suspenso: a linha segura fica acima ou abaixo dele, com folga gap/2 + amp. */
          placeBeam(o          , diff            ) {
    const tune = this.tune;
    const h = this.rng.range(1.1, 2.2);
    const margin = o.gap / 2 + o.amp;
    const roomBelow = o.pathY - tune.floor;
    const roomAbove = tune.ceiling - o.pathY;
    const below = roomAbove > roomBelow ? true : roomAbove < roomBelow ? false : this.rng.chance(0.5);
    // linha segura abaixo do bloco -> bloco acima dela, e vice-versa
    if (below) {
      o.blockY0 = o.pathY + margin;
      o.blockY1 = o.blockY0 + h;
      if (tune.ceiling - o.blockY1 < diff.gap * 0.9) o.blockY1 = tune.ceiling; // pendurado no teto
    } else {
      o.blockY1 = o.pathY - margin;
      o.blockY0 = o.blockY1 - h;
      if (o.blockY0 - tune.floor < diff.gap * 0.9) o.blockY0 = tune.floor; // apoiado no chão
    }
    // Bloco preso ao teto/chão não balança.
    if (o.blockY0 <= tune.floor || o.blockY1 >= tune.ceiling) {
      o.amp = 0;
      o.omega = 0;
    }
  }

  /**
   * Cápsula no espaço aberto antes do obstáculo, perto da trajetória segura.
   * Pegar a cápsula nunca pode condenar a partida: as duas pernas (linha
   * anterior -> cápsula -> próximo obstáculo) precisam caber no alcance,
   * contando o movimento dos obstáculos. Se não couber, fica para o próximo.
   */
          placeFuel(x        , pathY        , amp        , diff            , pickups          , overdue         ) {
    this.fuelDebt += 1;
    // O vão inteiro (onde o pote fica) precisa começar depois do ponto mínimo.
    const vulcan = this.lastEnd >= this.nextVulcanX;
    if (this.fuelDebt < diff.fuelEvery && !overdue && !vulcan) return;
    const tune = this.tune;
    const rng = this.rng;
    const gapStart = this.lastEnd + 0.9;
    const gapEnd = x - 0.9;
    if (gapEnd - gapStart < 1) return;
    const big = !vulcan && rng.chance(diff.bigFuel);
    const want = rng.range(0.3, 0.6);
    // A especial fica um pouco fora da linha: recompensa por arriscar.
    const off = big ? rng.range(-1, 1) * Math.min(1.6, diff.gap * 0.45) : rng.range(-0.3, 0.3);
    let px = 0;
    let y = NaN;
    for (const t of [want, 0.45, 0.3, 0.6, 0.2, 0.75]) {
      px = gapStart + (gapEnd - gapStart) * t;
      // Faixa de altura de onde dá para chegar vindo da linha anterior e sair a tempo para a próxima.
      const r1 = maxShift(px - this.lastEnd - tune.hitW / 2, diff.speed, tune, 1) - this.lastAmp;
      const r2 = maxShift(x - px - tune.hitW / 2, diff.speed, tune, 1) - amp;
      const lo = Math.max(this.lastPath - r1, pathY - r2, tune.floor + 1.2);
      const hi = Math.min(this.lastPath + r1, pathY + r2, tune.ceiling - 1.2);
      if (hi - lo < 0.1) continue;
      const lineY = this.lastPath + (pathY - this.lastPath) * t;
      y = Math.min(hi - 0.05, Math.max(lo + 0.05, lineY + off));
      break;
    }
    // Pote sem lugar seguro aqui: tenta no próximo vão.
    if (Number.isNaN(y)) return;
    this.fuelDebt = Math.max(0, this.fuelDebt - diff.fuelEvery);
    this.lastFuelX = px;
    if (vulcan) this.nextVulcanX = this.vulcanInterval(px);
    const p = this.pickupPool.pop() ?? ({}          );
    p.id = this.nextId++;
    p.x = px;
    p.y = y;
    p.kind = vulcan ? 'vulcan' : big ? 'big' : 'small';
    p.taken = false;
    pickups.push(p);
  }
}

function clamp(v        , a        , b        ) {
  return a > b ? (a + b) / 2 : Math.min(b, Math.max(a, v));
}

// ── sim/track.ts ─────────────────────────────────────────────────────────────
// Percurso de uma partida (mm3d-21): seed, gerador, obstáculos, cápsulas e o
// que a partida mudou nele (peças quebradas, cápsulas pegas, turbos pegos).
// É o mesmo para todos os jogadores da partida; o jogador mora em runner.ts.
//
// Só TypeScript que pode ser apagado (sem enum, sem parameter properties): o
// teste do backend carrega este arquivo direto e confere o espelho em JS
// (freelandoo-backend/src/utils/meuMundoJetpack.js).

class Track {
           tune        ;
  seed = 1;
  /** Passos desde a largada (iguais para todos os jogadores). */
  ticks = 0;
  /** Tempo de jogo (s) desde a largada: move os obstáculos que oscilam. */
  t = 0;
  obstacles             = [];
  pickups           = [];
  /** x dos turbos pegos, na ordem (refaz o percurso numa reconexão). */
  vulcans           = [];
          gen            ;

  constructor(seed        , tune         = TUNING) {
    this.tune = tune;
    this.reset(seed);
  }

  reset(seed        ) {
    for (const o of this.obstacles) this.gen?.recycle(o);
    for (const p of this.pickups) this.gen?.recyclePickup(p);
    this.obstacles.length = 0;
    this.pickups.length = 0;
    this.vulcans.length = 0;
    this.seed = seed;
    this.gen = new Generator(seed, this.tune);
    this.ticks = 0;
    this.t = 0;
    this.gen.fill(this.tune.lookahead, this.obstacles, this.pickups);
  }

  setTick(ticks        ) {
    this.ticks = ticks;
    this.t = ticks * this.tune.step;
  }

  /** Gera até xMax (a frente do líder + lookahead). */
  fillTo(xMax        ) {
    this.gen.fill(xMax, this.obstacles, this.pickups);
  }

  /** Recicla o que ficou antes de x (atrás da rabeira, fora da tela). */
  recycleBehind(x        ) {
    let w = 0;
    for (const o of this.obstacles) {
      if (o.x + o.w < x) this.gen.recycle(o);
      else this.obstacles[w++] = o;
    }
    this.obstacles.length = w;
    w = 0;
    for (const p of this.pickups) {
      if (p.x < x) this.gen.recyclePickup(p);
      else this.pickups[w++] = p;
    }
    this.pickups.length = w;
  }

  pickupById(id        )                     {
    return this.pickups.find((p) => p.id === id);
  }

  obstacleById(id        )                       {
    return this.obstacles.find((o) => o.id === id);
  }

  /** Alguém pegou: some para todos; turbo empurra o próximo turbo do percurso. */
  take(p        ) {
    p.taken = true;
    if (p.kind === 'vulcan') {
      this.gen.vulcanTaken(p.x);
      this.vulcans.push(p.x);
    }
  }

  breakPiece(obstacleId        , piece        ) {
    const o = this.obstacleById(obstacleId);
    if (o) o.broken |= 1 << piece;
  }

  /**
   * Percurso igual ao de uma partida em andamento, só com a seed e os turbos
   * pegos (reconexão): gera em ordem e aplica cada turbo no ponto em que o
   * percurso já existia quando foi pego (o próximo turbo fica bem depois).
   */
  static rebuild(seed        , vulcans                   , upTo        , tune         = TUNING)        {
    const tr = new Track(seed, tune);
    for (const x of vulcans) {
      tr.fillTo(x + tune.lookahead);
      tr.gen.vulcanTaken(x);
      tr.vulcans.push(x);
    }
    tr.fillTo(upTo);
    return tr;
  }
}

// ── sim/runner.ts ────────────────────────────────────────────────────────────
// Um jogador numa partida (mm3d-21): física, combustível, turbo, colisão e o
// reboque do modo em grupo. O percurso é compartilhado (track.ts); a ordem do
// passo (quem coleta primeiro, reboque, fim da pista) é da partida (match.ts).
//
// Só TypeScript que pode ser apagado (sem enum, sem parameter properties): o
// teste do backend carrega este arquivo direto e confere o espelho em JS.

/** Estado completo do jogador (predição/reconciliação no cliente). */
                             
            
            
             
                
               
                     
               
                     
                   
                 
                     
                   
                 
                
                        
                       
                  
                    
 

class Runner {
           tune        ;
           fuel            ;
  /** Eventos desde a última leitura. */
           events              = [];
  state        = 'ready';
  x = 0;
  y        ;
  vy = 0;
  speed = 0;
  thrusting = false;
  fuelCollected = 0;
  pickupsTaken = 0;
  passed = 0;
  /** Maior id de obstáculo já ultrapassado (o "passou" é de cada um). */
  passedId = 0;
  phase = 1;
  /** Fim do turbo (tempo de jogo, s). */
  powerUntil = 0;
  smashed = 0;
  /** Grupo: preso na borda atrás do líder (não morre em obstáculo). */
  towed = false;
  /** Grupo: imune a obstáculo até este tempo (saída do reboque). */
  graceUntil = 0;
  /** Passo da partida em que morreu (0 = vivo). */
  deathTick = 0;
          poweredFlag = false;
          rects         = [];

  constructor(tune        , startY         = tune.startY) {
    this.tune = tune;
    this.y = startY;
    this.speed = difficultyAt(0).speed;
    this.fuel = new FuelSystem(tune.fuel.max, tune.fuel.start, tune.fuel.low);
    this.fuel.on((e) => {
      if (e.type === 'fuel_low') this.events.push({ type: 'fuel_low' });
      else if (e.type === 'fuel_empty') this.events.push({ type: 'fuel_empty' });
    });
  }

  get alive() {
    return this.state !== 'dead';
  }
  get distance() {
    return Math.max(0, this.x);
  }
  /** Turbo ativo no instante t. */
  poweredAt(t        ) {
    return t < this.powerUntil;
  }

  /** Largada: sai do "pronto". */
  start() {
    if (this.state !== 'ready') return;
    this.state = 'flying';
    this.events.push({ type: 'start' });
  }

  /** Física do passo (antes de coleta e colisão). `speedScale` < 1 = reagrupando. */
  move(held         , t        , speedScale = 1) {
    const tune = this.tune;
    const dt = tune.step;
    const thrust = held && !this.fuel.empty;
    if (thrust !== this.thrusting) {
      this.thrusting = thrust;
      this.events.push({ type: thrust ? 'thrust_on' : 'thrust_off' });
    }
    this.vy += ((thrust ? tune.thrust : 0) - tune.gravity) * dt;
    this.vy = Math.min(tune.maxUp, Math.max(-tune.maxFall, this.vy));
    this.y += this.vy * dt;
    this.speed = difficultyAt(this.x).speed * (this.poweredAt(t) ? tune.powerSpeed : speedScale);
    this.x += this.speed * dt;
    if (thrust) this.fuel.consume(tune.fuel.burn * dt);
    if (this.fuel.empty && this.thrusting) {
      this.thrusting = false;
      this.events.push({ type: 'thrust_off' });
    }
    this.state = this.fuel.empty ? 'out_of_fuel' : this.thrusting ? 'flying' : 'falling';

    const phase = phaseOf(this.x);
    if (phase !== this.phase) {
      this.phase = phase;
      this.events.push({ type: 'phase', phase });
    }
  }

  hitbox()       {
    const { hitW, hitH } = this.tune;
    return { x0: this.x - hitW / 2, x1: this.x + hitW / 2, y0: this.y - hitH / 2, y1: this.y + hitH / 2 };
  }

  /** Cápsula ao alcance e ainda livre (a partida decide quem leva quando dois tocam juntos). */
  touches(p        )          {
    const hb = this.hitbox();
    const r = p.kind === 'vulcan' ? this.tune.vulcanR : this.tune.pickupR;
    if (p.taken || p.x - r > hb.x1 || p.x + r < hb.x0) return false;
    const cx = Math.min(hb.x1, Math.max(hb.x0, p.x));
    const cy = Math.min(hb.y1, Math.max(hb.y0, p.y));
    return (p.x - cx) ** 2 + (p.y - cy) ** 2 <= r * r;
  }

  /** Pega todas as cápsulas que toca (na ordem do percurso). */
  collect(track       , t        ) {
    for (const p of track.pickups) if (this.touches(p)) this.take(track, p, t);
  }

  /** Esta cápsula é dele. */
  take(track       , p        , t        ) {
    track.take(p);
    const added = this.fuel.collect(this.tune.fuel[p.kind]);
    this.fuelCollected += added;
    this.pickupsTaken++;
    this.events.push({ type: 'pickup', kind: p.kind, added, x: p.x, y: p.y, id: p.id });
    if (p.kind === 'vulcan') {
      this.powerUntil = t + this.tune.powerTime;
      this.poweredFlag = true;
      this.events.push({ type: 'power_on', until: this.powerUntil });
    }
  }

  /** Avisa o fim do turbo. */
  checkPowerEnd(t        ) {
    if (this.poweredFlag && !this.poweredAt(t)) {
      this.poweredFlag = false;
      this.events.push({ type: 'power_off' });
    }
  }

  /** Chão/teto sempre matam; obstáculo não mata rebocado nem imune; com turbo, quebra a peça. */
  collide(track       , t        )                    {
    const tune = this.tune;
    const hb = this.hitbox();
    if (hb.y0 <= tune.floor) return 'floor';
    if (hb.y1 >= tune.ceiling) return 'ceiling';
    if (this.towed || t < this.graceUntil) return null;
    const powered = this.poweredAt(t);
    for (const o of track.obstacles) {
      if (o.x > hb.x1 || o.x + o.w < hb.x0) continue;
      const rects = obstacleRects(o, t, tune, this.rects);
      for (let i = 0; i < rects.length; i++) {
        const r = rects[i];
        if (o.broken & (1 << i)) continue;
        if (!(r.x0 < hb.x1 && r.x1 > hb.x0 && r.y0 < hb.y1 && r.y1 > hb.y0)) continue;
        if (!powered) return 'obstacle';
        // Turbo: a peça se parte (para todos) e o jogador segue.
        o.broken |= 1 << i;
        this.smashed++;
        const y = Math.min(r.y1, Math.max(r.y0, this.y));
        this.events.push({ type: 'smash', x: Math.max(r.x0, hb.x0), y, obstacle: o.id, piece: i });
      }
    }
    return null;
  }

  /** Obstáculos que ele acabou de ultrapassar. */
  countPassed(track       ) {
    const edge = this.x - this.tune.hitW / 2;
    for (const o of track.obstacles) {
      if (o.id > this.passedId && o.x + o.w < edge) {
        this.passedId = o.id;
        this.passed++;
        this.events.push({ type: 'pass' });
      }
    }
  }

  die(cause            , tick        ) {
    if (this.poweredFlag) this.events.push({ type: 'power_off' });
    this.poweredFlag = false;
    this.powerUntil = 0;
    if (this.thrusting) this.events.push({ type: 'thrust_off' });
    this.thrusting = false;
    this.state = 'dead';
    this.deathTick = tick;
    this.events.push({ type: 'dead', cause });
  }

  drain()              {
    const out = this.events.slice();
    this.events.length = 0;
    return out;
  }

  snapshot()             {
    return {
      x: this.x,
      y: this.y,
      vy: this.vy,
      speed: this.speed,
      state: this.state,
      thrusting: this.thrusting,
      fuel: this.fuel.value,
      powerUntil: this.powerUntil,
      powered: this.poweredFlag,
      towed: this.towed,
      graceUntil: this.graceUntil,
      passedId: this.passedId,
      passed: this.passed,
      phase: this.phase,
      fuelCollected: this.fuelCollected,
      pickupsTaken: this.pickupsTaken,
      smashed: this.smashed,
      deathTick: this.deathTick,
    };
  }

  restore(s            ) {
    this.x = s.x;
    this.y = s.y;
    this.vy = s.vy;
    this.speed = s.speed;
    this.state = s.state;
    this.thrusting = s.thrusting;
    this.fuel.setValue(s.fuel);
    this.powerUntil = s.powerUntil;
    this.poweredFlag = s.powered;
    this.towed = s.towed;
    this.graceUntil = s.graceUntil;
    this.passedId = s.passedId;
    this.passed = s.passed;
    this.phase = s.phase;
    this.fuelCollected = s.fuelCollected;
    this.pickupsTaken = s.pickupsTaken;
    this.smashed = s.smashed;
    this.deathTick = s.deathTick;
  }
}

// ── sim/match.ts ─────────────────────────────────────────────────────────────
// Partida do jetpack para 1 a 4 jogadores (mm3d-21). Um percurso (track.ts),
// um jogador por vaga (runner.ts), todos largando no mesmo passo.
//
// Grupo (2+): a velocidade horizontal não depende do botão, só da distância e
// do turbo — o turbo é a única coisa que separa os jogadores. Quem fica mais
// de PARTY.maxSpread atrás do líder é REBOCADO na borda (continua na tela,
// imune a obstáculo; chão e teto ainda matam) e ganha PARTY.towGrace de
// imunidade ao soltar. Quem está na frente sem turbo voa a PARTY.regroup até
// a coluna se refazer. Cápsula: leva quem toca primeiro (maior x; empate →
// menor vaga). Peça quebrada some para todos.
//
// Sozinho, é exatamente o jogo do mm3d-20 (fixture de ouro no backend).
//
// Ordem do passo: 1 movimento (com reagrupar) → 2 reboque → 3 coleta →
// 4 fim do turbo → 5 colisão → 6 "passou" → 7 pista (gera à frente do líder,
// recicla atrás da rabeira).
//
// Só TypeScript que pode ser apagado: o teste do backend carrega este arquivo
// direto e compara, passo a passo, com o espelho em JS.

const PARTY = {
  max: 4,
  /** m atrás do líder antes do reboque. */
  maxSpread: 4.5,
  /** Velocidade de quem está na frente sem turbo, até a coluna se refazer. */
  regroup: 0.85,
  /** s de imunidade a obstáculo ao sair do reboque. */
  towGrace: 0.6,
  /** Altura de largada por vaga (em grupo). */
  startY: [6.5, 7.7, 5.3, 8.9],
  lobbyMs: 20000,
  relobbyMs: 15000,
  countdownMs: 3000,
  resultsMs: 8000,
}         ;

                                                      

                            
               
                
                   
                    
 

                               
                                                                                                              
                        
 

class Match {
           tune        ;
           track       ;
  /** Índice = vaga 0..3 (null = vaga vazia). */
           runners                   ;
           slots          ;
  ticks = 0;
  started = false;
                   startOnHold         ;
                   group         ;
          order           = [];

  constructor(seed        , slots                   , tune         = TUNING, opts               = {}) {
    this.tune = tune;
    this.track = new Track(seed, tune);
    this.slots = [...slots].sort((a, b) => a - b);
    this.group = this.slots.length > 1;
    this.startOnHold = opts.startOnHold ?? false;
    this.runners = [null, null, null, null];
    for (const s of this.slots) this.runners[s] = new Runner(tune, this.group ? PARTY.startY[s] : tune.startY);
  }

  get seed() {
    return this.track.seed;
  }

  /** Largada (todos no mesmo passo). */
  start() {
    if (this.started) return;
    this.started = true;
    for (const s of this.slots) this.runners[s] .start();
  }

          alive()           {
    const out           = [];
    for (const s of this.slots) {
      const r = this.runners[s] ;
      if (r.alive) out.push(r);
    }
    return out;
  }

  aliveCount() {
    return this.alive().length;
  }

  /** x do vivo mais à frente (sem vivos: de todos). */
  leaderX() {
    const a = this.alive();
    const list = a.length ? a : this.slots.map((s) => this.runners[s] );
    let m = -Infinity;
    for (const r of list) if (r.x > m) m = r.x;
    return m;
  }

  /** x do vivo mais atrás (sem vivos: de todos). */
  tailX() {
    const a = this.alive();
    const list = a.length ? a : this.slots.map((s) => this.runners[s] );
    let m = Infinity;
    for (const r of list) if (r.x < m) m = r.x;
    return m;
  }

  /** Um passo fixo. `held[vaga]`: segurando. */
  step(held                    ) {
    if (!this.started) {
      if (!this.startOnHold || !this.slots.some((s) => held[s])) return;
      this.start();
    }
    if (this.aliveCount() === 0) return;
    const tune = this.tune;
    this.ticks++;
    this.track.setTick(this.ticks);
    const t = this.track.t;

    // 1. movimento (em grupo, quem está na frente sem turbo reagrupa)
    const tail = this.tailX();
    for (const s of this.slots) {
      const r = this.runners[s] ;
      if (!r.alive) continue;
      const scale = this.group && !r.poweredAt(t) && r.x > tail + 0.02 ? PARTY.regroup : 1;
      r.move(!!held[s], t, scale);
    }

    // 2. reboque
    if (this.group) {
      const edge = this.leaderX() - PARTY.maxSpread;
      for (const r of this.alive()) {
        if (r.x < edge) {
          r.x = edge;
          r.towed = true;
        } else if (r.towed) {
          r.towed = false;
          r.graceUntil = t + PARTY.towGrace;
        }
      }
    }

    // 3. coleta: quem está mais à frente primeiro (empate → menor vaga)
    const order = this.order;
    order.length = 0;
    for (const s of this.slots) {
      const r = this.runners[s] ;
      if (r.alive) order.push(r);
    }
    if (order.length > 1) order.sort((a, b) => b.x - a.x || this.runners.indexOf(a) - this.runners.indexOf(b));
    for (const r of order) r.collect(this.track, t);

    // 4. fim do turbo
    for (const r of order) r.checkPowerEnd(t);

    // 5. colisão
    for (const r of order) {
      const cause = r.collide(this.track, t);
      if (cause) r.die(cause, this.ticks);
    }

    // 6–7. "passou" e pista (só se alguém segue vivo)
    const alive = this.alive();
    if (!alive.length) return;
    for (const r of alive) r.countPassed(this.track);
    this.track.recycleBehind(this.tailX() - 14);
    this.track.fillTo(this.leaderX() + tune.lookahead);
  }

  drain()               {
    const out               = [];
    for (const s of this.slots) for (const e of this.runners[s] .drain()) out.push({ ...e, slot: s });
    return out;
  }

  /**
   * Colocação: quem segue vivo na frente (por distância), depois por ordem de
   * morte (morreu depois = melhor); no mesmo passo, maior distância; empate
   * total = mesma posição.
   */
  placements()              {
    const rows = this.slots.map((s) => {
      const r = this.runners[s] ;
      return { slot: s, distance: r.distance, deathTick: r.alive ? Infinity : r.deathTick };
    });
    rows.sort((a, b) => b.deathTick - a.deathTick || b.distance - a.distance || a.slot - b.slot);
    const out              = [];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const prev = out[i - 1];
      const tie = i > 0 && rows[i - 1].deathTick === row.deathTick && rows[i - 1].distance === row.distance;
      out.push({
        slot: row.slot,
        place: tie ? prev.place : i + 1,
        distance: row.distance,
        deathTick: row.deathTick === Infinity ? 0 : row.deathTick,
      });
    }
    return out;
  }
}

// ── sim/world.ts ─────────────────────────────────────────────────────────────
// Partida de UMA pessoa, com a API de sempre (game.ts e autopilot.ts não
// mudam). Desde o mm3d-21 é um invólucro de Match com uma vaga: a regra mora
// em track.ts (percurso), runner.ts (jogador) e match.ts (ordem do passo).
// O fixture de ouro no backend garante que o jogo sozinho é o do mm3d-20.
//
// Sem Three.js nem DOM: roda igual no navegador e nos testes. Avança sempre em
// passos fixos (tune.step); quem chama acumula o tempo real do quadro e chama
// step() quantas vezes precisar.

class World {
           tune        ;
          match        ;
          me         ;

  constructor(seed        , tune         = TUNING) {
    this.tune = tune;
    this.reset(seed);
  }

  reset(seed        ) {
    this.match = new Match(seed, [0], this.tune, { startOnHold: true });
    this.me = this.match.runners[0] ;
  }

  step(held         ) {
    this.match.step([held]);
  }

  drain() {
    return this.me.drain();
  }

  get seed() {
    return this.match.seed;
  }
  get fuel() {
    return this.me.fuel;
  }
  get state() {
    return this.me.state;
  }
  /** Tempo de jogo (s) desde o primeiro toque. */
  get t() {
    return this.match.track.t;
  }
  get ticks() {
    return this.match.ticks;
  }
  get x() {
    return this.me.x;
  }
  get y() {
    return this.me.y;
  }
  get vy() {
    return this.me.vy;
  }
  get speed() {
    return this.me.speed;
  }
  get thrusting() {
    return this.me.thrusting;
  }
  get fuelCollected() {
    return this.me.fuelCollected;
  }
  get pickupsTaken() {
    return this.me.pickupsTaken;
  }
  get passed() {
    return this.me.passed;
  }
  get phase() {
    return this.me.phase;
  }
  get smashed() {
    return this.me.smashed;
  }
  /** Fim do turbo (tempo de jogo, s). */
  get powerUntil() {
    return this.me.powerUntil;
  }
  get obstacles() {
    return this.match.track.obstacles;
  }
  get pickups() {
    return this.match.track.pickups;
  }
  get distance() {
    return this.me.distance;
  }
  get alive() {
    return this.me.alive;
  }
  /** Turbo ativo: bater num obstáculo quebra a peça em vez de matar. */
  get powered() {
    return this.me.poweredAt(this.t);
  }
  /** Segundos de turbo restantes. */
  get powerLeft() {
    return Math.max(0, this.me.powerUntil - this.t);
  }
}

// ── sim/autopilot.ts ─────────────────────────────────────────────────────────
// Piloto automático simples (liga/desliga com previsão). Serve de prova nos
// testes de que o gerador só cria percursos possíveis: se um controlador tão
// simples sobrevive milhares de metros em várias seeds, um humano também pode.

function autopilot(w       )          {
  if (w.state === 'ready') return true; // primeiro toque
  const tune = w.tune;
  const half = tune.hitW / 2;
  // Obstáculo atual (em cima dele) ou o próximo à frente.
  const next = w.obstacles.find((o) => o.x + o.w + half > w.x);
  let target = tune.startY;
  if (next) {
    const arrive = w.t + Math.max(0, next.x - half - w.x) / w.speed;
    target = pathAt(next, Math.max(w.t, arrive));
    // Cápsula no caminho antes do obstáculo, se der para pegar sem desviar muito.
    const p = w.pickups.find((k) => !k.taken && k.x > w.x && k.x < next.x);
    if (p && w.fuel.ratio < 0.9) {
      const now = maxShift(p.x - w.x - half, w.speed, tune, 1);
      const after = maxShift(next.x - p.x - half, w.speed, tune, 1);
      if (Math.abs(p.y - w.y) < now && Math.abs(p.y - target) + (next.kind === 'beam' ? 0 : next.amp) < after) target = p.y;
    }
  }
  // Onde para se mudar o comando agora (distância de frenagem).
  if (w.vy < 0) return w.y - (w.vy * w.vy) / (2 * (tune.thrust - tune.gravity)) - 0.1 < target;
  return w.y + (w.vy * w.vy) / (2 * tune.gravity) + 0.1 < target;
}

module.exports = { Rng, randomSeed, MAX_SPEED, phaseOf, difficultyAt, TUNING, FuelSystem, reach, maxShift, offsetAt, pathAt, VULCAN_EVERY, vulcanGapAfterTaken, distanceIn, obstacleRects, Generator, Track, Runner, PARTY, Match, World, autopilot };
