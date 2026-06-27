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
  case 'bootstrap': {            // jedno żądanie: użytkownicy + zadania
    $me = requireAuth();
    $users = db()->query('SELECT id, display_name, role FROM users ORDER BY display_name')->fetchAll();
    // wykonawca widzi tylko swoje zadania; nadzorca — wszystkie
    if ($me['role'] === 'supervisor') {
      $tasks = db()->query('SELECT * FROM tasks')->fetchAll();
    } else {
      $st = db()->prepare('SELECT * FROM tasks WHERE owner_id = ?');
      $st->execute([$me['id']]);
      $tasks = $st->fetchAll();
    }
    jsonOut([
      'users' => array_map(fn($u) => ['id'=>(int)$u['id'],'name'=>$u['display_name'],'role'=>$u['role']], $users),
      'tasks' => array_map('mapTask', $tasks),
    ]);
  }

  case 'tasks': {
    $me = requireAuth();
    if ($me['role'] === 'supervisor') {
      $rows = db()->query('SELECT * FROM tasks')->fetchAll();
    } else {
      $st = db()->prepare('SELECT * FROM tasks WHERE owner_id = ?');
      $st->execute([$me['id']]);
      $rows = $st->fetchAll();
    }
    jsonOut(['tasks' => array_map('mapTask', $rows)]);
  }

  // ── ZADANIA: tworzenie (nadzorca dla dowolnego pracownika, wykonawca dla siebie) ──
  case 'task_create': {
    $u = requireAuth();
    $b = body();
    $name = trim($b['name'] ?? '');
    if ($name === '') jsonOut(['error' => 'Pusta nazwa'], 400);
    $type = in_array($b['type'] ?? 'once', ['once','dc','cyc'], true) ? $b['type'] : 'once';
    $prio = $type === 'dc' ? 'dc' : (string)(int)($b['priority'] ?? 1);
    $status = $type === 'dc' ? 'w_realizacji' : 'oczekiwanie';
    $hours = parseHours($b['hours'] ?? null);
    // właściciel: nadzorca może przypisać dowolnego (lub nikogo); wykonawca = zawsze on sam
    if ($u['role'] === 'supervisor') {
      $owner = isset($b['owner_id']) && $b['owner_id'] !== null && $b['owner_id'] !== ''
             ? (int)$b['owner_id'] : null;
    } else {
      $owner = (int)$u['id'];
    }
    $st = db()->prepare('INSERT INTO tasks (name,type,priority,note,status,owner_id,hours,created_by) VALUES (?,?,?,?,?,?,?,?)');
    $st->execute([$name, $type, $prio, trim($b['note'] ?? ''), $status, $owner, $hours, $u['id']]);
    jsonOut(['ok' => true, 'id' => (int)db()->lastInsertId()]);
  }

  case 'task_update': {
    $u = requireAuth();
    $b = body();
    $id = (int)($b['id'] ?? 0);
    if (!$id) jsonOut(['error' => 'Brak id'], 400);
    requireTaskAccess($u, $id);                 // wykonawca tylko własne
    $type = in_array($b['type'] ?? 'once', ['once','dc','cyc'], true) ? $b['type'] : 'once';
    $prio = $type === 'dc' ? 'dc' : (string)(int)($b['priority'] ?? 1);
    $hours = parseHours($b['hours'] ?? null);
    // jeśli zmieniono na codzienne a było oczekiwanie → w realizacji
    $st = db()->prepare('SELECT status FROM tasks WHERE id = ?');
    $st->execute([$id]);
    $cur = $st->fetchColumn();
    $setStatus = ($type === 'dc' && $cur === 'oczekiwanie') ? ', status = ' . db()->quote('w_realizacji') : '';
    // tylko nadzorca może zmieniać zlecającego i właściciela (przypisanie)
    if ($u['role'] === 'supervisor') {
      $createdBy = isset($b['created_by']) && $b['created_by'] !== null && $b['created_by'] !== '' ? (int)$b['created_by'] : null;
      $owner = isset($b['owner_id']) && $b['owner_id'] !== null && $b['owner_id'] !== '' ? (int)$b['owner_id'] : null;
      $sql = 'UPDATE tasks SET name=?, type=?, priority=?, note=?, hours=?, created_by=?, owner_id=?' . $setStatus . ' WHERE id=?';
      db()->prepare($sql)->execute([
        trim($b['name'] ?? ''), $type, $prio, trim($b['note'] ?? ''), $hours, $createdBy, $owner, $id,
      ]);
    } else {
      $sql = 'UPDATE tasks SET name=?, type=?, priority=?, note=?, hours=?' . $setStatus . ' WHERE id=?';
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
    if (!$id || !in_array($status, ['oczekiwanie','w_realizacji','ukonczone','nie_potrzeby'], true)) {
      jsonOut(['error' => 'Złe dane'], 400);
    }
    requireTaskAccess($u, $id);                 // wykonawca tylko własne
    if ($status === 'ukonczone') {
      $hours = array_key_exists('hours', $b) ? parseHours($b['hours']) : null;
      if ($hours !== null) {
        db()->prepare('UPDATE tasks SET status=?, completed_date=CURDATE(), completed_by=?, hours=? WHERE id=?')
          ->execute([$status, $u['id'], $hours, $id]);
      } else {
        db()->prepare('UPDATE tasks SET status=?, completed_date=CURDATE(), completed_by=? WHERE id=?')
          ->execute([$status, $u['id'], $id]);
      }
    } else {
      db()->prepare('UPDATE tasks SET status=?, completed_date=NULL, completed_by=NULL WHERE id=?')
        ->execute([$status, $id]);
    }
    jsonOut(['ok' => true]);
  }

  // ── LOG: „odhacz zrobione dziś" — tworzy od razu ukończone zadanie z dzisiejszą datą ──
  case 'task_log': {
    $u = requireAuth();
    $b = body();
    $name = trim($b['name'] ?? '');
    if ($name === '') jsonOut(['error' => 'Pusta nazwa'], 400);
    $type = in_array($b['type'] ?? 'once', ['once','dc','cyc'], true) ? $b['type'] : 'once';
    $prio = $type === 'dc' ? 'dc' : (string)(int)($b['priority'] ?? 1);
    $hours = parseHours($b['hours'] ?? null);
    // właściciel (kto wykonał): nadzorca może wskazać; wykonawca = on sam
    if ($u['role'] === 'supervisor') {
      $owner = isset($b['owner_id']) && $b['owner_id'] !== null && $b['owner_id'] !== ''
             ? (int)$b['owner_id'] : (int)$u['id'];
    } else {
      $owner = (int)$u['id'];
    }
    $st = db()->prepare(
      "INSERT INTO tasks (name,type,priority,note,status,owner_id,hours,created_by,completed_date,completed_by)
       VALUES (?,?,?,?,'ukonczone',?,?,?,CURDATE(),?)"
    );
    $st->execute([$name, $type, $prio, trim($b['note'] ?? ''), $owner, $hours, $u['id'], $owner]);
    jsonOut(['ok' => true, 'id' => (int)db()->lastInsertId()]);
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
