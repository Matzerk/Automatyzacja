<?php
// ════════════════════════════════════════════════════════════════
//  GILOTYNKA 🪓 — instalator (uruchom RAZ).
//  Otwórz w przeglądarce:  .../gilotynka/api/install.php?token=TWOJ_INSTALL_TOKEN
//  Tworzy tabele, konta z config.php (install_users) i opcjonalnie zadania.
//  Po instalacji USUŃ ten plik z serwera (lub zmień install_token).
// ════════════════════════════════════════════════════════════════
require __DIR__ . '/db.php';
header('Content-Type: text/plain; charset=utf-8');

$token = $_GET['token'] ?? '';
if (!hash_equals((string)cfg()['install_token'], (string)$token)) {
  http_response_code(403);
  echo "Zły token. Otwórz: install.php?token=TWOJ_INSTALL_TOKEN (z config.php)\n";
  exit;
}

$log = [];

// 1) Tabele — dziel po ';' i usuwaj linie komentarzy '--' z każdego polecenia
$sql = file_get_contents(__DIR__ . '/schema.sql');
foreach (explode(';', $sql) as $stmt) {
  $clean = implode("\n", array_filter(
    explode("\n", $stmt),
    fn($l) => !str_starts_with(trim($l), '--')
  ));
  $clean = trim($clean);
  if ($clean !== '') db()->exec($clean);
}
$log[] = '✓ Tabele utworzone (lub już istniały).';

// 2) Konta
$created = 0;
foreach (cfg()['install_users'] ?? [] as $u) {
  $email = strtolower(trim($u['email'] ?? ''));
  if (!filter_var($email, FILTER_VALIDATE_EMAIL)) continue;
  $st = db()->prepare('SELECT id FROM users WHERE email = ?');
  $st->execute([$email]);
  if ($st->fetch()) { $log[] = "• pominięto (istnieje): $email"; continue; }
  db()->prepare('INSERT INTO users (email,display_name,pass_hash,role) VALUES (?,?,?,?)')->execute([
    $email,
    trim($u['name'] ?? '') ?: explode('@', $email)[0],
    password_hash((string)($u['password'] ?? ''), PASSWORD_DEFAULT),
    ($u['role'] ?? 'worker') === 'supervisor' ? 'supervisor' : 'worker',
  ]);
  $created++;
  $log[] = "✓ konto: $email ({$u['role']})";
}
$log[] = "✓ Założono kont: $created";

// 3) Przykładowe zadania (raz, jeśli baza pusta i włączone)
if (!empty(cfg()['install_seed'])) {
  $count = (int)db()->query('SELECT COUNT(*) FROM tasks')->fetchColumn();
  if ($count === 0) {
    $sup = db()->query("SELECT id FROM users WHERE role='supervisor' ORDER BY id LIMIT 1")->fetchColumn();
    if ($sup) {
      $seed = [
        ['Ścielenie łóżka','dc','dc','','w_realizacji'],
        ['Worek pod zlew','dc','dc','','w_realizacji'],
        ['Worek — plastiki i papiery','dc','dc','','w_realizacji'],
        ['Rachunki / wyceny','dc','dc','','w_realizacji'],
        ['Kupy — sprzątanie po Lei','dc','dc','','w_realizacji'],
        ['Sznurek na wisterię','once','1','','oczekiwanie'],
        ['Taras — wymycie karherem','once','1','','oczekiwanie'],
        ['Ziemia z warzywnika do worków','once','1','','oczekiwanie'],
        ['Tektury z kotłowni','once','1','','oczekiwanie'],
        ['Montaż warzywników','once','1','','oczekiwanie'],
        ['Zgrabienie liści z trawy','once','1','','oczekiwanie'],
        ['Skoszenie trawy','once','1','','oczekiwanie'],
        ['Wertykulacja trawy','once','1','','oczekiwanie'],
        ['Spacer z Leą','once','1','','oczekiwanie'],
        ['10 ofert pracy + wysłanie CV','once','1','','oczekiwanie'],
        ['Zbadanie opcji mieszkań','once','1','','oczekiwanie'],
        ['Szkolenie motywacyjne','once','1','','oczekiwanie'],
        ['Szukanie ofert pracy','once','1','Rano i przed obiadem','oczekiwanie'],
        ['Nauka na prawo jazdy','once','1','Nauka teorii, testy online','oczekiwanie'],
        ['Pójście na uczelnię','once','3','Pytania do starszych roczników','oczekiwanie'],
        ['Kontakt w sprawie studiów','once','3','','oczekiwanie'],
        ['Zebranie liści z ogrodu','once','3','Przy lepszej pogodzie','oczekiwanie'],
        ['Przesadzenie kwiatków','once','3','','oczekiwanie'],
        ['Wymogi na nowe studia','once','4','','oczekiwanie'],
        ['Prace w ogrodzie na wiosnę','once','4','','oczekiwanie'],
        ['Lodówka (sprawdzenie/uzupełnienie)','cyc','2','','oczekiwanie'],
      ];
      $st = db()->prepare('INSERT INTO tasks (name,type,priority,note,status,created_by) VALUES (?,?,?,?,?,?)');
      foreach ($seed as $s) $st->execute([$s[0],$s[1],$s[2],$s[3],$s[4],$sup]);
      $log[] = '✓ Załadowano przykładowe zadania (' . count($seed) . ').';
    }
  } else {
    $log[] = '• Zadania już są — pomijam seed.';
  }
}

echo implode("\n", $log) . "\n\n";
echo "GOTOWE. Teraz USUŃ ten plik (install.php) z serwera.\n";
echo "Wejdź na: .../gilotynka/  i zaloguj się.\n";
