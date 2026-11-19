// missions.js — the work that pays. Sol Ferreira runs Ferreira Motors and a
// quieter business out the back: five story jobs for Rio (a package run, a
// stolen coupe, a coast-road checkpoint race, losing the police, and one big
// drop), each with her dialogue, on-screen objectives, timers where they bite,
// cash rewards, and — once the story is done — endless odd jobs off the board.
// The class is a state machine; main.js feeds it the player's situation each
// frame and carries out the events it emits (spawn the marked car, set heat).

const SOL = 'Sol Ferreira';
const RIO = 'Rio';

export const STORY = [
  {
    id: 'first-run', name: 'First Run', reward: 300,
    intro: [
      { name: SOL, text: 'Rio Calloway. Heard you can drive and keep your mouth shut. Around here that makes you employable.' },
      { name: SOL, text: 'Easy first run. My nephew left a crate at the promenade food stands — pick it up, take it to the Grand Marisol, smile at nobody.' },
      { name: RIO, text: 'And the pay?' },
      { name: SOL, text: 'Three hundred, and my continued faith in you. Both spend well in this town.' },
    ],
    stages: [
      { type: 'goto', x: 60, z: 132, label: 'Pick up the crate at the promenade stands' },
      { type: 'goto', x: -8, z: -34, label: 'Deliver the crate to the Grand Marisol' },
    ],
    outro: [
      { name: SOL, text: 'On time and in one piece. You would be amazed how rare that is. Come back — I have something with wheels.' },
    ],
  },
  {
    id: 'hot-wheels', name: 'Hot Wheels', reward: 650,
    intro: [
      { name: SOL, text: 'A collector from upstate wants a particular coupe. Red, loud, parks along the north avenue like it owns the street.' },
      { name: SOL, text: 'It does not. You do, briefly. Bring it to my garage door — and Rio, the owner will call the police. Owners always call the police.' },
    ],
    stages: [
      { type: 'steal', x: 26, z: -150, label: 'Steal the marked red coupe on the north avenue' },
      { type: 'goto', x: -102, z: 60, r: 8, needsCar: true, label: 'Deliver the coupe to Ferreira Motors' },
    ],
    outro: [
      { name: SOL, text: 'Beautiful. The collector wires the money, you get your cut, and that car never existed. Next job is faster.' },
    ],
  },
  {
    id: 'beach-run', name: 'Beach Run', reward: 800,
    intro: [
      { name: SOL, text: 'My niece swears nobody can run the coast road end to end under her time. Family honour, Rio. Hit every checkpoint before the clock dies.' },
    ],
    stages: [
      {
        type: 'checkpoints', time: 80, label: 'Run the coast road checkpoints',
        points: [
          { x: -120, z: 150 }, { x: -60, z: 150 }, { x: 0, z: 150 },
          { x: 60, z: 150 }, { x: 120, z: 150 }, { x: 152, z: 120 },
        ],
      },
    ],
    outro: [
      { name: SOL, text: 'She is furious. I am delighted. Dinner is on her. Now — a job with consequences.' },
    ],
  },
  {
    id: 'heat', name: 'Heat', reward: 1000,
    intro: [
      { name: SOL, text: 'Listen carefully. A name got sold to Marisol PD and it rhymes with yours. They are already rolling.' },
      { name: SOL, text: 'You have one job: disappear. Break their line of sight, stay clean, and let the heat die. Do not lead them to my door.' },
    ],
    stages: [
      { type: 'evade', time: 170, stars: 3, label: 'Lose the police — break sight and let the stars fade' },
    ],
    outro: [
      { name: SOL, text: 'Ghost. Good. One last job, Rio, and it is the one that makes us both.' },
    ],
  },
  {
    id: 'the-big-drop', name: 'The Big Drop', reward: 1500,
    intro: [
      { name: SOL, text: 'A bag is waiting at the hospital loading bay. It needs to reach a boat at the east beach — fast, and before anyone asks what is in it.' },
      { name: SOL, text: 'Do not open it. Do not stop. The police scanner has been very interested in that hospital all morning.' },
    ],
    stages: [
      { type: 'goto', x: 99, z: -120, label: 'Pick up the bag at Marisol General' },
      { type: 'goto', x: 128, z: 188, label: 'Get the bag to the boat on the east beach', heatOnStart: 2 },
    ],
    outro: [
      { name: SOL, text: 'It is done, and we are both still free and considerably richer. You are family now, Rio.' },
      { name: SOL, text: 'The board by the door has odd jobs if you want pocket money. The city is yours. Try not to give it back to the police.' },
    ],
  },
];

export class Missions {
  constructor(rng) {
    this.rng = rng;
    this.index = 0;               // next story mission
    this.state = 'offer';         // offer | active | done (story finished)
    this.current = null;          // { def, stageIdx, timeLeft, subIdx, heatApplied }
    this.events = [];
    this.oddJob = null;
  }

