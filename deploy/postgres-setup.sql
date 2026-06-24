-- ============================================================
--  AthenaBot — central Postgres setup
--  ONE Postgres server, ONE database per app (kept isolated).
--  No schema merging: each app owns its own database + tables.
--  Run as the postgres superuser:  sudo -u postgres psql -f postgres-setup.sql
--  CHANGE every password below before running.
-- ============================================================

-- ---- RoleFit / SmartJobs ----
CREATE USER rolefit WITH PASSWORD 'CHANGE_ME_rolefit';
CREATE DATABASE rolefit OWNER rolefit;
GRANT ALL PRIVILEGES ON DATABASE rolefit TO rolefit;

-- ---- AthenaBot Healthcare Voice AI ----
CREATE USER voice WITH PASSWORD 'CHANGE_ME_voice';
CREATE DATABASE voice OWNER voice;
GRANT ALL PRIVILEGES ON DATABASE voice TO voice;

-- ---- Lite-PLM ----
CREATE USER plm WITH PASSWORD 'CHANGE_ME_plm';
CREATE DATABASE plm OWNER plm;
GRANT ALL PRIVILEGES ON DATABASE plm TO plm;

-- Each app connects with its own DATABASE_URL, e.g.:
--   postgresql://rolefit:CHANGE_ME_rolefit@localhost:5432/rolefit
-- Apps create their own tables on first boot (CREATE TABLE IF NOT EXISTS).
-- To add a new product later, copy one block above and change the three names.
