<?php
// ─────────────────────────────────────────────────────────────
//  Wspólny bootstrap: konfiguracja, połączenie PDO, sesja, helpery.
// ─────────────────────────────────────────────────────────────
declare(strict_types=1);

mb_internal_encoding('UTF-8');

function cfg(): array {
  static $c = null;
  if ($c === null) {
    $path = __DIR__ . '/config.php';
    if (!file_exists($path)) {
      http_response_code(500);
      header('Content-Type: application/json; charset=utf-8');
      echo json_encode(['error' => 'Brak api/config.php — skopiuj config.example.php i uzupełnij.']);
      exit;
    }
    $c = require $path;
  }
  return $c;
}

function db(): PDO {
  static $pdo = null;
  if ($pdo === null) {
    $d = cfg()['db'];
    $dsn = "mysql:host={$d['host']};dbname={$d['name']};charset=utf8mb4";
    try {
      $pdo = new PDO($dsn, $d['user'], $d['pass'], [
        PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES   => false,
      ]);
    } catch (Throwable $e) {
      jsonOut(['error' => 'Błąd połączenia z bazą.'], 500);
    }
  }
  return $pdo;
}

// ── Sesja (cookie httponly + SameSite=Lax) ──────────────────
function startSession(): void {
  if (session_status() === PHP_SESSION_ACTIVE) return;
  $https = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
        || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https');
  session_set_cookie_params([
    'lifetime' => 0,
    'path'     => '/',
    'httponly' => true,
    'samesite' => 'Lax',
    'secure'   => $https,
  ]);
  session_name('GILOSESS');
  session_start();
}

// ── Helpery odpowiedzi / wejścia ────────────────────────────
function jsonOut($data, int $code = 200): void {
  http_response_code($code);
  header('Content-Type: application/json; charset=utf-8');
  echo json_encode($data, JSON_UNESCAPED_UNICODE);
  exit;
}

function body(): array {
  $raw = file_get_contents('php://input');
  if ($raw === '' || $raw === false) return $_POST ?: [];
  $j = json_decode($raw, true);
  return is_array($j) ? $j : [];
}

// ── Autoryzacja ─────────────────────────────────────────────
function currentUser(): ?array {
  startSession();
  if (empty($_SESSION['uid'])) return null;
  $st = db()->prepare('SELECT id, email, display_name, role FROM users WHERE id = ?');
  $st->execute([$_SESSION['uid']]);
  $u = $st->fetch();
  return $u ?: null;
}

function requireAuth(): array {
  $u = currentUser();
  if (!$u) jsonOut(['error' => 'Niezalogowany'], 401);
  return $u;
}

function requireSupervisor(): array {
  $u = requireAuth();
  if ($u['role'] !== 'supervisor') jsonOut(['error' => 'Brak uprawnień'], 403);
  return $u;
}

// ── Ochrona CSRF: mutacje muszą mieć nagłówek X-Requested-With ─
function requireSameOrigin(): void {
  if (($_SERVER['HTTP_X_REQUESTED_WITH'] ?? '') !== 'gilotynka') {
    jsonOut(['error' => 'Nieprawidłowe żądanie'], 400);
  }
}
