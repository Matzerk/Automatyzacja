<?php
// ════════════════════════════════════════════════════════════════
//  GILOTYNKA 🪓 — API (PHP + MySQL).  Wszystkie akcje przez ?action=
//  Mutacje wymagają nagłówka  X-Requested-With: gilotynka  (anty-CSRF).
// ════════════════════════════════════════════════════════════════
require __DIR__ . '/db.php';

$action = $_GET['action'] ?? '';
$method = $_SERVER['REQUEST_METHOD'];
$isMutation = ($method === 'POST');
if ($isMutation) requireSameOrigin();

// mapowanie wiersza zadania -> kształt dla frontu
function mapTask(array $r): array {
  return [
    'id'            => (int)$r['id'],
    'name'          => $r['name'],
    't'             => $r['type'],
    'p'             => $r['priority'] === 'dc' ? 'dc'
                       : (ctype_digit((string)$r['priority']) ? (int)$r['priority'] : $r['priority']),
    'note'          => $r['note'] ?? '',
    'status'        => $r['status'],
    'ownerId'       => $r['owner_id']     !== null ? (int)$r['owner_id']     : null,
    'hours'         => $r['hours']        !== null ? (float)$r['hours']      : null,
    'createdBy'     => $r['created_by']   !== null ? (int)$r['created_by']   : null,
    'completedBy'   => $r['completed_by'] !== null ? (int)$r['completed_by'] : null,
    'completedDate' => $r['completed_date'],
  ];
}

// mapowanie szablonu -> kształt dla frontu
function mapTpl(array $r): array {
  return [
    'id'        => (int)$r['id'],
    'name'      => $r['name'],
    't'         => $r['type'],
    'p'         => ctype_digit((string)$r['priority']) ? (int)$r['priority'] : $r['priority'],
    'note'      => $r['note'] ?? '',
    'createdBy' => $r['created_by'] !== null ? (int)$r['created_by'] : null,
    'ownerId'   => $r['owner_id']   !== null ? (int)$r['owner_id']   : null,
  ];
}

function mapLog(array $r): array {
  return [
    'id'       => (int)$r['id'],
    'taskId'   => $r['task_id'] !== null ? (int)$r['task_id'] : null,
    'workerId' => (int)$r['worker_id'],
    'date'     => $r['work_date'],
    'hours'    => (float)$r['hours'],
    'note'     => $r['note'] ?? '',
  ];
}
function mapNote(array $r): array {
  return [
    'id'        => (int)$r['id'],
    'taskId'    => (int)$r['task_id'],
    'authorId'  => $r['author_id'] !== null ? (int)$r['author_id'] : null,
    'body'      => $r['body'],
    'emailed'   => (int)$r['emailed'] === 1,
    'createdAt' => $r['created_at'],
  ];
}
function mapCal(array $r): array {
  return [
    'day'        => $r['day'],
    'isOff'      => (int)$r['is_off'] === 1,
    'availHours' => $r['avail_hours'] !== null ? (float)$r['avail_hours'] : null,
  ];
}

// pobiera zadania + rejestr godzin w zakresie roli (nadzorca: wszystko; wykonawca: własne)
function fetchTasksLogs(array $me): array {
  if ($me['role'] === 'supervisor') {
    $tasks = db()->query('SELECT * FROM tasks')->fetchAll();
    $logs  = db()->query('SELECT * FROM work_log')->fetchAll();
  } else {
    $st = db()->prepare('SELECT * FROM tasks WHERE owner_id=?'); $st->execute([$me['id']]); $tasks = $st->fetchAll();
    $st = db()->prepare('SELECT * FROM work_log WHERE worker_id=?'); $st->execute([$me['id']]); $logs = $st->fetchAll();
  }
  return ['tasks' => array_map('mapTask', $tasks), 'logs' => array_map('mapLog', $logs)];
}

// godziny: '' / null -> NULL, w przeciwnym razie liczba >= 0 (krok 0.5 nie wymuszany)
function parseHours($v) {
  if ($v === null || $v === '' ) return null;
  if (!is_numeric($v)) return null;
  $h = (float)$v;
  return $h < 0 ? null : round($h, 1);
}

// zwraca owner_id zadania albo false jeśli nie istnieje
function taskOwner(int $id) {
  $st = db()->prepare('SELECT owner_id FROM tasks WHERE id = ?');
  $st->execute([$id]);
  $r = $st->fetch();
  if (!$r) return false;
  return $r['owner_id'] !== null ? (int)$r['owner_id'] : null;
}

