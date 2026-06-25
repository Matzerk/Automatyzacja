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
    'createdBy'     => $r['created_by']   !== null ? (int)$r['created_by']   : null,
    'completedBy'   => $r['completed_by'] !== null ? (int)$r['completed_by'] : null,
    'completedDate' => $r['completed_date'],
  ];
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
    requireAuth();
    $users = db()->query('SELECT id, display_name, role FROM users ORDER BY display_name')->fetchAll();
    $tasks = db()->query('SELECT * FROM tasks')->fetchAll();
    jsonOut([
      'users' => array_map(fn($u) => ['id'=>(int)$u['id'],'name'=>$u['display_name'],'role'=>$u['role']], $users),
      'tasks' => array_map('mapTask', $tasks),
    ]);
  }

  case 'tasks': {
    requireAuth();
    $rows = db()->query('SELECT * FROM tasks')->fetchAll();
    jsonOut(['tasks' => array_map('mapTask', $rows)]);
  }

  // ── ZADANIA: tworzenie/edycja/usuwanie (tylko nadzorca) ────
  case 'task_create': {
    $u = requireSupervisor();
    $b = body();
    $name = trim($b['name'] ?? '');
    if ($name === '') jsonOut(['error' => 'Pusta nazwa'], 400);
    $type = in_array($b['type'] ?? 'once', ['once','dc','cyc'], true) ? $b['type'] : 'once';
    $prio = $type === 'dc' ? 'dc' : (string)(int)($b['priority'] ?? 1);
    $status = $type === 'dc' ? 'w_realizacji' : 'oczekiwanie';
    $st = db()->prepare('INSERT INTO tasks (name,type,priority,note,status,created_by) VALUES (?,?,?,?,?,?)');
    $st->execute([$name, $type, $prio, trim($b['note'] ?? ''), $status, $u['id']]);
    jsonOut(['ok' => true, 'id' => (int)db()->lastInsertId()]);
  }

  case 'task_update': {
    requireSupervisor();
    $b = body();
    $id = (int)($b['id'] ?? 0);
    if (!$id) jsonOut(['error' => 'Brak id'], 400);
    $type = in_array($b['type'] ?? 'once', ['once','dc','cyc'], true) ? $b['type'] : 'once';
    $prio = $type === 'dc' ? 'dc' : (string)(int)($b['priority'] ?? 1);
    $createdBy = isset($b['created_by']) && $b['created_by'] !== null ? (int)$b['created_by'] : null;
    // jeśli zmieniono na codzienne a było oczekiwanie → w realizacji
    $st = db()->prepare('SELECT status FROM tasks WHERE id = ?');
    $st->execute([$id]);
    $cur = $st->fetchColumn();
    $setStatus = ($type === 'dc' && $cur === 'oczekiwanie') ? ', status = ' . db()->quote('w_realizacji') : '';
    $sql = 'UPDATE tasks SET name=?, type=?, priority=?, note=?, created_by=?' . $setStatus . ' WHERE id=?';
    db()->prepare($sql)->execute([
      trim($b['name'] ?? ''), $type, $prio, trim($b['note'] ?? ''), $createdBy, $id,
    ]);
    jsonOut(['ok' => true]);
  }

  case 'task_delete': {
    requireSupervisor();
    $id = (int)(body()['id'] ?? 0);
    if (!$id) jsonOut(['error' => 'Brak id'], 400);
    db()->prepare('DELETE FROM tasks WHERE id = ?')->execute([$id]);
    jsonOut(['ok' => true]);
  }

  // ── STATUS: dozwolone dla obu ról (nadzorca i wykonawca) ───
  case 'task_status': {
    $u = requireAuth();
    $b = body();
    $id = (int)($b['id'] ?? 0);
    $status = $b['status'] ?? '';
    if (!$id || !in_array($status, ['oczekiwanie','w_realizacji','ukonczone','nie_potrzeby'], true)) {
      jsonOut(['error' => 'Złe dane'], 400);
    }
    if ($status === 'ukonczone') {
      db()->prepare('UPDATE tasks SET status=?, completed_date=CURDATE(), completed_by=? WHERE id=?')
        ->execute([$status, $u['id'], $id]);
    } else {
      db()->prepare('UPDATE tasks SET status=?, completed_date=NULL, completed_by=NULL WHERE id=?')
        ->execute([$status, $id]);
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

  default:
    jsonOut(['error' => 'Nieznana akcja'], 404);
}
