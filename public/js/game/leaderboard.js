/**
 * Best runs, kept in this browser's localStorage. Nothing is sent anywhere and nothing
 * needs a name: each time a level is played (a "run"), its best buildable design is
 * recorded automatically and updated whenever the run beats itself.
 */

const KEY = 'stellarator:runs:v1';
const KEEP = 300;

function read() {
  try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; }
}

function write(all) {
  try { localStorage.setItem(KEY, JSON.stringify(all)); } catch { /* storage blocked: runs are not kept */ }
}

const byScore = (a, b) => b.score - a.score || a.savedAt.localeCompare(b.savedAt);

export const scoreboard = {
  label: 'Your best runs on this computer. Every time you play a level, its best buildable design is saved here automatically.',

  /** Records the run if this is its best score so far. Returns true when stored. */
  record(entry) {
    const all = read();
    const i = all.findIndex((e) => e.run === entry.run);
    if (i >= 0 && all[i].score >= entry.score && !(entry.beat && !all[i].beat)) return false;
    if (i >= 0) all[i] = entry; else all.push(entry);
    all.sort(byScore);
    write(all.slice(0, KEEP));
    return true;
  },

  /** Top runs on a level, highest score first. */
  list(levelId, n = 10) {
    return read().filter((e) => e.level === levelId).sort(byScore).slice(0, n);
  },
};
