-- ════════════════════════════════════════════════════════════════
--  GILOTYNKA 🪓 — schemat bazy MySQL (hosting kei.pl)
--  Import: panel kei.pl → Bazy danych → phpMyAdmin → zakładka Import,
--  ALBO uruchom raz api/install.php (utworzy tabele automatycznie).
-- ════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS users (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  email         VARCHAR(190) NOT NULL UNIQUE,
  display_name  VARCHAR(100) NOT NULL DEFAULT '',
  pass_hash     VARCHAR(255) NOT NULL,
  role          ENUM('supervisor','worker') NOT NULL DEFAULT 'worker',
  created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS tasks (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  name            VARCHAR(255) NOT NULL,
  type            ENUM('once','dc','cyc') NOT NULL DEFAULT 'once',  -- once=jednorazowe, cyc=cykliczne
  priority        VARCHAR(4) NOT NULL DEFAULT '5',         -- '1'..'10' (mniejsza = wyżej)
  note            TEXT,
  status          VARCHAR(20) NOT NULL DEFAULT 'na_liscie',-- na_liscie / trwajace / zawieszone / zamkniete
  owner_id        INT NULL,                                -- pracownik wykonujący (do kogo należy zadanie)
  hours           DECIMAL(5,1) NULL,                       -- (niewykorzystane: godziny liczy work_log)
  created_by      INT NULL,                                -- kto utworzył/zlecił
  completed_by    INT NULL,
  completed_date  DATE NULL,
  created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_owner_id    FOREIGN KEY (owner_id)     REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_created_by  FOREIGN KEY (created_by)   REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_completed_by FOREIGN KEY (completed_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_status (status),
  INDEX idx_owner_id (owner_id),
  INDEX idx_created_by (created_by)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Szablony zadań („pula") — wspólna biblioteka. Szef i wykonawca mogą dodawać,
-- wszyscy widzą i dobierają z niej do swoich zadań.
CREATE TABLE IF NOT EXISTS templates (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  name          VARCHAR(255) NOT NULL,
  type          ENUM('once','dc','cyc') NOT NULL DEFAULT 'once',
  priority      VARCHAR(4) NOT NULL DEFAULT '1',
  note          TEXT,
  created_by    INT NULL,
  owner_id      INT NULL,
  created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_tpl_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_tpl_owner_id   FOREIGN KEY (owner_id)   REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_tpl_owner (owner_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Rejestr godzin: wpis = ile godzin dany pracownik przepracował nad zadaniem w danym dniu.
-- Zadanie może trwać kilka dni → wiele wpisów. Raporty sumują po dniu/tygodniu/miesiącu/okresie.
CREATE TABLE IF NOT EXISTS work_log (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  task_id     INT NULL,
  worker_id   INT NOT NULL,
  work_date   DATE NOT NULL,
  hours       DECIMAL(5,1) NOT NULL DEFAULT 0,
  note        TEXT,
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_wl_task   FOREIGN KEY (task_id)   REFERENCES tasks(id) ON DELETE CASCADE,
  CONSTRAINT fk_wl_worker FOREIGN KEY (worker_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_wl_date (work_date),
  INDEX idx_wl_worker (worker_id),
  INDEX idx_wl_task (task_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Uwagi do zadania (z opcją wysłania e-maila na porady@eporady24.pl).
CREATE TABLE IF NOT EXISTS task_notes (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  task_id     INT NOT NULL,
  author_id   INT NULL,
  body        TEXT NOT NULL,
  emailed     TINYINT(1) NOT NULL DEFAULT 0,
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_tn_task   FOREIGN KEY (task_id)   REFERENCES tasks(id) ON DELETE CASCADE,
  CONSTRAINT fk_tn_author FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_tn_task (task_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Kalendarz: dni wolne / urlop + godziny dostępności (per użytkownik, per dzień).
CREATE TABLE IF NOT EXISTS calendar (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  user_id     INT NOT NULL,
  day         DATE NOT NULL,
  is_off      TINYINT(1) NOT NULL DEFAULT 0,
  avail_hours DECIMAL(4,1) NULL,
  UNIQUE KEY uq_cal_user_day (user_id, day),
  CONSTRAINT fk_cal_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_cal_day (day)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
