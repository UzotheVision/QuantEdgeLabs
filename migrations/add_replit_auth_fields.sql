-- Add sessions table for Replit Auth (if not exists)
CREATE TABLE IF NOT EXISTS "sessions" (
  "sid" varchar PRIMARY KEY NOT NULL,
  "sess" jsonb NOT NULL,
  "expire" timestamp NOT NULL
);

-- Add index on expire column for session cleanup
CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "sessions" USING btree ("expire");

-- Add Replit Auth fields to users table (if not exists)
DO $$
BEGIN
  -- Add first_name column
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name='users' AND column_name='first_name') THEN
    ALTER TABLE users ADD COLUMN "first_name" varchar;
  END IF;
  
  -- Add last_name column
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name='users' AND column_name='last_name') THEN
    ALTER TABLE users ADD COLUMN "last_name" varchar;
  END IF;
  
  -- Add profile_image_url column
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name='users' AND column_name='profile_image_url') THEN
    ALTER TABLE users ADD COLUMN "profile_image_url" varchar;
  END IF;
END
$$;

-- Make email unique (if not already)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'users_email_unique'
  ) THEN
    -- First, remove any duplicate emails (keep the oldest one)
    DELETE FROM users a
    USING users b
    WHERE a.id > b.id
    AND a.email = b.email
    AND a.email IS NOT NULL;
    
    -- Then add unique constraint
    ALTER TABLE users ADD CONSTRAINT "users_email_unique" UNIQUE("email");
  END IF;
END
$$;