  get storyDone() { return this.index >= STORY.length; }

  offerTarget(garagePos) {
    if (this.state !== 'offer') return null;
    return { x: garagePos.x, z: garagePos.z, title: this.storyDone ? 'Odd jobs board' : 'Work: ' + STORY[this.index].name };
  }

  // Begin the offered mission (or an odd job). Returns its intro dialogue.
  start() {
    if (this.state !== 'offer') return null;
    let def;
    if (this.storyDone) {
      def = this.makeOddJob();
      this.oddJob = def;
    } else {
      def = STORY[this.index];
    }
    this.current = { def, stageIdx: 0, timeLeft: 0, subIdx: 0, heatApplied: false };
    this.state = 'active';
    this.enterStage();
    return def.intro;
  }

  makeOddJob() {
    const spots = [
      { x: -150, z: -90 }, { x: 90, z: 30 }, { x: -30, z: -150 }, { x: 150, z: 60 },
      { x: 0, z: 132 }, { x: -90, z: 90 }, { x: 128, z: 188 }, { x: 60, z: -90 },
    ];
    const a = spots[this.rng.int(0, spots.length - 1)];
    let b = spots[this.rng.int(0, spots.length - 1)];
    if (b === a) b = spots[(spots.indexOf(a) + 3) % spots.length];
    const dist = Math.hypot(b.x - a.x, b.z - a.z);
    return {
      id: 'odd-job', name: 'Odd Job', reward: Math.round(120 + dist * 1.1),
      intro: [{ name: SOL, text: 'Board job: a pickup, a drop, no questions. The route is on your map.' }],
      stages: [
        { type: 'goto', x: a.x, z: a.z, label: 'Pick up the package' },
        { type: 'goto', x: b.x, z: b.z, label: 'Drop it off' },
      ],
      outro: [{ name: SOL, text: 'Clean work. The board always has more.' }],
    };
  }

  enterStage() {
    const c = this.current;
    const stage = c.def.stages[c.stageIdx];
    c.timeLeft = stage.time ?? 0;
    c.subIdx = 0;
    c.heatApplied = false;
    if (stage.type === 'steal') this.events.push({ type: 'needMarkedCar', x: stage.x, z: stage.z });
    if (stage.heatOnStart) this.events.push({ type: 'setStars', stars: stage.heatOnStart });
    if (stage.type === 'evade') this.events.push({ type: 'setStars', stars: stage.stars ?? 3 });
  }

  objective() {
    if (this.state !== 'active' || !this.current) return null;
    const c = this.current;
    const stage = c.def.stages[c.stageIdx];
    let target = stage;
    if (stage.type === 'checkpoints') target = stage.points[Math.min(c.subIdx, stage.points.length - 1)];
    const timer = (stage.time || stage.type === 'evade') ? Math.max(0, c.timeLeft) : null;
    return {
      title: c.def.name + (stage.type === 'checkpoints' ? ` — checkpoint ${c.subIdx + 1}/${stage.points.length}` : ''),
      text: stage.label,
      target: stage.type === 'evade' ? null : { x: target.x, z: target.z },
      timer,
    };
  }

  // ctx: { x, z, inCar, drivingMarked, wantedStars }
  update(dt, ctx) {
    if (this.state !== 'active' || !this.current) return;
    const c = this.current;
    const stage = c.def.stages[c.stageIdx];
    if (stage.time || stage.type === 'evade') {
      c.timeLeft -= dt;
      if (c.timeLeft <= 0 && stage.type !== 'evade') return this.fail();
    }
    let done = false;
    if (stage.type === 'goto') {
      const d = Math.hypot(ctx.x - stage.x, ctx.z - stage.z);
      done = d < (stage.r ?? 7) && (!stage.needsCar || ctx.inCar);
    } else if (stage.type === 'steal') {
      done = ctx.drivingMarked;
    } else if (stage.type === 'checkpoints') {
      const p = stage.points[c.subIdx];
      if (Math.hypot(ctx.x - p.x, ctx.z - p.z) < 11) {
        c.subIdx++;
        this.events.push({ type: 'checkpoint' });
        done = c.subIdx >= stage.points.length;
      }
    } else if (stage.type === 'evade') {
      done = ctx.wantedStars === 0;
      if (c.timeLeft <= 0 && !done) return this.fail();
    }
    if (done) {
      c.stageIdx++;
      if (c.stageIdx >= c.def.stages.length) this.complete();
      else { this.enterStage(); this.events.push({ type: 'stage' }); }
    }
  }

  complete() {
    const def = this.current.def;
    this.events.push({ type: 'complete', reward: def.reward, name: def.name, outro: def.outro });
    if (!this.storyDone && def.id !== 'odd-job') this.index++;
    this.current = null;
    this.state = 'offer';
  }

  fail() {
    const def = this.current.def;
    this.events.push({ type: 'fail', name: def.name });
    this.current = null;
    this.state = 'offer';
  }
}
