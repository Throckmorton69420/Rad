-- Drop the old, incorrectly structured table if it exists.
DROP TABLE IF EXISTS public.study_plans;

-- Drop the new table if it exists, to make this script re-runnable.
DROP TABLE IF EXISTS public.study_resources;

-- Create the new 'study_resources' table with a schema that matches your types.ts file.
CREATE TABLE public.study_resources (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    type TEXT NOT NULL,
    domain TEXT NOT NULL,
    "durationMinutes" INT NOT NULL,
    "isPrimaryMaterial" BOOLEAN NOT NULL,
    "isSplittable" BOOLEAN NOT NULL,
    "isArchived" BOOLEAN NOT NULL,
    "isOptional" BOOLEAN,
    "schedulingPriority" TEXT,
    pages INT,
    "startPage" INT,
    "endPage" INT,
    "questionCount" INT,
    "caseCount" INT,
    "bookSource" TEXT,
    "videoSource" TEXT,
    "chapterNumber" INT,
    "sequenceOrder" INT,
    "pairedResourceIds" TEXT[],
    dependencies TEXT[],
    "priorityTier" INT
);

-- Enable Row Level Security (RLS) on the new table. This is a crucial Supabase security best practice.
ALTER TABLE public.study_resources ENABLE ROW LEVEL SECURITY;

-- Create policies to allow authenticated users to read and write their own data.
-- This basic policy allows any logged-in user to do anything. 
-- For a multi-user app, you would add "USING (auth.uid() = user_id)" to restrict access.
CREATE POLICY "Allow authenticated full access"
ON public.study_resources
FOR ALL
TO authenticated
USING (true)
WITH CHECK (true);
