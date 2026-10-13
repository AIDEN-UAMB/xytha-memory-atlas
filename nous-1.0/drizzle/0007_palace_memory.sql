CREATE TABLE IF NOT EXISTS chat_checkpoint_parts (
 owner TEXT NOT NULL, request_id TEXT NOT NULL, part INTEGER NOT NULL, payload TEXT NOT NULL,
 PRIMARY KEY(owner,request_id,part),
 FOREIGN KEY(owner,request_id) REFERENCES chat_checkpoints(owner,request_id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS palace_facts (
 owner TEXT NOT NULL, profile_id TEXT NOT NULL, chart_version TEXT NOT NULL,
 id TEXT NOT NULL, scope TEXT NOT NULL, palace TEXT NOT NULL, period_key TEXT NOT NULL, payload TEXT NOT NULL,
 PRIMARY KEY(owner,id)
);
CREATE INDEX IF NOT EXISTS palace_facts_profile ON palace_facts(owner,profile_id,chart_version);
CREATE TABLE IF NOT EXISTS palace_memories (
 owner TEXT NOT NULL, profile_id TEXT NOT NULL, chart_version TEXT NOT NULL, id TEXT NOT NULL,
 source_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
 palace TEXT NOT NULL, target_year INTEGER NOT NULL, target_date TEXT NOT NULL,
 kind TEXT NOT NULL, payload TEXT NOT NULL, created_at INTEGER NOT NULL,
 PRIMARY KEY(owner,id), UNIQUE(owner,source_id,palace,target_date)
);
CREATE INDEX IF NOT EXISTS palace_memory_lookup ON palace_memories(owner,profile_id,chart_version,target_year,palace);
CREATE TABLE IF NOT EXISTS conversation_summaries (
 owner TEXT NOT NULL, profile_id TEXT NOT NULL, chart_version TEXT NOT NULL,
 source_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
 payload TEXT NOT NULL, updated_at INTEGER NOT NULL,
 PRIMARY KEY(owner,profile_id,chart_version)
);
CREATE TABLE IF NOT EXISTS palace_memory_jobs (
 owner TEXT NOT NULL, profile_id TEXT NOT NULL, source_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
 status TEXT NOT NULL DEFAULT 'pending', lease_token TEXT, lease_until INTEGER NOT NULL DEFAULT 0,
 attempts INTEGER NOT NULL DEFAULT 0, error_code TEXT, created_at INTEGER NOT NULL,
 PRIMARY KEY(owner,source_id)
);
CREATE INDEX IF NOT EXISTS palace_jobs_pending ON palace_memory_jobs(owner,profile_id,status,created_at);
