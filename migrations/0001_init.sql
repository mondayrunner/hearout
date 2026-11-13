-- Hearout: projects, participants, conversations and summaries.
--
-- A project is one round of interviews with one brief. Every participant gets a personal code,
-- and therefore a conversation of their own.

CREATE TABLE projects (
  id           TEXT PRIMARY KEY,
  slug         TEXT UNIQUE NOT NULL,
  name         TEXT NOT NULL,
  organisation TEXT NOT NULL,
  -- What the interviewer needs to find out, written as an instruction in markdown.
  brief_md     TEXT NOT NULL,
  -- Optional fixed topics as a JSON list of {"key": "...", "label": "..."}. The summary may only
  -- use these keys, so answers on one topic can be grouped across participants.
  topics       TEXT,
  max_turns    INTEGER NOT NULL DEFAULT 12,
  created_at   INTEGER NOT NULL
);

CREATE TABLE participants (
  id                 TEXT PRIMARY KEY,
  project_id         TEXT NOT NULL REFERENCES projects(id),
  code               TEXT UNIQUE NOT NULL,
  name               TEXT,
  status             TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','active','done')),
  -- Why the conversation ended: the model wrapped up, or the turn limit was reached.
  end_reason         TEXT CHECK(end_reason IN ('model','max_turns')),
  -- The brief and the limit this conversation started under. Editing a project later does not
  -- change a conversation that is already running.
  brief_at_start     TEXT,
  max_turns_at_start INTEGER,
  summary_status     TEXT CHECK(summary_status IN ('pending','done','failed')),
  summary_error      TEXT,
  started_at         INTEGER,
  finished_at        INTEGER
);
CREATE INDEX idx_participants_project ON participants(project_id, status);

-- Question n and the answer to it share turn n, so "everyone's answer to question 3" is
-- WHERE role = 'participant' AND turn = 3.
CREATE TABLE messages (
  id             TEXT PRIMARY KEY,
  participant_id TEXT NOT NULL REFERENCES participants(id),
  turn           INTEGER NOT NULL,
  role           TEXT NOT NULL CHECK(role IN ('interviewer','participant')),
  text           TEXT NOT NULL,
  -- Participant rows: typed, or a clicked suggestion written by the model.
  source         TEXT CHECK(source IN ('typed','suggestion')),
  -- Interviewer rows: the suggestions offered with this question (JSON list), and what the
  -- request cost. cache_read_tokens above zero from turn two means prompt caching works.
  suggestions       TEXT,
  model             TEXT,
  input_tokens      INTEGER,
  cache_write_tokens INTEGER,
  cache_read_tokens INTEGER,
  output_tokens     INTEGER,
  created_at     INTEGER NOT NULL
);
-- Two simultaneous requests on the same code must not split the conversation. With this index
-- the second write fails as a whole.
CREATE UNIQUE INDEX unique_turn ON messages(participant_id, turn, role);

-- Versioned, so regenerating a summary never overwrites one. The JSON is the source, the
-- markdown is derived from it for reading.
CREATE TABLE summaries (
  id                 TEXT PRIMARY KEY,
  participant_id     TEXT NOT NULL REFERENCES participants(id),
  version            INTEGER NOT NULL,
  in_one_sentence    TEXT NOT NULL,
  watch_out          TEXT NOT NULL,
  json               TEXT NOT NULL,
  markdown           TEXT NOT NULL,
  model              TEXT NOT NULL,
  input_tokens       INTEGER,
  cache_write_tokens INTEGER,
  cache_read_tokens  INTEGER,
  output_tokens      INTEGER,
  created_at         INTEGER NOT NULL,
  UNIQUE(participant_id, version)
);

-- One row per topic, so "what did everyone say about integrations" is a plain WHERE.
CREATE TABLE summary_points (
  summary_id TEXT NOT NULL REFERENCES summaries(id),
  position   INTEGER NOT NULL,
  key        TEXT NOT NULL,
  topic      TEXT NOT NULL,
  answer     TEXT NOT NULL,
  discussed  INTEGER NOT NULL CHECK(discussed IN (0, 1)),
  PRIMARY KEY (summary_id, position)
);
CREATE INDEX idx_points_key ON summary_points(key, discussed);

CREATE VIEW latest_summary AS
  SELECT s.* FROM summaries s
   WHERE s.version = (SELECT MAX(version) FROM summaries WHERE participant_id = s.participant_id);
