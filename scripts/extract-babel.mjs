import fs from 'node:fs';

const re =
  /<script type="text\/babel">\s*([\s\S]*?)\s*<\/script>\s*<\/body>/i;

for (const [name, out] of [
  ['DispatchOrderPrototype.html', 'src/DispatchApp.raw.jsx'],
  ['FactoryTabletPrototype.html', 'src/FactoryApp.raw.jsx'],
]) {
  const t = fs.readFileSync(name, 'utf8');
  const m = t.match(re);
  if (!m) throw new Error(`No babel block: ${name}`);
  fs.writeFileSync(out, m[1]);
  console.log(out, m[1].length);
}
