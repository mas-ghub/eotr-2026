const BASE = 'http://localhost:4174';
const html = await (await fetch(BASE + '/')).text();
console.log('HTML scripts:', [...html.matchAll(/src="([^"]+\.js)"/g)].map((m) => m[1]));
const entry = [...html.matchAll(/src="([^"]+\.js)"/g)].map((m) => m[1])[0];
const assets = await (await fetch(BASE + '/' + entry)).text();
console.log('entry contains devtest_:', assets.includes('devtest_'));
console.log('entry chunk links:', [...assets.matchAll(/(?:import\(|from)\s*['"]\.?\/?([^'"]+\.js)['"]/g)].map((m) => m[1]).slice(0, 20));
const full = await (await fetch(BASE + '/' + 'index-DYsNz2aX.js')).text();
console.log('main chunk contains devtest_:', full.includes('devtest_'));