// wykonawca może działać tylko na własnych zadaniach; nadzorca na wszystkich
function requireTaskAccess(array $u, int $id): void {
  if ($u['role'] === 'supervisor') return;
  $owner = taskOwner($id);
  if ($owner === false) jsonOut(['error' => 'Nie ma takiego zadania'], 404);
  if ($owner !== (int)$u['id']) jsonOut(['error' => 'To nie jest Twoje zadanie'], 403);
}

switch ($action) {

  // ── AUTH ───────────────────────────────────────────────────
  case 'login': {
    $b = body();
    $email = strtolower(trim($b['email'] ?? ''));
    $pass  = (string)($b['password'] ?? '');
    if ($email === '' || $pass === '') jsonOut(['error' => 'Podaj e-mail i hasło.'], 400);
    $st = db()->prepare('SELECT * FROM users WHERE email = ?');
    $st->execute([$email]);
    $u = $st->fetch();
    if (!$u || !password_verify($pass, $u['pass_hash'])) {
      jsonOut(['error' => 'Błędny e-mail lub hasło.'], 401);
    }
    startSession();
    session_regenerate_id(true);
    $_SESSION['uid'] = (int)$u['id'];
    jsonOut(['user' => ['id'=>(int)$u['id'],'email'=>$u['email'],'name'=>$u['display_name'],'role'=>$u['role']]]);
  }

  case 'logout': {
    startSession();
    $_SESSION = [];
    session_destroy();
    jsonOut(['ok' => true]);
  }

  case 'me': {
    $u = currentUser();
    if (!$u) jsonOut(['user' => null]);
    jsonOut(['user' => ['id'=>(int)$u['id'],'email'=>$u['email'],'name'=>$u['display_name'],'role'=>$u['role']]]);
  }

  // ── DANE ───────────────────────────────────────────────────
  case 'bootstrap': {            // jedno żądanie: użytkownicy + zadania + rejestr godzin
    $me = requireAuth();
    $users = db()->query('SELECT id, display_name, role FROM users ORDER BY display_name')->fetchAll();
    $tl = fetchTasksLogs($me);
    jsonOut([
      'users' => array_map(fn($u) => ['id'=>(int)$u['id'],'name'=>$u['display_name'],'role'=>$u['role']], $users),
      'tasks' => $tl['tasks'],
      'logs'  => $tl['logs'],
    ]);
  }

  case 'tasks': {                // odświeżanie: zadania + rejestr godzin
    $me = requireAuth();
    jsonOut(fetchTasksLogs($me));
  }

  // ── ZADANIA: tworzenie (nadzorca dla dowolnego pracownika, wykonawca dla siebie) ──
  case 'task_create': {
    $u = requireAuth();
    $b = body();
    $name = trim($b['name'] ?? '');
    if ($name === '') jsonOut(['error' => 'Pusta nazwa'], 400);
    $type = in_array($b['type'] ?? 'once', ['once','cyc'], true) ? $b['type'] : 'once';
    $prio = (string) max(1, min(10, (int)($b['priority'] ?? 5)));
    $hours = parseHours($b['hours'] ?? null);
    // właściciel: nadzorca może przypisać dowolnego (lub nikogo); wykonawca = zawsze on sam
    if ($u['role'] === 'supervisor') {
      $owner = isset($b['owner_id']) && $b['owner_id'] !== null && $b['owner_id'] !== ''
             ? (int)$b['owner_id'] : null;
    } else {
      $owner = (int)$u['id'];
    }
    $st = db()->prepare("INSERT INTO tasks (name,type,priority,note,status,owner_id,hours,created_by) VALUES (?,?,?,?,'na_liscie',?,?,?)");
    $st->execute([$name, $type, $prio, trim($b['note'] ?? ''), $owner, $hours, $u['id']]);
    jsonOut(['ok' => true, 'id' => (int)db()->lastInsertId()]);
  }

  case 'task_update': {
    $u = requireAuth();
    $b = body();
    $id = (int)($b['id'] ?? 0);
    if (!$id) jsonOut(['error' => 'Brak id'], 400);
    requireTaskAccess($u, $id);                 // wykonawca tylko własne
    $type = in_array($b['type'] ?? 'once', ['once','cyc'], true) ? $b['type'] : 'once';
    $prio = (string) max(1, min(10, (int)($b['priority'] ?? 5)));
    $hours = parseHours($b['hours'] ?? null);
    // tylko nadzorca może zmieniać zlecającego i właściciela (przypisanie)
    if ($u['role'] === 'supervisor') {
      $createdBy = isset($b['created_by']) && $b['created_by'] !== null && $b['created_by'] !== '' ? (int)$b['created_by'] : null;
      $owner = isset($b['owner_id']) && $b['owner_id'] !== null && $b['owner_id'] !== '' ? (int)$b['owner_id'] : null;
      $sql = 'UPDATE tasks SET name=?, type=?, priority=?, note=?, hours=?, created_by=?, owner_id=? WHERE id=?';
      db()->prepare($sql)->execute([
        trim($b['name'] ?? ''), $type, $prio, trim($b['note'] ?? ''), $hours, $createdBy, $owner, $id,
      ]);
    } else {
      $sql = 'UPDATE tasks SET name=?, type=?, priority=?, note=?, hours=? WHERE id=?';
      db()->prepare($sql)->execute([
        trim($b['name'] ?? ''), $type, $prio, trim($b['note'] ?? ''), $hours, $id,
      ]);
    }
    jsonOut(['ok' => true]);
  }

  case 'task_delete': {
    $u = requireAuth();
    $id = (int)(body()['id'] ?? 0);
    if (!$id) jsonOut(['error' => 'Brak id'], 400);
    requireTaskAccess($u, $id);                 // wykonawca tylko własne
    db()->prepare('DELETE FROM tasks WHERE id = ?')->execute([$id]);
    jsonOut(['ok' => true]);
  }

  // ── GODZINY: ustawienie czasu pracy (własne zadanie lub nadzorca) ──
  case 'task_hours': {
    $u = requireAuth();
    $b = body();
    $id = (int)($b['id'] ?? 0);
    if (!$id) jsonOut(['error' => 'Brak id'], 400);
    requireTaskAccess($u, $id);
    $hours = parseHours($b['hours'] ?? null);
    db()->prepare('UPDATE tasks SET hours=? WHERE id=?')->execute([$hours, $id]);
    jsonOut(['ok' => true]);
  }

  // ── STATUS: dozwolone dla obu ról (wykonawca tylko własne) ───
  case 'task_status': {
    $u = requireAuth();
    $b = body();
    $id = (int)($b['id'] ?? 0);
    $status = $b['status'] ?? '';
    if (!$id || !in_array($status, ['na_liscie','trwajace','zawieszone','zamkniete'], true)) {
      jsonOut(['error' => 'Złe dane'], 400);
    }
    requireTaskAccess($u, $id);                 // wykonawca tylko własne
    if ($status === 'zamkniete') {
      db()->prepare('UPDATE tasks SET status=?, completed_date=CURDATE(), completed_by=? WHERE id=?')
        ->execute([$status, $u['id'], $id]);
    } else {
      db()->prepare('UPDATE tasks SET status=?, completed_date=NULL, completed_by=NULL WHERE id=?')
        ->execute([$status, $id]);
    }
    jsonOut(['ok' => true]);
  }

  // ── REJESTR GODZIN (wpis = godziny pracownika nad zadaniem danego dnia) ──
  case 'logs': {
    $me = requireAuth();
    $from = preg_match('/^\d{4}-\d{2}-\d{2}$/', $_GET['from'] ?? '') ? $_GET['from'] : null;
    $to   = preg_match('/^\d{4}-\d{2}-\d{2}$/', $_GET['to']   ?? '') ? $_GET['to']   : null;
    $cond = []; $args = [];
    if ($me['role'] !== 'supervisor') { $cond[] = 'worker_id=?'; $args[] = $me['id']; }
    if ($from) { $cond[] = 'work_date>=?'; $args[] = $from; }
    if ($to)   { $cond[] = 'work_date<=?'; $args[] = $to; }
    $sql = 'SELECT * FROM work_log' . ($cond ? ' WHERE ' . implode(' AND ', $cond) : '') . ' ORDER BY work_date DESC, id DESC';
    $st = db()->prepare($sql); $st->execute($args);
    jsonOut(['logs' => array_map('mapLog', $st->fetchAll())]);
  }

  case 'log_add': {
    $u = requireAuth();
    $b = body();
    $hours = parseHours($b['hours'] ?? null);
    if ($hours === null || $hours <= 0) jsonOut(['error' => 'Podaj liczbę godzin > 0.'], 400);
    $taskId = isset($b['task_id']) && $b['task_id'] !== '' && $b['task_id'] !== null ? (int)$b['task_id'] : null;
    $date = preg_match('/^\d{4}-\d{2}-\d{2}$/', $b['work_date'] ?? '') ? $b['work_date'] : date('Y-m-d');
    // pracownik = on sam; nadzorca może wskazać worker_id
    $worker = ($u['role'] === 'supervisor' && isset($b['worker_id']) && $b['worker_id'] !== '' && $b['worker_id'] !== null)
            ? (int)$b['worker_id'] : (int)$u['id'];
    if ($taskId !== null) {
      $owner = taskOwner($taskId);
      if ($owner === false) jsonOut(['error' => 'Nie ma takiego zadania'], 404);
      if ($u['role'] !== 'supervisor' && $owner !== (int)$u['id']) jsonOut(['error' => 'To nie jest Twoje zadanie'], 403);
      // „pobranie" zadania: na liście -> trwające
      db()->prepare("UPDATE tasks SET status='trwajace' WHERE id=? AND status='na_liscie'")->execute([$taskId]);
    }
    db()->prepare('INSERT INTO work_log (task_id,worker_id,work_date,hours,note) VALUES (?,?,?,?,?)')
      ->execute([$taskId, $worker, $date, $hours, trim($b['note'] ?? '')]);
    jsonOut(['ok' => true, 'id' => (int)db()->lastInsertId()]);
  }

  case 'log_delete': {
    $u = requireAuth();
    $id = (int)(body()['id'] ?? 0);
    if (!$id) jsonOut(['error' => 'Brak id'], 400);
    $st = db()->prepare('SELECT worker_id FROM work_log WHERE id=?'); $st->execute([$id]); $r = $st->fetch();
    if (!$r) jsonOut(['error' => 'Nie ma takiego wpisu'], 404);
    if ($u['role'] !== 'supervisor' && (int)$r['worker_id'] !== (int)$u['id']) jsonOut(['error' => 'To nie Twój wpis.'], 403);
    db()->prepare('DELETE FROM work_log WHERE id=?')->execute([$id]);
    jsonOut(['ok' => true]);
  }

  // ── UWAGI do zadania (opcjonalnie e-mail na porady@eporady24.pl) ──
  case 'task_notes': {
    $u = requireAuth();
    $id = (int)($_GET['task_id'] ?? 0);
    if (!$id) jsonOut(['error' => 'Brak id'], 400);
    requireTaskAccess($u, $id);
    $st = db()->prepare('SELECT * FROM task_notes WHERE task_id=? ORDER BY id DESC'); $st->execute([$id]);
    jsonOut(['notes' => array_map('mapNote', $st->fetchAll())]);
  }

  case 'task_note': {
    $u = requireAuth();
    $b = body();
    $id = (int)($b['task_id'] ?? 0);
    $text = trim($b['body'] ?? '');
    if (!$id || $text === '') jsonOut(['error' => 'Brak zadania lub treści uwagi.'], 400);
    requireTaskAccess($u, $id);
    $send = !empty($b['send']);
    $emailed = 0;
    if ($send) {
      $st = db()->prepare('SELECT name FROM tasks WHERE id=?'); $st->execute([$id]);
      $tname = (string)$st->fetchColumn();
      $subject = '[Gilotynka] Uwaga do zadania: ' . $tname;
      $msg = "Zadanie: $tname\nOd: {$u['display_name']} <{$u['email']}>\n\n$text\n";
      $headers = 'From: Gilotynka <gilotynka@miroslawkielar.com>' . "\r\n"
               . 'Reply-To: ' . $u['email'] . "\r\n"
               . 'Content-Type: text/plain; charset=UTF-8';
      if (@mail('porady@eporady24.pl', $subject, $msg, $headers)) $emailed = 1;
    }
    db()->prepare('INSERT INTO task_notes (task_id,author_id,body,emailed) VALUES (?,?,?,?)')
      ->execute([$id, $u['id'], $text, $emailed]);
    jsonOut(['ok' => true, 'sendRequested' => $send, 'emailed' => $emailed === 1]);
  }

  // ── KALENDARZ: dni wolne + godziny dostępności (pracownik własne, nadzorca dowolne) ──
  case 'calendar_get': {
    $me = requireAuth();
    $uid = ($me['role'] === 'supervisor' && isset($_GET['user_id']) && $_GET['user_id'] !== '')
         ? (int)$_GET['user_id'] : (int)$me['id'];
    $from = preg_match('/^\d{4}-\d{2}-\d{2}$/', $_GET['from'] ?? '') ? $_GET['from'] : null;
    $to   = preg_match('/^\d{4}-\d{2}-\d{2}$/', $_GET['to']   ?? '') ? $_GET['to']   : null;
    $cond = ['user_id=?']; $args = [$uid];
    if ($from) { $cond[] = 'day>=?'; $args[] = $from; }
    if ($to)   { $cond[] = 'day<=?'; $args[] = $to; }
    $st = db()->prepare('SELECT * FROM calendar WHERE ' . implode(' AND ', $cond)); $st->execute($args);
    $days = array_map('mapCal', $st->fetchAll());
    $year = preg_match('/^\d{4}$/', $_GET['year'] ?? '') ? $_GET['year'] : date('Y');
    $cs = db()->prepare('SELECT COUNT(*) FROM calendar WHERE user_id=? AND is_off=1 AND YEAR(day)=?');
    $cs->execute([$uid, $year]);
    jsonOut(['userId' => $uid, 'days' => $days, 'offThisYear' => (int)$cs->fetchColumn(), 'year' => (int)$year]);
  }

  case 'calendar_set': {
    $me = requireAuth();
    $b = body();
    $uid = ($me['role'] === 'supervisor' && isset($b['user_id']) && $b['user_id'] !== '' && $b['user_id'] !== null)
         ? (int)$b['user_id'] : (int)$me['id'];
    $day = $b['day'] ?? '';
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $day)) jsonOut(['error' => 'Zła data'], 400);
    $st = db()->prepare('SELECT * FROM calendar WHERE user_id=? AND day=?'); $st->execute([$uid, $day]); $cur = $st->fetch();
    $isOff = array_key_exists('is_off', $b) ? (!empty($b['is_off']) ? 1 : 0) : ($cur ? (int)$cur['is_off'] : 0);
    $avail = array_key_exists('avail_hours', $b)
           ? ($b['avail_hours'] === '' || $b['avail_hours'] === null ? null : (float)$b['avail_hours'])
           : ($cur && $cur['avail_hours'] !== null ? (float)$cur['avail_hours'] : null);
    if ($isOff === 0 && $avail === null) {
      db()->prepare('DELETE FROM calendar WHERE user_id=? AND day=?')->execute([$uid, $day]);
    } elseif ($cur) {
      db()->prepare('UPDATE calendar SET is_off=?, avail_hours=? WHERE user_id=? AND day=?')->execute([$isOff, $avail, $uid, $day]);
    } else {
      db()->prepare('INSERT INTO calendar (user_id,day,is_off,avail_hours) VALUES (?,?,?,?)')->execute([$uid, $day, $isOff, $avail]);
    }
    jsonOut(['ok' => true]);
  }

  // ── KONTA: zarządzanie użytkownikami (tylko nadzorca) ──────
  case 'user_create': {
    requireSupervisor();
    $b = body();
    $email = strtolower(trim($b['email'] ?? ''));
    $pass  = (string)($b['password'] ?? '');
    if (!filter_var($email, FILTER_VALIDATE_EMAIL) || strlen($pass) < 6) {
      jsonOut(['error' => 'Podaj poprawny e-mail i hasło min. 6 znaków.'], 400);
    }
    $role = ($b['role'] ?? 'worker') === 'supervisor' ? 'supervisor' : 'worker';
    $name = trim($b['name'] ?? '') ?: explode('@', $email)[0];
    try {
      db()->prepare('INSERT INTO users (email,display_name,pass_hash,role) VALUES (?,?,?,?)')
        ->execute([$email, $name, password_hash($pass, PASSWORD_DEFAULT), $role]);
    } catch (PDOException $e) {
      jsonOut(['error' => 'Taki e-mail już istnieje.'], 409);
    }
    jsonOut(['ok' => true]);
  }

  case 'user_update': {       // zmiana imienia/roli/hasła
    $me = requireSupervisor();
    $b = body();
    $id = (int)($b['id'] ?? 0);
    if (!$id) jsonOut(['error' => 'Brak id'], 400);
    $name = trim($b['name'] ?? '');
    $role = ($b['role'] ?? '') === 'supervisor' ? 'supervisor'
          : (($b['role'] ?? '') === 'worker' ? 'worker' : null);
    if ($name !== '') db()->prepare('UPDATE users SET display_name=? WHERE id=?')->execute([$name, $id]);
    if ($role !== null) db()->prepare('UPDATE users SET role=? WHERE id=?')->execute([$role, $id]);
    if (!empty($b['password'])) {
      if (strlen((string)$b['password']) < 6) jsonOut(['error' => 'Hasło min. 6 znaków.'], 400);
      db()->prepare('UPDATE users SET pass_hash=? WHERE id=?')
        ->execute([password_hash((string)$b['password'], PASSWORD_DEFAULT), $id]);
    }
    jsonOut(['ok' => true]);
  }

  case 'user_delete': {
    $me = requireSupervisor();
    $id = (int)(body()['id'] ?? 0);
    if (!$id) jsonOut(['error' => 'Brak id'], 400);
    if ($id === (int)$me['id']) jsonOut(['error' => 'Nie usuniesz własnego konta.'], 400);
    db()->prepare('DELETE FROM users WHERE id = ?')->execute([$id]);
    jsonOut(['ok' => true]);
  }

  case 'users': {
    requireSupervisor();
    $rows = db()->query('SELECT id, email, display_name, role, created_at FROM users ORDER BY role, display_name')->fetchAll();
    jsonOut(['users' => array_map(fn($u) => [
      'id'=>(int)$u['id'],'email'=>$u['email'],'name'=>$u['display_name'],'role'=>$u['role']
    ], $rows)]);
  }

  // ── LISTY ZADAŃ (szablony): osobne per pracownik; owner_id NULL = wspólne ────
  case 'templates': {
    $u = requireAuth();
    if ($u['role'] === 'supervisor') {
      $rows = db()->query('SELECT * FROM templates ORDER BY name')->fetchAll();
    } else {
      $st = db()->prepare('SELECT * FROM templates WHERE owner_id = ? OR owner_id IS NULL ORDER BY name');
      $st->execute([$u['id']]);
      $rows = $st->fetchAll();
    }
    jsonOut(['templates' => array_map('mapTpl', $rows)]);
  }

  case 'template_create': {
    $u = requireAuth();
    $b = body();
    $name = trim($b['name'] ?? '');
    if ($name === '') jsonOut(['error' => 'Pusta nazwa'], 400);
    $type = in_array($b['type'] ?? 'once', ['once','dc','cyc'], true) ? $b['type'] : 'once';
    $prio = $type === 'dc' ? 'dc' : (string)(int)($b['priority'] ?? 1);
    // właściciel listy: nadzorca wskazuje pracownika (lub NULL = wspólne); wykonawca = on sam
    if ($u['role'] === 'supervisor') {
      $owner = isset($b['owner_id']) && $b['owner_id'] !== null && $b['owner_id'] !== ''
             ? (int)$b['owner_id'] : null;
    } else {
      $owner = (int)$u['id'];
    }
    $st = db()->prepare('INSERT INTO templates (name,type,priority,note,created_by,owner_id) VALUES (?,?,?,?,?,?)');
    $st->execute([$name, $type, $prio, trim($b['note'] ?? ''), $u['id'], $owner]);
    jsonOut(['ok' => true, 'id' => (int)db()->lastInsertId()]);
  }

  case 'template_delete': {
    $u = requireAuth();
    $id = (int)(body()['id'] ?? 0);
    if (!$id) jsonOut(['error' => 'Brak id'], 400);
    $st = db()->prepare('SELECT owner_id FROM templates WHERE id = ?');
    $st->execute([$id]);
    $r = $st->fetch();
    if (!$r) jsonOut(['error' => 'Nie ma takiego zadania'], 404);
    // wykonawca usuwa tylko zadania ze swojej listy; nadzorca dowolne
    if ($u['role'] !== 'supervisor' && (int)$r['owner_id'] !== (int)$u['id']) {
      jsonOut(['error' => 'Możesz usuwać tylko zadania ze swojej listy.'], 403);
    }
    db()->prepare('DELETE FROM templates WHERE id = ?')->execute([$id]);
    jsonOut(['ok' => true]);
  }

  default:
    jsonOut(['error' => 'Nieznana akcja'], 404);
}
