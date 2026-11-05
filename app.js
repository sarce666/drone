/* Drones — application interne.
   Pad 1 (synthèse) : moteur repris du Chromatone Drone (https://github.com/chromatone/drone, MIT) :
   dent de scie → saturation légère → filtre passe-bas auto-modulé → (chorus) → pan/volume
   avec LFO lents sur le panoramique et le volume, enveloppe 2 s d'attaque / 4 s de relâche.
   Pad 2 (harmonium) : samples Freesound (pack 29512, CC0) bouclés avec fondu enchaîné.
   Pad 3 (basse) : un seul sample (Moog long bass, Sample Focus) transposé sur toutes les notes, bouclé de même. */
(() => {
  'use strict';

  const NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const OCTAVES = [5, 4, 3, 2, 1]; // lignes du pad, de haut en bas
  const MIDI_MIN = 24, MIDI_MAX = 83; // C1 … B5
  const STORAGE_KEY = 'drones-app-v1';
  const RELEASE_MS = 4500;
  const SAMPLE_RELEASE_MS = 2200;
  const SAMPLE_GAIN = 1.0;
  const SAMPLE_TARGET_RMS = Math.pow(10, -18 / 20); // niveau tenu visé après normalisation
  const KINDS = ['voices', 'samples', 'bass'];
  const SAMPLED = ['samples', 'bass']; // pads à base de samples (même moteur de bouclage)

  const DEFAULT_SOUND = {
    cutoff: 16000, q: 0,
    afRate: 0.1, afDepth: 0,
    choRate: 0.1, choDepth: 0,
    drive: 0.1, fat: false,
  };
  const DEFAULT_SAMPLE_SOUND = { ...DEFAULT_SOUND, drive: 0, fat: false };
  // Parties d'un morceau, chacune avec son gros bouton en haut. « Drone » couvre synthé et harmonium.
  const PARTS = [
    { id: 'drone', label: 'Drone' },
    { id: 'synth', label: 'Synthé' },
    { id: 'harmonium', label: 'Harmonium' },
    { id: 'bass', label: 'Basse' },
    { id: 'drums', label: 'Batterie' },
  ];
  const synthOn = p => p.parts.drone && p.parts.synth;
  const sampleOn = p => p.parts.drone && p.parts.harmonium;
  const bassOn = p => p.parts.bass; // indépendante de Drone, comme la batterie
  const padOn = { samples: sampleOn, bass: bassOn };
  const drumsOn = p => p.parts.drums;
  const HISTORY_KEY = 'drones-history-v1';
  const HISTORY_MAX = 40;        // versions gardées par morceau
  const HISTORY_GROUP_MS = 4000; // modifications rapprochées = une seule version
  const DEFAULTS = { voices: DEFAULT_SOUND, samples: DEFAULT_SAMPLE_SOUND, bass: DEFAULT_SAMPLE_SOUND };
  const SOUND_KEY = { voices: 'sound', samples: 'sampleSound', bass: 'bassSound' };
  const LEVEL_KEY = { samples: 'sampleLevel', bass: 'bassLevel' };

  const SOUND_PARAMS = [
    { key: 'cutoff', label: 'Brillance (filtre)', min: 100, max: 16000, log: true, fmt: v => Math.round(v) + ' Hz' },
    { key: 'q', label: 'Résonance', min: 0, max: 20, fmt: v => v.toFixed(1) },
    { key: 'afRate', label: 'Filtre auto — vitesse', min: 0.1, max: 10, log: true, fmt: v => v.toFixed(2) + ' Hz' },
    { key: 'afDepth', label: 'Filtre auto — profondeur', min: 0, max: 1, fmt: v => Math.round(v * 100) + ' %' },
    { key: 'choRate', label: 'Chorus — vitesse', min: 0.1, max: 10, log: true, fmt: v => v.toFixed(2) + ' Hz' },
    { key: 'choDepth', label: 'Chorus — profondeur', min: 0, max: 1, fmt: v => Math.round(v * 100) + ' %' },
    { key: 'drive', label: 'Saturation', min: 0, max: 1, fmt: v => Math.round(v * 100) + ' %' },
  ];

  // ---------- Utilitaires ----------
  const hue = m => ((((m - 69) % 12) + 12) % 12) * 30; // couleurs Chromatone : La = rouge
  const noteName = m => NOTES[m % 12] + (Math.floor(m / 12) - 1);
  const octaveOf = m => Math.floor(m / 12) - 1;
  // Couleur d'un morceau : sa note la plus grave.
  const pieceHue = p => {
    const all = [...Object.keys(p.voices), ...Object.keys(p.samples), ...Object.keys(p.bass)].map(Number);
    return all.length ? hue(Math.min(...all)) : 0;
  };
  const freqOf = m => state.a4 * Math.pow(2, (m - 69) / 12);
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  const $ = sel => document.querySelector(sel);

  const normToVal = (n, min, max, log) => (log ? min * Math.pow(max / min, n) : min + n * (max - min));
  const valToNorm = (v, min, max, log) => (log ? Math.log(v / min) / Math.log(max / min) : (v - min) / (max - min));

  // Banque harmonium : fichiers WAV originaux dans samples/harmonium/, Do2 à Ré5.
  const SAMPLE_DIR = 'samples/harmonium/';
  const SAMPLE_MIN = 36, SAMPLE_MAX = 74;
  const SAMPLE_CACHE = 'drones-samples-v1';
  const useWav = /^https?:$/.test(location.protocol);
  const hasSample = midi => midi >= SAMPLE_MIN && midi <= SAMPLE_MAX;
  const wavUrl = midi => SAMPLE_DIR + noteName(midi).replace('#', 's') + '.wav';
  // Basse : un seul sample, transposé. Sa note de base est détectée au chargement (BASS_ROOT si la détection échoue).
  const BASS_URL = 'samples/bass/bass.wav';
  const BASS_ROOT = 36; // Do2
  // Percussions au tempo : chaque piste a un ou plusieurs sons au choix.
  const PERC = {
    kick: { label: 'Grosse caisse', sounds: [{ id: 'kick5', label: 'Kick 5', url: 'samples/kick/kick5.wav' }] },
    snare: { label: 'Caisse claire', sounds: [{ id: 'birch', label: 'Birch', url: 'samples/snare/birch.wav' }] },
    cymbal: { label: 'Cymbale', sounds: [
      { id: 'crash2', label: 'Crash 2', url: 'samples/cymbal/crash2.wav' },
      { id: 'crash55', label: 'Crash 55', url: 'samples/cymbal/crash55.wav' },
      { id: 'hmk22', label: 'HMK 22', url: 'samples/cymbal/hmk22.wav' },
    ] },
  };
  const PERC_IDS = Object.keys(PERC);
  // Séquenceur : une boucle = `beats` temps × `div` cases par temps (par défaut 4 temps × 2 = 8 cases).
  const DEFAULT_BEATS = 4, MAX_BEATS = 16;
  const DIVS = [1, 2, 3, 4];
  const MAX_LOOPS = 999;
  const stepCount = r => r.beats * r.div;
  // Cases par ligne de grille : tout sur une ligne si ça tient, sinon on passe à la ligne par temps entiers.
  function stepCols(r) {
    const n = stepCount(r), max = window.innerWidth < 600 ? 8 : 16;
    if (n <= max) return n;
    return Math.max(r.div, Math.floor(max / r.div) * r.div);
  }
  // Ancien format « motif » (every/offset en temps) → cases, sur 4 temps × 2.
  function stepsFromPattern(pattern) {
    const m = /^(\d)\/(\d)$/.exec(pattern || '1/0');
    const every = m ? Number(m[1]) : 1, offset = m ? Number(m[2]) : 0;
    return Array.from({ length: DEFAULT_BEATS * 2 }, (_, i) => (i % 2 === 0 && (i / 2) % every === offset) ? 1 : 0);
  }
  // Change la longueur ou la division d'un rythme en gardant les frappes à leur place dans le temps.
  function resizeRhythm(r, beats, div) {
    for (const id of PERC_IDS) {
      const old = r.tracks[id].steps, next = new Array(beats * div).fill(0);
      old.forEach((v, i) => {
        const j = i / r.div * div; // position en temps → nouvel index
        if (v && Number.isInteger(j) && j < next.length) next[j] = 1;
      });
      r.tracks[id].steps = next;
    }
    r.beats = beats;
    r.div = div;
  }
  const percUrls = () => PERC_IDS.flatMap(id => PERC[id].sounds.map(sd => sd.url));
  const allSampleUrls = () => [...Array.from({ length: SAMPLE_MAX - SAMPLE_MIN + 1 }, (_, i) => wavUrl(SAMPLE_MIN + i)), BASS_URL, ...percUrls()];

  // ---------- État ----------
  let state = load();

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return normalize(JSON.parse(raw));
    } catch (e) { console.warn('Lecture impossible', e); }
    return normalize({});
  }

  function normalize(s) {
    const out = {
      a4: clamp(Number(s.a4) || 440, 400, 480),
      master: clamp(Number(s.master ?? 0.5), 0, 1),
      pieces: Array.isArray(s.pieces) ? s.pieces.map(normalizePiece) : [],
      deleted: (s.deleted && typeof s.deleted === 'object') ? s.deleted : {}, // id → date de suppression
      currentId: s.currentId || null,
    };
    if (!out.pieces.find(p => p.id === out.currentId)) out.currentId = out.pieces[0]?.id || null;
    return out;
  }

  function normalizeVoices(src, filter) {
    const out = {};
    for (const [k, v] of Object.entries(src || {})) {
      const midi = Number(k);
      if (Number.isInteger(midi) && midi >= MIDI_MIN && midi <= MIDI_MAX && filter(midi)) out[midi] = { vol: clamp(Number(v?.vol ?? 0.8), 0.01, 1) };
    }
    return out;
  }

  // p.kick est l'ancien format (grosse caisse seule) ; on le reprend dans rhythm.
  function normalizeRhythm(r, legacyKick) {
    const src = r || { bpm: legacyKick?.bpm, tracks: legacyKick ? { kick: { on: legacyKick.on, level: legacyKick.level } } : {} };
    const beats = clamp(Math.round(Number(src.beats) || DEFAULT_BEATS), 1, MAX_BEATS);
    const div = DIVS.includes(Number(src.div)) ? Number(src.div) : 2;
    const tracks = {};
    for (const id of PERC_IDS) {
      const t = src.tracks?.[id] || {};
      tracks[id] = {
        on: !!t.on,
        level: clamp(Number(t.level ?? 0.8), 0, 4),
        sound: PERC[id].sounds.some(sd => sd.id === t.sound) ? t.sound : PERC[id].sounds[0].id,
        steps: Array.isArray(t.steps)
          ? Array.from({ length: beats * div }, (_, i) => t.steps[i] ? 1 : 0)
          : stepsFromPattern(t.pattern).slice(0, beats * div),
      };
    }
    return {
      bpm: clamp(Math.round(Number(src.bpm) || 80), 30, 240),
      loops: clamp(Math.round(Number(src.loops) || 0), 0, MAX_LOOPS), // 0 = à l'infini
      beats, div, tracks,
    };
  }

  // p.mode est l'ancien format (synthé seul / les deux / harmonium seul).
  function normalizeParts(parts, legacyMode) {
    const src = parts || { drone: true, synth: legacyMode !== 'samples', harmonium: legacyMode !== 'voices', drums: true };
    const out = {};
    for (const part of PARTS) out[part.id] = src[part.id] !== false;
    return out;
  }

  function normalizePiece(p) {
    return {
      id: p.id || uid(),
      name: String(p.name || 'Sans titre'),
      voices: normalizeVoices(p.voices, () => true),
      samples: normalizeVoices(p.samples, hasSample),
      bass: normalizeVoices(p.bass, () => true),
      synthLevel: clamp(Number(p.synthLevel ?? 0.5), 0, 2),   // gain linéaire ; -6 dB par défaut
      sampleLevel: clamp(Number(p.sampleLevel ?? 1), 0, 4),
      bassLevel: clamp(Number(p.bassLevel ?? 1), 0, 4),
      parts: normalizeParts(p.parts, p.mode),
      rhythm: normalizeRhythm(p.rhythm, p.kick),
      sound: { ...DEFAULT_SOUND, ...(p.sound || {}) },
      sampleSound: { ...DEFAULT_SAMPLE_SOUND, ...(p.sampleSound || {}) },
      bassSound: { ...DEFAULT_SAMPLE_SOUND, ...(p.bassSound || {}) },
      updatedAt: Number(p.updatedAt) || 0,
    };
  }

  // Empreinte d'un morceau (hors horodatage) pour détecter ce qui a changé.
  const pieceHash = p => JSON.stringify({ ...p, updatedAt: 0 });
  const hashes = new Map(state.pieces.map(p => [p.id, pieceHash(p)]));

  let saveTimer = null;
  function save(immediate) {
    clearTimeout(saveTimer);
    const doSave = () => {
      let changed = false;
      for (const p of state.pieces) {
        const h = pieceHash(p);
        if (hashes.get(p.id) !== h) { hashes.set(p.id, h); p.updatedAt = Date.now(); changed = true; history.record(p); }
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      if (changed) sync.schedule();
      const el = $('#saved');
      el.classList.add('show');
      clearTimeout(el._t);
      el._t = setTimeout(() => el.classList.remove('show'), 1200);
    };
    if (immediate) doSave(); else saveTimer = setTimeout(doSave, 250);
  }

  const cur = () => state.pieces.find(p => p.id === state.currentId) || null;

  // ---------- Versions : historique local de chaque morceau ----------
  // Chaque enregistrement d'un morceau modifié ajoute une version (les modifications à moins de
  // HISTORY_GROUP_MS d'intervalle sont regroupées). Annuler / Rétablir se déplacent dans cette liste ;
  // restaurer une version ne crée pas de nouvelle version. Gardé sur l'appareil, pas synchronisé.
  const history = {
    data: (() => { try { return JSON.parse(localStorage.getItem(HISTORY_KEY)) || {}; } catch { return {}; } })(),
    pos: {},          // id → index de la version affichée (undefined = la dernière)
    restoring: false, // évite d'enregistrer une version pendant une restauration
    open: false,      // état du panneau « Versions »

    list(p) { return this.data[p.id] || (this.data[p.id] = []); },
    persist() {
      try { localStorage.setItem(HISTORY_KEY, JSON.stringify(this.data)); } catch (e) { console.warn('Historique non enregistré', e); }
    },
    snap(p) { return JSON.parse(JSON.stringify({ ...p, updatedAt: 0 })); },

    record(p) {
      if (this.restoring) return;
      const list = this.list(p);
      const pos = this.pos[p.id];
      if (pos !== undefined && pos < list.length - 1) list.splice(pos + 1); // on repart d'une ancienne version : la suite est abandonnée
      delete this.pos[p.id];
      const now = Date.now(), last = list[list.length - 1];
      const snap = this.snap(p);
      if (last && JSON.stringify(last.snap) === JSON.stringify(snap)) return;
      if (last && now - last.at < HISTORY_GROUP_MS && list.length > 1) { last.at = now; last.snap = snap; }
      else list.push({ at: now, snap });
      while (list.length > HISTORY_MAX) list.shift();
      this.persist();
    },

    index(p) { const list = this.list(p); return this.pos[p.id] ?? list.length - 1; },

    info(p) {
      const list = this.list(p), idx = this.index(p);
      return {
        canUndo: idx > 0,
        canRedo: idx < list.length - 1,
        list: list.map((v, i) => ({ index: i, current: i === idx, when: fmtWhen(v.at), what: describe(v.snap) })).reverse(),
      };
    },

    restore(p, index) {
      const list = this.list(p);
      const v = list[index];
      if (!v) return;
      this.restoring = true;
      try {
        const fresh = normalizePiece({ ...JSON.parse(JSON.stringify(v.snap)), id: p.id });
        Object.assign(p, fresh);
        this.pos[p.id] = index;
        commit();
      } finally { this.restoring = false; }
    },
    undo(p) { const i = this.index(p); if (i > 0) this.restore(p, i - 1); },
    redo(p) { const i = this.index(p); if (i < this.list(p).length - 1) this.restore(p, i + 1); },
    forget(id) { delete this.data[id]; delete this.pos[id]; this.persist(); },
    // Les morceaux sans historique (anciens, ou arrivés par la synchronisation) partent de leur état actuel.
    seed() {
      let added = false;
      for (const p of state.pieces) {
        if (this.list(p).length) continue;
        this.list(p).push({ at: p.updatedAt || Date.now(), snap: this.snap(p) });
        added = true;
      }
      if (added) this.persist();
    },
  };
  history.seed();

  function fmtWhen(t) {
    const d = new Date(t), today = new Date();
    const time = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    return d.toDateString() === today.toDateString() ? time : d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) + ' ' + time;
  }

  // Résumé d'une version pour la liste.
  function describe(s) {
    const n = Object.keys(s.voices || {}).length + Object.keys(s.samples || {}).length + Object.keys(s.bass || {}).length;
    const parts = PARTS.filter(part => s.parts?.[part.id] === false).map(part => part.label.toLowerCase());
    const drums = PERC_IDS.filter(id => s.rhythm?.tracks?.[id]?.on).length;
    const bits = [`${n} ${n > 1 ? 'notes' : 'note'}`, `${s.rhythm?.bpm ?? '?'} BPM`];
    if (drums) bits.push(`${drums} perc.`);
    if (parts.length) bits.push('sans ' + parts.join(', '));
    if (s.name) bits.unshift(s.name);
    return bits.join(' · ');
  }

  // ---------- Samples : chargement et bouclage ----------
  const sampleBuffers = new Map(); // midi → Promise<{ buffer, loopStart, loopEnd }>
  const FADE_N = 64;
  const FADE_IN = new Float32Array(FADE_N).map((_, i) => Math.sin((i / (FADE_N - 1)) * Math.PI / 2));
  const FADE_OUT = new Float32Array(FADE_N).map((_, i) => Math.cos((i / (FADE_N - 1)) * Math.PI / 2));

  function loadSample(midi) {
    if (!sampleBuffers.has(midi)) {
      const p = (async () => {
        const r = await fetch(wavUrl(midi));
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const bytes = await r.arrayBuffer();
        const ctx = Tone.getContext().rawContext;
        const buffer = await new Promise((res, rej) => ctx.decodeAudioData(bytes, res, rej));
        updateCacheStatus();
        return { buffer, ...findLoop(buffer) };
      })();
      sampleBuffers.set(midi, p);
      p.catch(() => sampleBuffers.delete(midi));
    }
    return sampleBuffers.get(midi);
  }

  // Basse : un seul fichier pour toutes les notes. Chargé une fois ; root = note de base détectée.
  let bassBuffer = null;
  function loadBass() {
    if (!bassBuffer) {
      bassBuffer = (async () => {
        const r = await fetch(BASS_URL);
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const bytes = await r.arrayBuffer();
        const ctx = Tone.getContext().rawContext;
        const buffer = await new Promise((res, rej) => ctx.decodeAudioData(bytes, res, rej));
        updateCacheStatus();
        const loop = findLoop(buffer);
        const root = detectRoot(buffer, loop.loopStart, loop.loopEnd) ?? BASS_ROOT;
        console.info('Basse : note de base', noteName(root));
        return { buffer, ...loop, root };
      })();
      bassBuffer.catch(() => { bassBuffer = null; });
    }
    return bassBuffer;
  }
  const loaderFor = { samples: midi => loadSample(midi), bass: () => loadBass() };

  // Hauteur d'un sample tenu, par autocorrélation sur sa zone tenue → note MIDI (null si rien de net).
  function detectRoot(buffer, loopStart, loopEnd) {
    const sr = buffer.sampleRate, data = buffer.getChannelData(0);
    const start = Math.floor(((loopStart + loopEnd) / 2) * sr);
    const n = Math.min(Math.floor(sr * 0.4), data.length - start);
    const minLag = Math.floor(sr / 1000), maxLag = Math.floor(sr / 25); // 25 Hz … 1 kHz
    if (n < maxLag * 2) return null;
    const seg = data.subarray(start, start + n);
    const len = n - maxLag;
    let e0 = 0;
    for (let i = 0; i < len; i++) e0 += seg[i] * seg[i];
    const corr = new Float32Array(maxLag + 1);
    for (let lag = minLag; lag <= maxLag; lag++) {
      let sum = 0, e1 = 0;
      for (let i = 0; i < len; i++) { sum += seg[i] * seg[i + lag]; e1 += seg[i + lag] * seg[i + lag]; }
      corr[lag] = sum / Math.sqrt(e0 * e1 || 1);
    }
    let best = 0;
    for (let lag = minLag; lag <= maxLag; lag++) best = Math.max(best, corr[lag]);
    if (best < 0.5) return null;
    // Premier pic franc (≥ 90 % du meilleur) : la période fondamentale, pas un multiple.
    let lag = minLag;
    while (lag <= maxLag && !(corr[lag] >= best * 0.9 && corr[lag] >= corr[lag - 1] && corr[lag] >= corr[lag + 1])) lag++;
    if (lag > maxLag) return null;
    const a = corr[lag - 1], b = corr[lag], c = corr[lag + 1];
    const shift = (a - c) / (2 * (a - 2 * b + c) || 1);
    const freq = sr / (lag + shift);
    return clamp(Math.round(69 + 12 * Math.log2(freq / 440)), 0, 127);
  }

  // Trouve la zone tenue du son (après l'attaque, avant la chute) pour y boucler.
  function findLoop(buffer) {
    const data = buffer.getChannelData(0);
    const win = Math.floor(buffer.sampleRate * 0.05);
    const rms = [];
    for (let i = 0; i + win <= data.length; i += win) {
      let s = 0;
      for (let j = i; j < i + win; j++) s += data[j] * data[j];
      rms.push(Math.sqrt(s / win));
    }
    const peak = Math.max(...rms);
    const thr = peak * 0.5;
    let first = rms.findIndex(v => v > thr);
    let last = rms.length - 1;
    while (last > 0 && rms[last] < thr) last--;
    const dur = buffer.duration;
    let loopStart = (first * 0.05) + 0.4;
    let loopEnd = (last * 0.05) - 0.2;
    if (loopEnd - loopStart < 1.5) { loopStart = dur * 0.2; loopEnd = dur * 0.8; }
    loopStart = clamp(loopStart, 0, dur); loopEnd = clamp(loopEnd, 0, dur);
    // Niveau tenu réel → gain de normalisation (les fichiers varient de 6 dB entre eux).
    const a = Math.floor(loopStart * buffer.sampleRate), b = Math.floor(loopEnd * buffer.sampleRate);
    let sum = 0;
    for (let i = a; i < b; i++) sum += data[i] * data[i];
    const sustainRms = Math.sqrt(sum / Math.max(1, b - a));
    const norm = clamp(SAMPLE_TARGET_RMS / (sustainRms || 1), 0.25, 4);
    return { loopStart, loopEnd, norm };
  }

  class SampleVoice {
    constructor(kind, midi, data, vol) {
      this.kind = kind;
      this.midi = midi;
      this.data = data;
      // Transposition : les samples harmonium sont déjà à la bonne hauteur ; la basse part de sa note de base.
      this.base = data.root != null ? Math.pow(2, (midi - data.root) / 12) : 1;
      this.ctx = Tone.getContext().rawContext;
      this.out = this.ctx.createGain();
      this.out.gain.value = 0;
      this.meter = new Tone.Meter({ normalRange: true, smoothing: 0.85 });
      Tone.connect(this.out, engine.fx[kind].dist);
      Tone.connect(this.out, this.meter);
      this.sources = new Set();
      this.first = true;
      this.next = this.ctx.currentTime + 0.05;
      const t = this.ctx.currentTime;
      this.out.gain.setValueAtTime(0, t);
      this.out.gain.linearRampToValueAtTime(vol * SAMPLE_GAIN * data.norm, t + 1);
      this.schedule();
      this.timer = setInterval(() => this.schedule(), 400);
    }

    // Enchaîne des segments de la zone tenue avec fondu enchaîné : boucle sans clic.
    schedule() {
      const { loopStart, loopEnd, buffer } = this.data;
      const rate = this.base * state.a4 / 440;
      while (this.next < this.ctx.currentTime + 1.5) {
        const offset = this.first ? 0 : loopStart;
        const len = (loopEnd - offset) / rate;
        const xf = Math.min(1.2, (loopEnd - loopStart) / rate / 3);
        const t = this.next;
        const src = this.ctx.createBufferSource();
        src.buffer = buffer;
        src.playbackRate.value = rate;
        const g = this.ctx.createGain();
        if (this.first) g.gain.setValueAtTime(1, t);
        else { g.gain.setValueAtTime(0, t); g.gain.setValueCurveAtTime(FADE_IN, t, xf); }
        g.gain.setValueAtTime(1, t + len - xf);
        g.gain.setValueCurveAtTime(FADE_OUT, t + len - xf, xf);
        src.connect(g).connect(this.out);
        src.start(t, offset);
        src.stop(t + len + 0.05);
        src.onended = () => { this.sources.delete(src); g.disconnect(); };
        this.sources.add(src);
        this.next = t + len - xf;
        this.first = false;
      }
    }

    setVolume(vol) {
      this.out.gain.setTargetAtTime(vol * SAMPLE_GAIN * this.data.norm, this.ctx.currentTime, 0.1);
    }

    retune() {
      const rate = this.base * state.a4 / 440;
      for (const s of this.sources) s.playbackRate.setTargetAtTime(rate, this.ctx.currentTime, 0.1);
    }

    stop() {
      clearInterval(this.timer);
      const t = this.ctx.currentTime;
      this.out.gain.cancelScheduledValues(t);
      this.out.gain.setValueAtTime(this.out.gain.value, t);
      this.out.gain.linearRampToValueAtTime(0, t + SAMPLE_RELEASE_MS / 1000 - 0.2);
      setTimeout(() => {
        for (const s of this.sources) { try { s.stop(); } catch (e) { /* ignore */ } }
        this.out.disconnect();
        this.meter.dispose();
      }, SAMPLE_RELEASE_MS);
    }
  }

  // ---------- Rythme : séquenceur à cases ----------
  // Une boucle = beats × div cases. Chaque frappe est planifiée sur l'horloge audio, 200 ms en avance.
  // loops = 0 : à l'infini ; sinon le rythme s'arrête de lui-même après N boucles (le drone continue).
  const rhythm = {
    buffers: new Map(), // url → AudioBuffer
    loading: new Map(),
    running: false, finished: false, pieceId: null,
    bpm: 80, loops: 0, beats: DEFAULT_BEATS, div: 2, step: 0, loop: 0, nextStep: 0, timer: null,
    tracks: {},         // id → { on, level, sound, steps[] }
    gains: {},          // id → GainNode
    onStep: null,       // (step, loop) → affichage
    onEnd: null,        // () → affichage de fin

    get ctx() { return Tone.getContext().rawContext; },

    load(url) {
      if (this.buffers.has(url)) return Promise.resolve(this.buffers.get(url));
      if (!this.loading.has(url)) {
        this.loading.set(url, fetch(url)
          .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.arrayBuffer(); })
          .then(b => new Promise((res, rej) => this.ctx.decodeAudioData(b, res, rej)))
          .then(buf => { this.buffers.set(url, buf); updateCacheStatus(); return buf; })
          .catch(err => { this.loading.delete(url); console.error('Percussion illisible', url, err); throw err; }));
      }
      return this.loading.get(url);
    },

    urlFor(id) { return PERC[id].sounds.find(sd => sd.id === this.tracks[id]?.sound)?.url; },

    gain(id) {
      if (!this.gains[id]) { this.gains[id] = this.ctx.createGain(); Tone.connect(this.gains[id], engine.master); }
      return this.gains[id];
    },

    // Applique la configuration du morceau ; démarre ou arrête le séquenceur selon les pistes actives.
    // Un changement de morceau repart de la première boucle.
    apply(cfg, pieceId) {
      if (pieceId !== this.pieceId) { this.pieceId = pieceId; this.restart(); }
      this.bpm = cfg.bpm;
      this.loops = cfg.loops;
      this.beats = cfg.beats;
      this.div = cfg.div;
      this.tracks = JSON.parse(JSON.stringify(cfg.tracks));
      if (this.step >= this.beats * this.div) this.step = 0;
      const active = PERC_IDS.filter(id => this.tracks[id].on);
      for (const id of active) {
        this.gain(id).gain.setTargetAtTime(this.tracks[id].level, this.ctx.currentTime, 0.05);
        this.load(this.urlFor(id)).catch(() => {});
      }
      if (!active.length) { this.stop(); return; }
      if (this.running || this.finished) return;
      this.running = true;
      this.step = 0;
      this.loop = 0;
      this.nextStep = this.ctx.currentTime + 0.05;
      this.tick();
      this.timer = setInterval(() => this.tick(), 50);
    },

    // Repart de la première boucle au prochain apply().
    restart() { this.stop(); this.finished = false; },

    tick() {
      const now = this.ctx.currentTime;
      if (this.nextStep < now - 0.5) this.nextStep = now + 0.02; // l'onglet a été mis en pause
      while (this.running && this.nextStep < now + 0.2) {
        const t = this.nextStep, step = this.step, loop = this.loop;
        for (const id of PERC_IDS) {
          const tr = this.tracks[id];
          if (!tr?.on || !tr.steps[step]) continue;
          const buf = this.buffers.get(this.urlFor(id));
          if (!buf) continue;
          const src = this.ctx.createBufferSource();
          src.buffer = buf;
          src.connect(this.gain(id));
          src.start(t);
        }
        if (this.onStep) setTimeout(() => this.onStep(step, loop), Math.max(0, (t - now) * 1000));
        this.nextStep += 60 / this.bpm / this.div; // un temps divisé en `div` cases
        if (step + 1 < this.beats * this.div) { this.step = step + 1; continue; }
        this.step = 0;
        this.loop = loop + 1;
        if (this.loops && this.loop >= this.loops) {
          this.finished = true;
          this.stop();
          if (this.onEnd) setTimeout(() => this.onEnd(), Math.max(0, (this.nextStep - now) * 1000));
        }
      }
    },

    setBpm(bpm) { this.bpm = bpm; },
    setLevel(id, level) { if (this.gains[id]) this.gains[id].gain.setTargetAtTime(level, this.ctx.currentTime, 0.05); },

    stop() {
      this.running = false;
      clearInterval(this.timer);
      this.timer = null;
    },
  };

  // ---------- Moteur audio ----------
  const engine = {
    ready: false,
    playing: false,
    master: null,
    synthBus: null,
    sampleBus: null,
    sampleFx: null,      // effets partagés du pad harmonium
    bassBus: null,
    bassFx: null,        // effets partagés du pad basse
    fx: {},              // kind → effets (samples, bass)
    bus: {},             // kind → bus de niveau
    chains: new Map(),   // pad synthé : midi → chaîne Tone
    samples: new Map(),  // pad harmonium : midi → SampleVoice (ou { loading: true, vol })
    bass: new Map(),     // pad basse : idem
    voicesOf(kind) { return kind === 'bass' ? this.bass : this.samples; },
    fading: new Map(),   // voix en cours de relâche (encore mesurées pour la lueur)

    async ensure() {
      if (this.ready) return;
      if (typeof Tone === 'undefined') { alert('Tone.js introuvable (vendor/Tone.js).'); throw new Error('Tone missing'); }
      await Tone.start();
      this.master = new Tone.Gain(state.master).toDestination();
      this.synthBus = new Tone.Gain(cur()?.synthLevel ?? 1).connect(this.master);
      this.sampleBus = new Tone.Gain(cur()?.sampleLevel ?? 0.7).connect(this.master);
      this.sampleFx = makeFx(this.sampleBus, cur()?.sampleSound || DEFAULT_SAMPLE_SOUND);
      this.bassBus = new Tone.Gain(cur()?.bassLevel ?? 1).connect(this.master);
      this.bassFx = makeFx(this.bassBus, cur()?.bassSound || DEFAULT_SAMPLE_SOUND);
      this.fx = { samples: this.sampleFx, bass: this.bassFx };
      this.bus = { samples: this.sampleBus, bass: this.bassBus };
      this.ready = true;
      meterLoop();
    },

    async play() {
      await this.ensure();
      this.playing = true;
      rhythm.restart();
      this.sync();
      renderTransport();
      renderList();
    },

    stop() {
      this.playing = false;
      for (const midi of [...this.chains.keys()]) this.release(midi);
      for (const kind of SAMPLED) for (const midi of [...this.voicesOf(kind).keys()]) this.stopSample(kind, midi);
      rhythm.stop();
      renderTransport();
      renderList();
    },

    toggle() { this.playing ? this.stop() : this.play(); },

    // Aligne ce qui sonne sur le morceau courant.
    sync() {
      const p = cur();
      if (!this.playing || !this.ready) return;

      const wanted = p && synthOn(p) ? p.voices : {};
      for (const [midiStr, v] of Object.entries(wanted)) {
        const midi = Number(midiStr);
        let c = this.chains.get(midi);
        if (!c) {
          c = makeChain(midi, v.vol, p.sound);
          this.chains.set(midi, c);
          c.synth.triggerAttack(freqOf(midi));
        } else {
          c.synth.volume.rampTo(Tone.gainToDb(v.vol) - 10, 0.4);
        }
      }
      for (const midi of [...this.chains.keys()]) if (!(midi in wanted)) this.release(midi);
      if (p) { applySound(p.sound); this.synthBus.gain.rampTo(p.synthLevel, 0.2); }

      for (const kind of SAMPLED) {
        const live = this.voicesOf(kind);
        const wantedS = p && padOn[kind](p) ? p[kind] : {};
        for (const [midiStr, v] of Object.entries(wantedS)) {
          const midi = Number(midiStr);
          const sv = live.get(midi);
          if (!sv) this.startSample(kind, midi, v.vol);
          else if (sv.loading) sv.vol = v.vol;
          else sv.setVolume(v.vol);
        }
        for (const midi of [...live.keys()]) if (!(midi in wantedS)) this.stopSample(kind, midi);
        if (p) { this.bus[kind].gain.rampTo(p[LEVEL_KEY[kind]], 0.2); applyFx(this.fx[kind], p[SOUND_KEY[kind]]); }
      }

      if (p && drumsOn(p)) rhythm.apply(p.rhythm, p.id); else rhythm.stop();
    },

    release(midi) {
      const c = this.chains.get(midi);
      if (!c) return;
      this.chains.delete(midi);
      this.fading.set(c, { kind: 'voices', midi });
      c.synth.triggerRelease();
      setTimeout(() => {
        this.fading.delete(c);
        cellEls.voices.get(midi)?.style.setProperty('--lvl', 0);
        for (const node of [c.synth, c.dist, c.autoFilter, c.chorus, c.lfoPan, c.lfoVol, c.panner, c.meter]) {
          try { node?.dispose(); } catch (e) { /* ignore */ }
        }
      }, RELEASE_MS);
    },

    startSample(kind, midi, vol) {
      const live = this.voicesOf(kind);
      const token = { loading: true, vol };
      live.set(midi, token);
      updateCell(kind, midi, cur());
      loaderFor[kind](midi).then(data => {
        if (live.get(midi) !== token) return; // éteint entre-temps
        live.set(midi, new SampleVoice(kind, midi, data, token.vol));
        updateCell(kind, midi, cur());
      }).catch(err => {
        console.error('Sample illisible', kind, noteName(midi), err);
        if (live.get(midi) === token) live.delete(midi);
        updateCell(kind, midi, cur());
      });
    },

    stopSample(kind, midi) {
      const live = this.voicesOf(kind);
      const sv = live.get(midi);
      if (!sv) return;
      live.delete(midi);
      if (sv.loading) return;
      this.fading.set(sv, { kind, midi });
      sv.stop();
      setTimeout(() => {
        this.fading.delete(sv);
        cellEls[kind].get(midi)?.style.setProperty('--lvl', 0);
      }, SAMPLE_RELEASE_MS);
    },

    setVoiceVolume(kind, midi, vol) {
      if (kind === 'voices') {
        const c = this.chains.get(midi);
        if (c) c.synth.volume.rampTo(Tone.gainToDb(vol) - 10, 0.1);
      } else {
        const sv = this.voicesOf(kind).get(midi);
        if (sv?.loading) sv.vol = vol; else sv?.setVolume(vol);
      }
    },

    setPadLevel(kind, v) {
      if (this.bus[kind]) this.bus[kind].gain.rampTo(v, 0.2);
    },

    setSynthLevel(v) {
      if (this.synthBus) this.synthBus.gain.rampTo(v, 0.2);
    },

    retune() {
      for (const [midi, c] of this.chains) c.synth.frequency.rampTo(freqOf(midi), 0.3);
      for (const kind of SAMPLED) for (const sv of this.voicesOf(kind).values()) sv.retune?.();
    },

    setMaster(v) {
      if (this.master) this.master.gain.rampTo(v, 0.2);
    },
  };

  function oscillatorOptions(sound) {
    return sound.fat ? { type: 'fatsawtooth', count: 2, spread: 20 } : { type: 'sawtooth' };
  }

  function makeChain(midi, vol, sound) {
    const c = { midi };
    c.meter = new Tone.Meter({ normalRange: true, smoothing: 0.85 });
    c.panner = new Tone.PanVol({ pan: 0, volume: 0 }).connect(engine.synthBus);
    c.panner.connect(c.meter);
    // Mouvement lent et aléatoire du panoramique et du volume, comme sur le site.
    c.lfoPan = new Tone.LFO(Math.random() * 0.5 + 0.01, -0.25, 0.25).connect(c.panner.pan).start();
    c.lfoVol = new Tone.LFO(Math.random() * 0.1 + 0.001, -20, 0).connect(c.panner.volume).start();
    Object.assign(c, makeFx(c.panner, sound));
    c.synth = new Tone.Synth({
      envelope: { attack: 2, decay: 0.1, sustain: 1, release: 4 },
      oscillator: oscillatorOptions(sound),
      volume: Tone.gainToDb(vol) - 10,
    }).connect(c.dist);
    return c;
  }

  // Chaîne d'effets : saturation → filtre auto → (chorus) → sortie. Entrée : fx.dist.
  function makeFx(out, sound) {
    const fx = { out, chorus: null };
    fx.autoFilter = new Tone.AutoFilter({
      frequency: sound.afRate,
      depth: sound.afDepth,
      baseFrequency: sound.cutoff,
      filter: { type: 'lowpass', rolloff: -12, Q: sound.q },
      wet: 1,
    }).connect(out).start();
    fx.dist = new Tone.Distortion({ distortion: sound.drive, oversample: '2x' }).connect(fx.autoFilter);
    if (sound.choDepth > 0) insertChorus(fx, sound);
    return fx;
  }

  function insertChorus(fx, sound) {
    fx.autoFilter.disconnect();
    fx.chorus = new Tone.Chorus({ frequency: sound.choRate, depth: sound.choDepth, spread: 180, wet: 0.5 })
      .connect(fx.out).start();
    fx.autoFilter.connect(fx.chorus);
  }

  function removeChorus(fx) {
    fx.autoFilter.disconnect();
    fx.chorus.dispose();
    fx.chorus = null;
    fx.autoFilter.connect(fx.out);
  }

  function applyFx(fx, sound) {
    fx.autoFilter.baseFrequency = sound.cutoff;
    fx.autoFilter.filter.Q.rampTo(sound.q, 0.1);
    fx.autoFilter.frequency.value = sound.afRate;
    fx.autoFilter.depth.value = sound.afDepth;
    fx.dist.distortion = sound.drive;
    if (sound.choDepth > 0 && !fx.chorus) insertChorus(fx, sound);
    else if (sound.choDepth > 0 && fx.chorus) { fx.chorus.frequency.value = sound.choRate; fx.chorus.depth = sound.choDepth; }
    else if (sound.choDepth === 0 && fx.chorus) removeChorus(fx);
  }

  function applySound(sound) {
    for (const c of engine.chains.values()) {
      applyFx(c, sound);
      const wantType = oscillatorOptions(sound).type;
      if (c.synth.oscillator.type !== wantType) swapSynth(c, sound);
    }
  }

  function applyKindSound(kind, p) {
    if (!engine.ready) return;
    if (kind === 'voices') applySound(p.sound);
    else applyFx(engine.fx[kind], p[SOUND_KEY[kind]]);
  }

  // Changer « épaisseur » demande un nouvel oscillateur : on fond l'ancien dans le nouveau.
  function swapSynth(c, sound) {
    const old = c.synth;
    const vol = old.volume.value;
    c.synth = new Tone.Synth({
      envelope: { attack: 2, decay: 0.1, sustain: 1, release: 4 },
      oscillator: oscillatorOptions(sound),
      volume: vol,
    }).connect(c.dist);
    c.synth.triggerAttack(freqOf(c.midi));
    old.triggerRelease();
    setTimeout(() => { try { old.dispose(); } catch (e) { /* ignore */ } }, RELEASE_MS);
  }

  function meterLoop() {
    const paint = (kind, midi, meter) => {
      const el = cellEls[kind].get(midi);
      if (el) el.style.setProperty('--lvl', clamp(meter.getValue() * 3, 0, 1).toFixed(3));
    };
    const tick = () => {
      for (const [midi, c] of engine.chains) paint('voices', midi, c.meter);
      for (const kind of SAMPLED) for (const [midi, sv] of engine.voicesOf(kind)) if (!sv.loading) paint(kind, midi, sv.meter);
      for (const [obj, { kind, midi }] of engine.fading) {
        const live = kind === 'voices' ? engine.chains : engine.voicesOf(kind);
        if (!live.has(midi)) paint(kind, midi, obj.meter);
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  // ---------- Rendu ----------
  const cellEls = { voices: new Map(), samples: new Map(), bass: new Map() };

  function renderAll() {
    const p = cur();
    document.documentElement.style.setProperty('--hue', p ? pieceHue(p) : 0);
    renderTransport();
    renderList();
    renderMain();
  }

  function renderTransport() {
    const b = $('#play');
    b.textContent = engine.playing ? '■ Arrêter' : '▶ Lancer';
    b.classList.toggle('on', engine.playing);
    $('#master').value = state.master;
    $('#a4').value = state.a4;
  }

  function renderList() {
    const ul = $('#list');
    ul.innerHTML = '';
    if (!state.pieces.length) {
      ul.innerHTML = '<li class="empty-list">Aucun morceau. Cliquez sur « + Nouveau ».</li>';
      return;
    }
    for (const p of state.pieces) {
      const li = document.createElement('li');
      li.className = 'piece' + (p.id === state.currentId ? ' current' : '');
      li.style.setProperty('--h', pieceHue(p));
      const n = Object.keys(p.voices).length + Object.keys(p.samples).length + Object.keys(p.bass).length;
      li.innerHTML = `<span class="swatch"></span><span class="name"></span>` +
        `<span class="meta">${n} ${n > 1 ? 'notes' : 'note'}</span>` +
        (engine.playing && p.id === state.currentId ? '<span class="playing">▶</span>' : '');
      li.querySelector('.name').textContent = p.name;
      li.title = 'Cliquer pour lancer ce drone';
      li.addEventListener('click', () => selectAndPlay(p.id));
      ul.appendChild(li);
    }
  }

  function clearButton(kind) {
    return `<button class="btn small ghost" data-clear="${kind}">Tout éteindre</button>`;
  }

  function renderMain() {
    const main = $('#main');
    const p = cur();
    for (const kind of KINDS) cellEls[kind].clear();
    if (!p) {
      main.innerHTML = `<div class="welcome"><h1>VETERAN</h1>
        <p>Créez un morceau, choisissez sa tonique, touchez les notes qui doivent sonner, et c'est enregistré.
        Ensuite, un clic sur le morceau dans la liste lance son drone.</p>
        <p><button class="btn" id="welcome-new">+ Nouveau morceau</button>
        <button class="btn ghost" id="welcome-sync">Récupérer mes morceaux</button></p>
        <p class="hint">Vos morceaux sont déjà sur un autre appareil ? Sur celui-ci, ouvrez la synchronisation et « Copier le
        code » ; ici, « Récupérer mes morceaux » puis « Coller le code », et ils arrivent.</p></div>`;
      main.querySelector('#welcome-new').addEventListener('click', newPiece);
      main.querySelector('#welcome-sync').addEventListener('click', openSyncPanel);
      return;
    }

    const hv = history.info(p);
    main.innerHTML = `
      <div class="parts" id="parts">
        ${PARTS.map(part => `<button class="part ${p.parts[part.id] ? 'on' : ''} ${(part.id === 'synth' || part.id === 'harmonium') && !p.parts.drone ? 'dim' : ''}" data-part="${part.id}" aria-pressed="${p.parts[part.id] ? 'true' : 'false'}">${part.label}</button>`).join('')}
      </div>

      <div class="piece-head">
        <input class="piece-name" id="piece-name" spellcheck="false" placeholder="Nom du morceau">
        <div class="actions">
          <button class="btn small" id="undo" ${hv.canUndo ? '' : 'disabled'} title="Revenir à la version précédente">↶ Annuler</button>
          <button class="btn small" id="redo" ${hv.canRedo ? '' : 'disabled'} title="Revenir à la version suivante">↷ Rétablir</button>
          <button class="btn small" id="dup">Dupliquer</button>
          <button class="btn small danger" id="del">Supprimer</button>
        </div>
      </div>

      <details class="versions" id="versions">
        <summary>Versions <span class="count">${hv.list.length}</span></summary>
        ${hv.list.length ? `<ul class="version-list">${hv.list.map(v => `
          <li class="${v.current ? 'current' : ''}">
            <span class="when">${v.when}</span>
            <span class="what">${v.what}</span>
            ${v.current ? '<span class="now-tag">version actuelle</span>' : `<button class="btn small ghost" data-restore="${v.index}">Restaurer</button>`}
          </li>`).join('')}</ul>`
          : '<p class="hint">Chaque modification du morceau crée une version ici (les modifications rapprochées sont regroupées).</p>'}
      </details>

      ${drumsOn(p) ? `
      <div class="section kick">
        <div class="section-title">Rythme
          <span class="spacer"></span>
          <span class="beat" id="beat"></span>
          <button class="btn small" id="bpm-minus">−</button>
          <input id="bpm" type="number" min="30" max="240" step="1" inputmode="numeric">
          <button class="btn small" id="bpm-plus">+</button>
          <span class="bpm-label">BPM</span>
          <input id="bpm-slider" type="range" min="30" max="240" step="1">
        </div>
        <div class="loops-row">
          <span class="bpm-label">Boucles</span>
          <button class="btn small" id="loops-minus">−</button>
          <input id="loops" type="text" inputmode="numeric" title="Nombre de boucles ; ∞ ou 0 pour jouer sans fin">
          <button class="btn small" id="loops-plus">+</button>
          <button class="btn small ${p.rhythm.loops ? '' : 'on'}" id="loops-inf" title="Jouer sans fin">∞</button>
          <span class="loop-count" id="loop-count"></span>
          <button class="btn small ghost" id="rhythm-restart" title="Repartir de la première boucle">↻ Relancer</button>
        </div>
        <div class="loops-row">
          <span class="bpm-label">Temps</span>
          <button class="btn small" id="beats-minus">−</button>
          <input id="beats" type="number" min="1" max="${MAX_BEATS}" step="1" inputmode="numeric" title="Nombre de temps dans la boucle">
          <button class="btn small" id="beats-plus">+</button>
          <span class="bpm-label">Cases par temps</span>
          <div class="seg small" id="div">
            ${DIVS.map(d => `<button data-div="${d}" class="${p.rhythm.div === d ? 'on' : ''}">${d}</button>`).join('')}
          </div>
        </div>
        <div class="tracks" style="--cols: ${stepCols(p.rhythm)}">
          <div class="track head">
            <div class="track-head"></div>
            <div class="steps steps-head">
              ${Array.from({ length: stepCount(p.rhythm) }, (_, i) => { const d = p.rhythm.div; return `<span class="step-no ${i % d ? '' : 'beat'}" data-i="${i}">${i % d ? '·' : (i / d) + 1}</span>`; }).join('')}
            </div>
          </div>
          ${PERC_IDS.map(id => { const t = p.rhythm.tracks[id]; const def = PERC[id]; return `
          <div class="track ${t.on ? '' : 'muted'}" data-track="${id}">
            <div class="track-head">
              <button class="btn small ${t.on ? 'on' : ''}" data-toggle="${id}">${t.on ? 'ON' : 'OFF'}</button>
              <span class="track-name">${def.label}</span>
              ${def.sounds.length > 1
                ? `<select class="sel" data-sound="${id}">${def.sounds.map(sd => `<option value="${sd.id}" ${sd.id === t.sound ? 'selected' : ''}>${sd.label}</option>`).join('')}</select>`
                : `<span class="track-sound">${def.sounds[0].label}</span>`}
            </div>
            <div class="steps">
              ${t.steps.map((v, i) => `<button class="step ${v ? 'on' : ''} ${i % p.rhythm.div ? '' : 'beat'}" data-step="${id}" data-i="${i}" aria-label="${def.label}, case ${i + 1}" aria-pressed="${v ? 'true' : 'false'}"></button>`).join('')}
            </div>
            <label class="level">Niveau <input type="range" id="level-${id}" min="-36" max="12" step="0.5"><span class="db" id="level-${id}-db"></span></label>
          </div>`; }).join('')}
        </div>
        <div class="hint">Une ligne par instrument : ON/OFF, son, niveau, puis les cases de la boucle (les temps sont numérotés, « · » sont les subdivisions). Toucher une case y met ou enlève une frappe. « Boucles » : combien de fois la boucle est jouée, ∞ pour sans fin. « Temps » : longueur de la boucle ; « Cases par temps » : finesse de la grille (2 = croches, 4 = doubles-croches, 3 = triolets).</div>
      </div>` : ''}

      ${synthOn(p) ? `
      <div class="section pad">
        <div class="section-title">Pad 1 — Synthé
          <label class="level">Niveau <input type="range" id="synth-level" min="-36" max="6" step="0.5"><span class="db" id="synth-level-db"></span></label>
          <span class="spacer"></span>
          ${clearButton('voices')}
        </div>
        <div class="grid" id="grid-voices"></div>
        <div class="hint">Toucher une note l'allume ou l'éteint. Glisser verticalement (ou molette) règle son volume.</div>
        ${soundPanel('voices', 'Son du synthé')}
      </div>` : ''}

      ${sampleOn(p) ? `
      <div class="section pad">
        <div class="section-title">Pad 2 — Harmonium
          <label class="level">Niveau <input type="range" id="sample-level" min="-36" max="12" step="0.5"><span class="db" id="sample-level-db"></span></label>
          <span class="spacer"></span>
          ${clearButton('samples')}
        </div>
        <div class="grid" id="grid-samples"></div>
        <div class="hint">Vrai harmonium (Do2 à Ré5) enregistré par donyaquick, découpé par cabled_mess · Freesound, CC0 · WAV 96 kHz. Les notes grisées n'existent pas dans la banque.${useWav ? '' : ' <b>Ouvrez l\'app via un serveur (http) ou la version installée : en ouverture directe du fichier, les samples ne peuvent pas être lus.</b>'}</div>
        ${soundPanel('samples', "Son de l'harmonium")}
      </div>` : ''}

      ${bassOn(p) ? `
      <div class="section pad">
        <div class="section-title">Pad 3 — Basse
          <label class="level">Niveau <input type="range" id="bass-level" min="-36" max="12" step="0.5"><span class="db" id="bass-level-db"></span></label>
          <span class="spacer"></span>
          ${clearButton('bass')}
        </div>
        <div class="grid" id="grid-bass"></div>
        <div class="hint">Basse Moog (« Travis Scott Type — Moog Long Bass » d'Albert Mathiesen, Sample Focus, libre de droits) : un seul enregistrement, transposé sur toutes les notes et bouclé. Loin de sa note de base, le timbre change.</div>
        ${soundPanel('bass', 'Son de la basse')}
      </div>` : ''}`;

    const nameInput = main.querySelector('#piece-name');
    nameInput.value = p.name;
    nameInput.addEventListener('input', () => { p.name = nameInput.value; save(); renderList(); });
    nameInput.addEventListener('keydown', e => { if (e.key === 'Enter') nameInput.blur(); });

    main.querySelector('#dup').addEventListener('click', () => duplicatePiece(p));
    main.querySelector('#del').addEventListener('click', () => deletePiece(p));
    for (const b of main.querySelectorAll('[data-part]')) {
      b.addEventListener('click', () => { p.parts[b.dataset.part] = !p.parts[b.dataset.part]; commit(); });
    }
    main.querySelector('#undo').addEventListener('click', () => history.undo(p));
    main.querySelector('#redo').addEventListener('click', () => history.redo(p));
    for (const b of main.querySelectorAll('[data-restore]')) {
      b.addEventListener('click', () => history.restore(p, Number(b.dataset.restore)));
    }
    const versionsEl = main.querySelector('#versions');
    versionsEl.open = history.open;
    versionsEl.addEventListener('toggle', () => { history.open = versionsEl.open; });
    for (const b of main.querySelectorAll('[data-reset]')) {
      b.addEventListener('click', e => { e.preventDefault(); p[SOUND_KEY[b.dataset.reset]] = { ...DEFAULTS[b.dataset.reset] }; commit(); });
    }
    for (const b of main.querySelectorAll('[data-clear]')) {
      b.addEventListener('click', () => { p[b.dataset.clear] = {}; commit(); });
    }
    bindLevel(main, '#synth-level', '#synth-level-db', () => p.synthLevel, v => { p.synthLevel = v; engine.setSynthLevel(v); });
    for (const id of PERC_IDS) {
      bindLevel(main, '#level-' + id, '#level-' + id + '-db', () => p.rhythm.tracks[id].level, v => { p.rhythm.tracks[id].level = v; rhythm.setLevel(id, v); });
    }
    if (main.querySelector('#bpm')) bindRhythm(main, p);
    bindLevel(main, '#sample-level', '#sample-level-db', () => p.sampleLevel, v => { p.sampleLevel = v; engine.setPadLevel('samples', v); });
    bindLevel(main, '#bass-level', '#bass-level-db', () => p.bassLevel, v => { p.bassLevel = v; engine.setPadLevel('bass', v); });

    for (const kind of KINDS) {
      if ($('#grid-' + kind)) { renderGrid(kind, p); renderSound(kind, p); }
    }
  }

  // Curseur de niveau en décibels (le morceau garde un gain linéaire).
  const toDb = g => (g <= 0 ? -60 : 20 * Math.log10(g));
  const fromDb = db => Math.pow(10, db / 20);
  function bindLevel(root, sliderSel, labelSel, get, set) {
    const slider = root.querySelector(sliderSel);
    if (!slider) return;
    const label = root.querySelector(labelSel);
    const show = () => { const db = toDb(get()); label.textContent = (db <= Number(slider.min) ? 'muet' : (db > 0 ? '+' : '') + db.toFixed(1) + ' dB'); };
    slider.value = clamp(toDb(get()), Number(slider.min), Number(slider.max));
    show();
    slider.addEventListener('input', () => {
      const db = Number(slider.value);
      set(db <= Number(slider.min) ? 0 : fromDb(db));
      show();
      save();
    });
    slider.addEventListener('dblclick', () => { slider.value = sliderSel.includes('synth') ? -6 : -3; slider.dispatchEvent(new Event('input')); });
  }

  function bindRhythm(root, p) {
    const r = p.rhythm;
    const num = root.querySelector('#bpm');
    const slider = root.querySelector('#bpm-slider');
    const show = () => { num.value = r.bpm; slider.value = r.bpm; };
    const setBpm = v => {
      r.bpm = clamp(Math.round(Number(v) || r.bpm), 30, 240);
      show();
      rhythm.setBpm(r.bpm);
      save();
    };
    show();
    num.addEventListener('change', () => setBpm(num.value));
    num.addEventListener('keydown', e => { if (e.key === 'Enter') num.blur(); });
    slider.addEventListener('input', () => setBpm(slider.value));
    root.querySelector('#bpm-minus').addEventListener('click', () => setBpm(r.bpm - 1));
    root.querySelector('#bpm-plus').addEventListener('click', () => setBpm(r.bpm + 1));

    // Boucles : nombre, ou ∞ (0).
    const loopsEl = root.querySelector('#loops');
    const infBtn = root.querySelector('#loops-inf');
    const loopCount = root.querySelector('#loop-count');
    const showLoops = () => {
      loopsEl.value = r.loops ? String(r.loops) : '∞';
      infBtn.classList.toggle('on', !r.loops);
    };
    const setLoops = v => {
      const n = Math.round(Number(String(v).trim()));
      r.loops = Number.isFinite(n) ? clamp(n, 0, MAX_LOOPS) : 0;
      showLoops();
      save();
      rhythm.restart();
      engine.sync();
    };
    showLoops();
    loopsEl.addEventListener('change', () => setLoops(loopsEl.value));
    loopsEl.addEventListener('keydown', e => { if (e.key === 'Enter') loopsEl.blur(); });
    loopsEl.addEventListener('focus', () => loopsEl.select());
    root.querySelector('#loops-minus').addEventListener('click', () => setLoops(Math.max(0, r.loops - 1)));
    root.querySelector('#loops-plus').addEventListener('click', () => setLoops(r.loops + 1));
    infBtn.addEventListener('click', () => setLoops(0));
    root.querySelector('#rhythm-restart').addEventListener('click', () => {
      rhythm.restart();
      if (!engine.playing) engine.play(); else engine.sync();
    });

    // Longueur de la boucle (temps) et cases par temps : la grille est redessinée.
    const beatsEl = root.querySelector('#beats');
    beatsEl.value = r.beats;
    const setShape = (beats, div) => {
      resizeRhythm(r, clamp(Math.round(Number(beats) || r.beats), 1, MAX_BEATS), div);
      commit();
    };
    beatsEl.addEventListener('change', () => setShape(beatsEl.value, r.div));
    beatsEl.addEventListener('keydown', e => { if (e.key === 'Enter') beatsEl.blur(); });
    root.querySelector('#beats-minus').addEventListener('click', () => setShape(r.beats - 1, r.div));
    root.querySelector('#beats-plus').addEventListener('click', () => setShape(r.beats + 1, r.div));
    for (const b of root.querySelectorAll('[data-div]')) {
      b.addEventListener('click', () => setShape(r.beats, Number(b.dataset.div)));
    }

    const anyOn = () => PERC_IDS.some(id => r.tracks[id].on);
    const beat = root.querySelector('#beat');
    beat.classList.toggle('off', !anyOn());

    // Affichage pendant la lecture : case courante, compteur de temps, compteur de boucles.
    let shownStep = -1;
    rhythm.onStep = (step, loop) => {
      if (!root.isConnected) return;
      if (shownStep >= 0) for (const el of root.querySelectorAll(`[data-i="${shownStep}"]`)) el.classList.remove('now');
      for (const el of root.querySelectorAll(`[data-i="${step}"]`)) el.classList.add('now');
      shownStep = step;
      if (step % r.div === 0) {
        beat.textContent = step / r.div + 1;
        beat.classList.add('hit');
        setTimeout(() => beat.classList.remove('hit'), 90);
      }
      loopCount.textContent = r.loops ? `${loop + 1} / ${r.loops}` : `${loop + 1}`;
      loopCount.classList.remove('done');
    };
    rhythm.onEnd = () => {
      if (!root.isConnected) return;
      if (shownStep >= 0) for (const el of root.querySelectorAll(`[data-i="${shownStep}"]`)) el.classList.remove('now');
      shownStep = -1;
      beat.textContent = '';
      loopCount.textContent = 'fin';
      loopCount.classList.add('done');
    };
    if (rhythm.finished && rhythm.pieceId === p.id) rhythm.onEnd();

    for (const b of root.querySelectorAll('[data-toggle]')) {
      const id = b.dataset.toggle;
      b.addEventListener('click', () => {
        const t = r.tracks[id];
        t.on = !t.on;
        b.textContent = t.on ? 'ON' : 'OFF';
        b.classList.toggle('on', t.on);
        b.closest('.track').classList.toggle('muted', !t.on);
        beat.classList.toggle('off', !anyOn());
        save();
        if (t.on && rhythm.finished) rhythm.restart();
        if (t.on && !engine.playing) engine.play(); else engine.sync();
      });
    }
    for (const sel of root.querySelectorAll('[data-sound]')) {
      sel.addEventListener('change', () => { r.tracks[sel.dataset.sound].sound = sel.value; save(); engine.sync(); });
    }
    for (const b of root.querySelectorAll('[data-step]')) {
      b.addEventListener('click', () => {
        const t = r.tracks[b.dataset.step], i = Number(b.dataset.i);
        t.steps[i] = t.steps[i] ? 0 : 1;
        b.classList.toggle('on', !!t.steps[i]);
        b.setAttribute('aria-pressed', t.steps[i] ? 'true' : 'false');
        save();
        engine.sync();
      });
    }
  }

  function soundPanel(kind, title) {
    return `<details class="sound-box" open>
      <summary>${title}
        <button class="btn small ghost" data-reset="${kind}">Son par défaut</button>
      </summary>
      <div class="sound" id="sound-${kind}"></div>
    </details>`;
  }

  function renderGrid(kind, p) {
    const grid = $('#grid-' + kind);
    grid.innerHTML = '';
    // En-tête : les 12 notes de base.
    const corner = document.createElement('div');
    corner.className = 'row-label';
    grid.appendChild(corner);
    NOTES.forEach((n, i) => {
      const h = document.createElement('div');
      h.className = 'col-head';
      h.style.setProperty('--h', hue(i));
      h.textContent = n;
      grid.appendChild(h);
    });
    // Une ligne par octave, toutes les notes jouables.
    for (const oct of OCTAVES) {
      const lab = document.createElement('div');
      lab.className = 'row-label';
      lab.textContent = 'Octave ' + oct;
      grid.appendChild(lab);
      for (let i = 0; i < 12; i++) {
        const midi = (oct + 1) * 12 + i;
        const el = document.createElement('button');
        el.className = 'cell';
        el.dataset.midi = midi;
        el.style.setProperty('--h', hue(midi));
        el.innerHTML = `<div class="vol"></div><div class="note">${noteName(midi)}</div>`;
        if (kind === 'samples' && !hasSample(midi)) {
          el.classList.add('na');
          el.disabled = true;
        } else {
          attachCellGestures(el, kind, midi, p);
        }
        grid.appendChild(el);
        cellEls[kind].set(midi, el);
        updateCell(kind, midi, p);
      }
    }
  }

  function updateCell(kind, midi, p) {
    const el = cellEls[kind].get(midi);
    if (!el || !p) return;
    const v = p[kind][midi];
    el.classList.toggle('on', !!v);
    el.classList.toggle('loading', kind !== 'voices' && !!engine.voicesOf(kind).get(midi)?.loading);
    el.style.setProperty('--vol', v ? v.vol : 0);
    el.title = el.classList.contains('na') ? `${noteName(midi)} · pas dans la banque`
      : v ? `${noteName(midi)} · volume ${Math.round(v.vol * 100)} %` : noteName(midi);
  }

  function attachCellGestures(el, kind, midi, p) {
    let startY = 0, startVol = 0, dragging = false, pointerId = null;
    el.addEventListener('pointerdown', e => {
      pointerId = e.pointerId;
      startY = e.clientY;
      startVol = p[kind][midi]?.vol ?? 0.8;
      dragging = false;
      el.setPointerCapture(e.pointerId);
    });
    el.addEventListener('pointermove', e => {
      if (e.pointerId !== pointerId) return;
      const dy = startY - e.clientY;
      if (!dragging && Math.abs(dy) < 5) return;
      dragging = true;
      if (!p[kind][midi]) setVoice(p, kind, midi, true, startVol);
      setVolume(p, kind, midi, clamp(startVol + dy / 150, 0.01, 1));
    });
    const end = e => {
      if (e.pointerId !== pointerId) return;
      pointerId = null;
      if (!dragging) setVoice(p, kind, midi, !p[kind][midi]);
      else save();
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('wheel', e => {
      if (!p[kind][midi]) return;
      e.preventDefault();
      setVolume(p, kind, midi, clamp(p[kind][midi].vol - e.deltaY / 600, 0.01, 1));
      save();
    }, { passive: false });
  }

  function renderSound(kind, p) {
    const box = $('#sound-' + kind);
    const sound = p[SOUND_KEY[kind]];
    const defaults = DEFAULTS[kind];
    box.innerHTML = '';
    for (const sp of SOUND_PARAMS) {
      const wrap = document.createElement('label');
      wrap.className = 'param';
      wrap.innerHTML = `<div class="lbl"><span>${sp.label}</span><span class="val"></span></div>
        <input type="range" min="0" max="1000" step="1">`;
      const input = wrap.querySelector('input');
      const val = wrap.querySelector('.val');
      const show = () => { val.textContent = sp.fmt(sound[sp.key]); };
      input.value = Math.round(valToNorm(sound[sp.key], sp.min, sp.max, sp.log) * 1000);
      show();
      input.addEventListener('input', () => {
        sound[sp.key] = normToVal(input.value / 1000, sp.min, sp.max, sp.log);
        show();
        applyKindSound(kind, p);
        save();
      });
      input.addEventListener('dblclick', () => {
        sound[sp.key] = defaults[sp.key];
        input.value = Math.round(valToNorm(sound[sp.key], sp.min, sp.max, sp.log) * 1000);
        show(); applyKindSound(kind, p); save();
      });
      box.appendChild(wrap);
    }
    if (kind === 'voices') {
      const fat = document.createElement('label');
      fat.className = 'param check';
      fat.innerHTML = `<input type="checkbox"><span>Épaisseur (2 oscillateurs désaccordés)</span>`;
      const cb = fat.querySelector('input');
      cb.checked = !!sound.fat;
      cb.addEventListener('change', () => { sound.fat = cb.checked; applyKindSound(kind, p); save(); });
      box.appendChild(fat);
    }
  }

  // ---------- Actions ----------
  function commit() {
    save(true); // tout de suite, pour que l'affichage (versions) reflète l'état enregistré
    renderAll();
    engine.sync();
  }

  function setVoice(p, kind, midi, on, vol = 0.8) {
    if (on) p[kind][midi] = { vol: p[kind][midi]?.vol ?? vol };
    else delete p[kind][midi];
    updateCell(kind, midi, p);
    save();
    renderList();
    if (on && !engine.playing) engine.play(); // allumer une note lance le drone
    else engine.sync();
  }

  function setVolume(p, kind, midi, vol) {
    if (!p[kind][midi]) return;
    p[kind][midi].vol = vol;
    updateCell(kind, midi, p);
    engine.setVoiceVolume(kind, midi, vol);
  }

  function newPiece() {
    const n = state.pieces.length + 1;
    const p = normalizePiece({ name: `Morceau ${n}`, voices: { 45: { vol: 0.8 } } });
    state.pieces.push(p);
    state.currentId = p.id;
    engine.stop();
    commit();
    $('#piece-name')?.focus();
    $('#piece-name')?.select();
  }

  function duplicatePiece(p) {
    const copy = normalizePiece(JSON.parse(JSON.stringify({ ...p, id: null, name: p.name + ' (copie)' })));
    state.pieces.splice(state.pieces.indexOf(p) + 1, 0, copy);
    state.currentId = copy.id;
    commit();
  }

  function deletePiece(p) {
    if (!confirm(`Supprimer « ${p.name} » ?`)) return;
    const idx = state.pieces.indexOf(p);
    state.pieces.splice(idx, 1);
    state.deleted[p.id] = Date.now();
    hashes.delete(p.id);
    history.forget(p.id);
    state.currentId = (state.pieces[idx] || state.pieces[idx - 1])?.id || null;
    commit();
    sync.schedule();
  }

  function selectAndPlay(id) {
    if (state.currentId !== id) {
      state.currentId = id;
      save();
      renderAll();
    }
    engine.play();
  }

  function exportJson() {
    const blob = new Blob([JSON.stringify({ pieces: state.pieces, a4: state.a4 }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `drones-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function importJson(file) {
    const r = new FileReader();
    r.onload = () => {
      try {
        const data = JSON.parse(r.result);
        const pieces = (Array.isArray(data) ? data : data.pieces || []).map(x => normalizePiece({ ...x, id: null }));
        if (!pieces.length) throw new Error('vide');
        state.pieces.push(...pieces);
        state.currentId = pieces[0].id;
        commit();
      } catch (e) {
        alert('Fichier non reconnu.');
      }
    };
    r.readAsText(file);
  }

  // ---------- Branchements globaux ----------
  $('#play').addEventListener('click', () => engine.toggle());
  $('#new').addEventListener('click', newPiece);
  $('#export').addEventListener('click', exportJson);
  $('#import').addEventListener('click', () => $('#file').click());
  $('#file').addEventListener('change', e => { if (e.target.files[0]) importJson(e.target.files[0]); e.target.value = ''; });
  $('#master').addEventListener('input', e => { state.master = Number(e.target.value); engine.setMaster(state.master); save(); });
  $('#a4').addEventListener('change', e => {
    state.a4 = clamp(Number(e.target.value) || 440, 400, 480);
    e.target.value = state.a4;
    engine.retune(); save();
  });
  document.addEventListener('keydown', e => {
    if (e.code === 'Space' && !/INPUT|TEXTAREA/.test(document.activeElement?.tagName || '')) {
      e.preventDefault();
      engine.toggle();
    }
  });

  // ---------- Synchronisation des morceaux via un dépôt GitHub ----------
  // Fichier morceaux.json dans un dépôt (privé de préférence). Fusion par morceau :
  // la version la plus récente gagne ; une suppression plus récente que le morceau le retire.
  const SYNC_KEY = 'drones-sync-v1';
  const SYNC_FILE = 'morceaux.json';

  const sync = {
    cfg: loadSyncCfg(),
    timer: null,
    busy: false,
    state: 'off', // off | idle | syncing | offline | error
    detail: '',

    get enabled() { return !!(this.cfg.repo && this.cfg.token); },

    saveCfg(repo, token) {
      repo = repo.trim().replace(/^https?:\/\/(www\.)?github\.com\//, '').replace(/\.git$/, '').replace(/\/$/, '');
      token = token.trim();
      if (!repo || !token) {
        this.cfg = { repo, token, lastSync: 0 };
        localStorage.setItem(SYNC_KEY, JSON.stringify(this.cfg));
        this.set('missing', !repo && !token ? 'il manque le dépôt et le jeton' : !repo ? 'il manque le nom du dépôt' : 'il manque le jeton');
        return false;
      }
      if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) {
        this.set('missing', 'dépôt attendu sous la forme compte/nom, ex. sarce666/drone-data');
        return false;
      }
      this.cfg = { repo, token, lastSync: 0 };
      localStorage.setItem(SYNC_KEY, JSON.stringify(this.cfg));
      this.set('idle');
      this.run();
      return true;
    },

    schedule() {
      if (!this.enabled) return;
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.run(), 3000);
    },

    api(path, opts = {}) {
      return fetch(`https://api.github.com/repos/${this.cfg.repo}/contents/${path}`, {
        ...opts,
        headers: {
          Authorization: 'Bearer ' + this.cfg.token,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          ...(opts.headers || {}),
        },
      });
    },

    async run() {
      if (!this.enabled || this.busy) return;
      if (!navigator.onLine) { this.set('offline'); return; }
      this.busy = true;
      this.set('syncing');
      try {
        // 1. Lire la version en ligne.
        let remote = null, sha = null;
        const r = await this.api(SYNC_FILE);
        if (r.status === 200) {
          const j = await r.json();
          sha = j.sha;
          remote = JSON.parse(utf8Decode(j.content));
        } else if (r.status !== 404) {
          throw new Error(r.status === 401 ? 'jeton refusé' : r.status === 403 ? 'accès refusé au dépôt' : 'HTTP ' + r.status);
        }
        // 2. Fusionner.
        const before = JSON.stringify({ p: state.pieces, d: state.deleted, a4: state.a4 });
        const beforeCount = state.pieces.length;
        if (remote) merge(remote);
        const merged = { pieces: state.pieces, deleted: state.deleted, a4: state.a4, savedAt: Date.now() };
        const localChanged = JSON.stringify({ p: state.pieces, d: state.deleted, a4: state.a4 }) !== before;
        if (localChanged) {
          const arrived = state.pieces.length - beforeCount;
          if (!this.cfg.lastSync && arrived > 0) showToast(arrived + (arrived > 1 ? ' morceaux récupérés.' : ' morceau récupéré.'), 'OK', () => { $('#toast').hidden = true; });
          for (const p of state.pieces) hashes.set(p.id, pieceHash(p));
          localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
          history.seed();
          renderAll();
          engine.sync();
        }
        // 3. Écrire si la version en ligne diffère.
        const remoteNorm = remote ? JSON.stringify({ p: remote.pieces, d: remote.deleted, a4: remote.a4 }) : null;
        if (remoteNorm !== JSON.stringify({ p: merged.pieces, d: merged.deleted, a4: merged.a4 })) {
          const w = await this.api(SYNC_FILE, {
            method: 'PUT',
            body: JSON.stringify({
              message: 'Morceaux ' + new Date().toISOString(),
              content: utf8Encode(JSON.stringify(merged, null, 2)),
              ...(sha ? { sha } : {}),
            }),
          });
          if (w.status === 409 || w.status === 422) { this.busy = false; this.set('idle'); return this.run(); } // modifié entre-temps : on refusionne
          if (!w.ok) throw new Error(w.status === 404 ? 'dépôt introuvable' : 'écriture refusée (' + w.status + ')');
        }
        this.cfg.lastSync = Date.now();
        localStorage.setItem(SYNC_KEY, JSON.stringify(this.cfg));
        this.set('idle');
      } catch (e) {
        this.set(navigator.onLine ? 'error' : 'offline', e.message);
      }
      this.busy = false;
    },

    set(st, detail = '') { this.state = st; this.detail = detail; this.render(); },

    render() {
      const el = $('#sync-status');
      if (!el) return;
      const last = this.cfg.lastSync ? new Date(this.cfg.lastSync).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : '';
      const txt = {
        off: 'Synchronisation non configurée',
        missing: 'Non enregistré : ' + this.detail,
        idle: last ? 'Synchronisé · ' + last : 'Synchronisé',
        syncing: 'Synchronisation…',
        offline: 'Hors ligne · sera synchronisé au retour du réseau' + (last ? ' (dernier : ' + last + ')' : ''),
        error: 'Erreur : ' + this.detail,
      }[this.enabled ? this.state : (this.state === 'missing' ? 'missing' : 'off')];
      el.textContent = txt;
      el.dataset.state = this.enabled ? this.state : 'off';
    },
  };

  // Code de transfert : dépôt + jeton dans une chaîne à copier d'un appareil à l'autre
  // (presse-papiers universel iPad → iPhone, AirDrop, Notes…). Rien ne transite par un tiers.
  const SYNC_CODE_PREFIX = 'VETERAN-SYNC:';
  function syncCodeFromCfg(cfg) {
    return SYNC_CODE_PREFIX + utf8Encode(JSON.stringify({ repo: cfg.repo, token: cfg.token })).replace(/=+$/, '');
  }
  function parseSyncCode(text) {
    const m = String(text || '').trim().match(/VETERAN-SYNC:([A-Za-z0-9+/=_-]+)/);
    if (!m) return null;
    try {
      const j = JSON.parse(utf8Decode(m[1].replace(/-/g, '+').replace(/_/g, '/')));
      if (typeof j.repo === 'string' && typeof j.token === 'string' && j.repo && j.token) return { repo: j.repo, token: j.token };
    } catch (e) { /* code illisible */ }
    return null;
  }
  async function applySyncCode(text) {
    const c = parseSyncCode(text);
    if (!c) { sync.set('missing', 'code non reconnu (il commence par VETERAN-SYNC:)'); return false; }
    const ok = sync.saveCfg(c.repo, c.token);
    renderSyncSettings();
    if (ok) showToast('Configuration reprise : ' + sync.cfg.repo + ' · récupération des morceaux…', 'OK', () => { $('#toast').hidden = true; });
    return ok;
  }
  async function copySyncCode() {
    const code = syncCodeFromCfg(sync.cfg);
    try {
      await navigator.clipboard.writeText(code);
      showToast('Code copié. Sur l\'autre appareil : « Récupérer mes morceaux » → « Coller le code ».', 'OK', () => { $('#toast').hidden = true; });
    } catch (e) {
      // Presse-papiers refusé : on montre le code pour une copie manuelle.
      const el = $('#sync-code');
      el.classList.remove('secret');
      el.value = code;
      el.focus(); el.select();
      showToast('Copiez ce code (tout sélectionné) et collez-le sur l\'autre appareil.', 'OK', () => { $('#toast').hidden = true; });
    }
  }
  async function pasteSyncCode() {
    let text = $('#sync-code').value;
    if (!parseSyncCode(text) && navigator.clipboard?.readText) {
      try { text = await navigator.clipboard.readText(); } catch (e) { /* refusé : on garde le champ */ }
    }
    if (!parseSyncCode(text)) {
      sync.set('missing', 'collez le code dans le champ « Code d\'un autre appareil »');
      $('#sync-code').focus();
      return;
    }
    $('#sync-code').value = '';
    $('#sync-code').classList.add('secret');
    applySyncCode(text);
  }
  function openSyncPanel() {
    const box = $('#sync-settings');
    box.open = true;
    box.scrollIntoView({ block: 'nearest' });
    $('#sync-code').focus();
  }

  function loadSyncCfg() {
    try { return { repo: '', token: '', lastSync: 0, ...JSON.parse(localStorage.getItem(SYNC_KEY) || '{}') }; }
    catch (e) { return { repo: '', token: '', lastSync: 0 }; }
  }

  function merge(remote) {
    const rp = Array.isArray(remote.pieces) ? remote.pieces.map(normalizePiece) : [];
    const rd = (remote.deleted && typeof remote.deleted === 'object') ? remote.deleted : {};
    // Suppressions : union des deux côtés.
    for (const [id, ts] of Object.entries(rd)) state.deleted[id] = Math.max(Number(ts) || 0, state.deleted[id] || 0);
    const byId = new Map(state.pieces.map(p => [p.id, p]));
    for (const r of rp) {
      const l = byId.get(r.id);
      if (!l) state.pieces.push(r);
      else if (r.updatedAt > l.updatedAt) Object.assign(l, r);
    }
    state.pieces = state.pieces.filter(p => !(state.deleted[p.id] && state.deleted[p.id] >= p.updatedAt));
    for (const id of Object.keys(state.deleted)) if (state.pieces.find(p => p.id === id)) delete state.deleted[id];
    if (remote.a4 && remote.savedAt && remote.savedAt > (sync.cfg.lastSync || 0)) state.a4 = clamp(Number(remote.a4) || 440, 400, 480);
    if (!state.pieces.find(p => p.id === state.currentId)) state.currentId = state.pieces[0]?.id || null;
  }

  function utf8Encode(str) {
    const bytes = new TextEncoder().encode(str);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }
  function utf8Decode(b64) {
    const bin = atob(b64.replace(/\n/g, ''));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  function renderSyncSettings() {
    const box = $('#sync-settings');
    box.querySelector('#sync-repo').value = sync.cfg.repo;
    box.querySelector('#sync-token').value = sync.cfg.token;
    box.querySelector('#sync-copy').hidden = !sync.enabled;
  }

  function saveSyncFromFields() {
    const ok = sync.saveCfg($('#sync-repo').value, $('#sync-token').value);
    renderSyncSettings();
    if (ok) {
      $('#sync-settings').open = false;
      showToast('Synchronisation enregistrée : ' + sync.cfg.repo, 'OK', () => { $('#toast').hidden = true; });
    }
  }
  $('#sync-save').addEventListener('click', saveSyncFromFields);
  for (const id of ['#sync-repo', '#sync-token']) {
    $(id).addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); saveSyncFromFields(); } });
  }
  $('#sync-now').addEventListener('click', () => sync.run());
  $('#sync-copy').addEventListener('click', copySyncCode);
  $('#sync-paste').addEventListener('click', pasteSyncCode);
  $('#sync-code').addEventListener('paste', () => setTimeout(() => { if (parseSyncCode($('#sync-code').value)) pasteSyncCode(); }, 0));
  $('#sync-code').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); pasteSyncCode(); } });
  window.addEventListener('online', () => sync.run());
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') sync.run(); });
  renderSyncSettings();
  sync.render();
  if (sync.enabled) sync.run();

  // ---------- Hors ligne (PWA) ----------
  function showToast(text, btnLabel, onClick) {
    const t = $('#toast');
    $('#toast-text').textContent = text;
    const b = $('#toast-btn');
    b.textContent = btnLabel;
    b.onclick = onClick;
    t.hidden = false;
  }

  async function updateCacheStatus() {
    const el = $('#cache-status');
    if (!('caches' in window) || !useWav) { el.textContent = ''; return; }
    try {
      const cache = await caches.open(SAMPLE_CACHE);
      const keys = await cache.keys();
      const have = new Set(keys.map(r => new URL(r.url).pathname.split('/').pop()));
      const n = allSampleUrls().filter(u => have.has(u.split('/').pop())).length;
      const total = allSampleUrls().length;
      el.textContent = n === total ? `${total}/${total} sons disponibles hors ligne` : `${n}/${total} sons hors ligne`;
      $('#cache-all').hidden = n === total;
    } catch (e) { el.textContent = ''; }
  }

  async function cacheAllSamples() {
    const btn = $('#cache-all');
    const el = $('#cache-status');
    btn.disabled = true;
    try {
      const cache = await caches.open(SAMPLE_CACHE);
      const urls = allSampleUrls();
      let done = 0;
      for (const u of urls) {
        if (!(await cache.match(u))) {
          const r = await fetch(u);
          if (!r.ok) throw new Error(u);
          await cache.put(u, r);
        }
        done++;
        el.textContent = `Téléchargement ${done}/${urls.length}…`;
      }
    } catch (e) {
      el.textContent = 'Échec du téléchargement, réessayez.';
    }
    btn.disabled = false;
    updateCacheStatus();
  }

  function registerServiceWorker() {
    if (!('serviceWorker' in navigator) || !useWav) return;
    navigator.serviceWorker.register('sw.js').then(reg => {
      reg.addEventListener('updatefound', () => {
        const w = reg.installing;
        if (!w) return;
        w.addEventListener('statechange', () => {
          if (w.state === 'installed' && navigator.serviceWorker.controller) {
            showToast('Nouvelle version disponible.', 'Recharger', () => location.reload());
          }
        });
      });
    }).catch(err => console.warn('Service worker non enregistré', err));
    navigator.storage?.persist?.();
  }

  $('#cache-all').addEventListener('click', cacheAllSamples);
  registerServiceWorker();
  updateCacheStatus();

  renderAll();
})();
