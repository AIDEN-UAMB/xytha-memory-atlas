CREATE TABLE IF NOT EXISTS personal_recommendation_snapshots(
 owner TEXT NOT NULL, profile_id TEXT NOT NULL, profile_revision INTEGER NOT NULL, session_id TEXT NOT NULL,
 hour_key TEXT NOT NULL, day_key TEXT NOT NULL, payload TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
 PRIMARY KEY(owner,profile_id,profile_revision,session_id,hour_key)
);
CREATE INDEX IF NOT EXISTS personal_recommendation_snapshot_scope ON personal_recommendation_snapshots(owner,profile_id,profile_revision,session_id,updated_at);
CREATE TABLE IF NOT EXISTS personal_recommendation_exposures(
 owner TEXT NOT NULL, profile_id TEXT NOT NULL, profile_revision INTEGER NOT NULL, session_id TEXT NOT NULL,
 id TEXT NOT NULL, prompt_key TEXT NOT NULL, palace TEXT NOT NULL, shown_at INTEGER NOT NULL, dismissed_at INTEGER,
 PRIMARY KEY(owner,profile_id,profile_revision,session_id,id)
);
CREATE INDEX IF NOT EXISTS personal_recommendation_exposure_scope ON personal_recommendation_exposures(owner,profile_id,profile_revision,session_id,shown_at);
