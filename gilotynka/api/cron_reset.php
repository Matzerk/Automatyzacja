<?php
// ════════════════════════════════════════════════════════════════
//  GILOTYNKA 🪓 — codzienny reset (uruchamiany przez CRON kei.pl).
//
//  Codzienne (dc):  ukonczone/nie_potrzeby → w_realizacji
//  Cykliczne (cyc): ukonczone            → oczekiwanie
//
//  CRON jako URL (wget/curl):
//    .../gilotynka/api/cron_reset.php?token=TWOJ_CRON_TOKEN
//  CRON jako polecenie PHP (CLI — token niewymagany):
//    php /sciezka/do/gilotynka/api/cron_reset.php
//  Zalecana godzina: 00:05 czasu serwera.
// ════════════════════════════════════════════════════════════════
require __DIR__ . '/db.php';

$isCli = (PHP_SAPI === 'cli');
if (!$isCli) {
  header('Content-Type: text/plain; charset=utf-8');
  $token = $_GET['token'] ?? '';
  if (!hash_equals((string)cfg()['cron_token'], (string)$token)) {
    http_response_code(403);
    echo "Zły token.\n";
    exit;
  }
}

$a = db()->exec("UPDATE tasks SET status='w_realizacji', completed_date=NULL, completed_by=NULL
                 WHERE type='dc' AND status IN ('ukonczone','nie_potrzeby')");
$b = db()->exec("UPDATE tasks SET status='oczekiwanie', completed_date=NULL, completed_by=NULL
                 WHERE type='cyc' AND status='ukonczone'");

echo "Reset OK. Codzienne: {$a}, cykliczne: {$b}\n";
