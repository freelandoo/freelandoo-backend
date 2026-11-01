// src/realtime/meuMundoTestBots.js — TESTE DE CARGA do Meu Mundo (2026-11-01).
//
// Pedido do Alex: robôs com TODAS as skins andando ao mesmo tempo nos bairros
// e no centro (ele joga com a vampira adulta, que fica de fora), e todos os
// monstros na rua a qualquer hora — até ele mandar voltar ao normal.
//
// Liga com a variável de ambiente MM_TEST_BOTS=1 (Railway); tirar a variável
// (ou 0) e reiniciar = normal. Nada vai para o banco: os robôs só existem no
// estado da sala (chave "bot-<corpo>"), andam pela mesma física de quem joga
// (`step`) e escolhem destinos entre os pontos livres do diretor de monstros.

const BOT_BODIES = Object.freeze([
  ["normal", "Padrão"],
  ["slim", "Magro"],
  ["fat", "Gordo"],
  ["strong", "Forte"],
  ["sergio", "Sergio"],
  ["female", "Menina"],
  ["ekaterina", "Ekaterina"],
  ["aurion", "Aurion"],
  ["morkhan", "Morkhan"],
  ["kragor", "Kragor"],
  ["zephyra", "Zephyra"],
  ["maru", "Maru"],
  ["iris", "Iris"],
  ["noctis", "Noctis"],
  ["aeryn", "Aeryn"],
  ["ciborgue", "Ciborgue"],
  ["cavaleiro", "Cavaleiro"],
  ["golem", "Golem"],
  ["garras", "Garras"],
  ["raposa", "Raposa"],
  ["raposa_f", "Raposa (menina)"],
  ["raposa_adulto", "Raposa adulto"],
  ["raposa_adulta", "Raposa adulta"],
  ["vampiro", "Vampiro"],
  ["vampira", "Vampira"],
  ["vampiro_adulto", "Vampiro adulto"],
]);

const testBotsOn = () => process.env.MM_TEST_BOTS === "1";

class TestBots {
  /**
   * @param {object} room  BairroRoom/CentroRoom (state.players, obstacles, limit, mobDirector)
   * @param {object} deps  { Player, step }
   */
  constructor(room, { Player, step }) {
    this.room = room;
    this.step = step;
    this.Player = Player;
    this.rng = Math.random;
    this.bots = [];
    const spots = room.mobDirector.spots();
    BOT_BODIES.forEach(([body, name], i) => {
      const at = spots.length ? spots[Math.floor(this.rng() * spots.length)] : { x: (i % 6) * 2 - 5, z: Math.floor(i / 6) * 2 - 4 };
      const key = `bot-${body}`;
      const b = { key, body: { x: at.x, z: at.z, vx: 0, vz: 0, facing: 0 }, target: null, run: false, lastD: Infinity, stuck: 0, pause: this.rng() * 2 };
      room.state.players.set(
        key,
        new Player({ name: `Robô ${name}`, house: 0, body, look: "", x: at.x, z: at.z, facing: 0, move: 0, car: 0, pace: 1, st: 100, wd: false, sk: false })
      );
      this.bots.push(b);
    });
  }

  pick(b) {
    const spots = this.room.mobDirector.spots();
    b.target = spots.length ? spots[Math.floor(this.rng() * spots.length)] : { x: 0, z: 0 };
    b.run = this.rng() < 0.3;
    b.lastD = Infinity;
    b.stuck = 0;
  }

  tick(dt) {
    const room = this.room;
    for (const b of this.bots) {
      const p = room.state.players.get(b.key);
      if (!p) continue;
      let intent = { x: 0, z: 0, run: false };
      if (b.pause > 0) {
        b.pause -= dt;
      } else {
        if (!b.target) this.pick(b);
        const dx = b.target.x - b.body.x;
        const dz = b.target.z - b.body.z;
        const d = Math.hypot(dx, dz);
        if (d < 1.2) {
          b.target = null;
          b.pause = 1 + this.rng() * 4;
        } else {
          // Sem avançar por 2 s (parede no caminho): outro destino.
          b.stuck = d < b.lastD - 0.05 ? 0 : b.stuck + dt;
          b.lastD = Math.min(b.lastD, d);
          if (b.stuck > 2) b.target = null;
          else intent = { x: dx / d, z: dz / d, run: b.run };
        }
      }
      const move = this.step(b.body, intent, dt, room.obstacles, room.limit);
      p.x = b.body.x;
      p.z = b.body.z;
      p.facing = b.body.facing;
      p.move = move;
    }
  }
}

module.exports = { TestBots, testBotsOn, BOT_BODIES };
