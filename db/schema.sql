-- Tuition database schema (PostgreSQL). Amounts are stored as integer minor units (kuruş/cents)
-- to avoid floating point errors. Applied idempotently by the API at startup.

CREATE TABLE IF NOT EXISTS students (
  student_no  VARCHAR(16) PRIMARY KEY,
  full_name   VARCHAR(120) NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id             SERIAL PRIMARY KEY,
  username       VARCHAR(64) UNIQUE NOT NULL,
  password_hash  VARCHAR(100) NOT NULL,
  role           VARCHAR(16) NOT NULL CHECK (role IN ('student','bank','admin')),
  student_no     VARCHAR(16) REFERENCES students(student_no),
  CHECK ((role = 'student') = (student_no IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS tuition (
  student_no   VARCHAR(16) NOT NULL REFERENCES students(student_no),
  term         VARCHAR(16) NOT NULL,
  total_minor  BIGINT NOT NULL CHECK (total_minor >= 0),
  currency     CHAR(3) NOT NULL,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (student_no, term)
);

CREATE TABLE IF NOT EXISTS payments (
  id              SERIAL PRIMARY KEY,
  transaction_id  VARCHAR(64) UNIQUE NOT NULL,
  student_no      VARCHAR(16) NOT NULL,
  term            VARCHAR(16) NOT NULL,
  amount_minor    BIGINT NOT NULL CHECK (amount_minor > 0),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (student_no, term) REFERENCES tuition(student_no, term)
);
CREATE INDEX IF NOT EXISTS idx_payments_student_term ON payments(student_no, term);

-- Per-student, per-day counter backing the "3 mobile queries per student per day" rule.
CREATE TABLE IF NOT EXISTS mobile_query_counter (
  student_no  VARCHAR(16) NOT NULL REFERENCES students(student_no),
  day         DATE NOT NULL,
  count       INT NOT NULL,
  PRIMARY KEY (student_no, day)
);
