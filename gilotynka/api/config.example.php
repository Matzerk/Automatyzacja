<?php
// ─────────────────────────────────────────────────────────────
//  Skopiuj ten plik jako  config.php  i uzupełnij danymi z kei.pl.
//  Dane do bazy znajdziesz w panelu: Usługi → Bazy danych (MySQL).
// ─────────────────────────────────────────────────────────────
return [

  // ── Połączenie z bazą MySQL ──────────────────────────────────
  'db' => [
    'host' => 'localhost',          // na kei.pl zwykle 'localhost' (lub host z panelu)
    'name' => 'NAZWA_BAZY',         // nazwa bazy MySQL
    'user' => 'UZYTKOWNIK_BAZY',    // użytkownik bazy
    'pass' => 'HASLO_BAZY',         // hasło bazy
  ],

  // ── Tokeny (wpisz własne, losowe ciągi) ──────────────────────
  'install_token' => 'ZMIEN_NA_LOSOWY_CIAG_1',  // chroni install.php
  'cron_token'    => 'ZMIEN_NA_LOSOWY_CIAG_2',   // chroni reset dobowy (CRON)

  // ── Konta zakładane jednorazowo przez install.php ────────────
  //  Po instalacji możesz wyczyścić tę listę (konta zostają w bazie).
  //  role: 'supervisor' (nadzorca) lub 'worker' (wykonawca).
  'install_users' => [
    ['email'=>'tata@example.com', 'name'=>'Tata', 'role'=>'supervisor', 'password'=>'zmien_haslo'],
    ['email'=>'mama@example.com', 'name'=>'Mama', 'role'=>'supervisor', 'password'=>'zmien_haslo'],
    ['email'=>'syn@example.com',  'name'=>'Syn',  'role'=>'worker',     'password'=>'zmien_haslo'],
  ],

  // ── Czy załadować przykładowe zadania przy instalacji? ───────
  'install_seed' => true,
];
