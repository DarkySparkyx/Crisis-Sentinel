// Diagnostyka środowiska: `npm run doctor`.
const [maj, min, pat] = process.versions.node.split('.').map(Number);
const ok = maj > 22 || (maj === 22 && min >= 6);
const native = maj > 23 || (maj === 23 && min >= 6) || (maj === 22 && min >= 18);

console.log(`\nNode:   ${process.version}   ${ok ? '✓ OK' : '✗ ZA STARY (wymagane >= 22.6)'}`);
console.log(`npm:    ${process.env.npm_config_user_agent?.match(/npm\/([\d.]+)/)?.[1] ?? '?'}`);
console.log(`.ts bez budowania: ${ok ? (native ? 'natywnie' : 'przez --experimental-strip-types (dodawane automatycznie)') : 'NIE'}`);
console.log(`Platforma: ${process.platform} ${process.arch}\n`);

if (!ok) {
  console.error(`Zainstaluj nowszego Node:

    curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.7/install.sh | bash
    exec $SHELL
    nvm install --lts
`);
  process.exit(1);
}
console.log('Środowisko gotowe. Uruchom:  npm test   albo   npm run bench\n');
