// Uruchamia pliki .ts na każdym wspieranym Node, dobierając flagi do wersji.
// CELOWO .mjs — musi wystartować także tam, gdzie .ts jeszcze nie działa.
//
// Node 22.6-22.17  -> wymaga --experimental-strip-types
// Node 22.18+, 23.6+, 24, 26+ -> type stripping domyślnie, flaga zbędna
//                                (i mogłaby zostać usunięta w przyszłej wersji,
//                                 dlatego NIE dodajemy jej na sztywno)
import { spawnSync } from 'node:child_process';

const [maj, min] = process.versions.node.split('.').map(Number);

if (maj < 22 || (maj === 22 && min < 6)) {
  console.error(`
╭──────────────────────────────────────────────────────────────────────╮
│  ZA STARY NODE                                                       │
╰──────────────────────────────────────────────────────────────────────╯

  Masz:     ${process.version}
  Wymagane: >= 22.6.0

  Ten projekt uruchamia pliki .ts BEZPOŚREDNIO, bez kroku budowania —
  Node potrafi to dopiero od 22.6.

  Instalacja (Linux, bez sudo, nie rusza systemowego node):

      curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.7/install.sh | bash
      exec $SHELL
      nvm install --lts
      node --version

  Szczegóły i wariant przez apt: README.md, sekcja "Rozwiązywanie problemów".
`);
  process.exit(1);
}

const needsFlag = maj === 22 && min < 18;
const args = process.argv.slice(2);
const r = spawnSync(process.execPath, needsFlag ? ['--experimental-strip-types', ...args] : args, {
  stdio: 'inherit',
  env: { ...process.env, NODE_NO_WARNINGS: needsFlag ? '1' : process.env.NODE_NO_WARNINGS ?? '' },
});
process.exit(r.status ?? 1);
