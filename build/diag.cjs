const fs = require('fs');
const players = JSON.parse(fs.readFileSync('build/cache/players-parsed.json', 'utf8'));
const show = (t) => {
  const p = players.find((x) => x.title === t);
  if (!p) return console.log(t, '-> NOT FOUND');
  console.log(`\n=== ${p.name} (${p.country}) ===`);
  console.log('traits :', p.traits.join(', '));
  console.log('clubs  :', p._clubs.join(' | '));
};
['Abdul Razzaq', 'Virat Kohli', 'Aakash Chopra', 'Shahid Afridi', 'Ravichandran Ashwin']
  .forEach(show);

// How widespread is the false-pacer/spinner problem?
const roles = {};
for (const p of players) for (const t of p.traits) roles[t] = 0;
const roleText = {};
console.log('\n=== trait vs role cross-check (sample of 12) ===');
let n = 0;
for (const p of players) {
  if (n >= 12) break;
  if (p.traits.includes('pacer') || p.traits.includes('spinner')) {
    console.log(`  ${p.name.padEnd(26)} ${p.traits.filter((t) => t === 'pacer' || t === 'spinner').join(',')} | stats.w=${(p.stats.test_w || 0) + (p.stats.odi_w || 0)}`);
    n++;
  }
}
console.log('\nplayers with NO country trait:',
  players.filter((p) => !p.traits.some((t) => ['india', 'pakistan', 'australia', 'england', 'southafrica', 'newzealand', 'srilanka', 'westindies', 'bangladesh', 'afghanistan', 'zimbabwe', 'ireland'].includes(t))).length);
