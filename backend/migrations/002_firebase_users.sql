-- Firebase owns sign-in, so ledger users are keyed by their Firebase UID.
-- Firebase also owns passwords and email uniqueness; username is set later by a
-- profile feature.
ALTER TABLE users ADD COLUMN firebase_uid text NOT NULL UNIQUE;
ALTER TABLE users DROP COLUMN password_hash;
ALTER TABLE users ALTER COLUMN username DROP NOT NULL;
ALTER TABLE users ALTER COLUMN email DROP NOT NULL;
ALTER TABLE users DROP CONSTRAINT users_email_key;
