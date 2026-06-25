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
  type            ENUM('once','dc','cyc') NOT NULL DEFAULT 'once',
  priority        VARCHAR(4) NOT NULL DEFAULT '1',         -- '1'..'4' albo 'dc'
  note            TEXT,
  status          ENUM('oczekiwanie','w_realizacji','ukonczone','nie_potrzeby')
                  NOT NULL DEFAULT 'oczekiwanie',
  created_by      INT NULL,
  completed_by    INT NULL,
  completed_date  DATE NULL,
  created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_created_by  FOREIGN KEY (created_by)   REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_completed_by FOREIGN KEY (completed_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_status (status),
  INDEX idx_created_by (created_by)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
