-- Create the resources table to hold all study materials
CREATE TABLE resources (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    type TEXT NOT NULL,
    domain TEXT NOT NULL,
    "durationMinutes" INTEGER NOT NULL,
    "sequenceOrder" INTEGER,
    pages INTEGER,
    "startPage" INTEGER,
    "endPage" INTEGER,
    "questionCount" INTEGER,
    "bookSource" TEXT,
    "chapterNumber" INTEGER,
    "videoSource" TEXT,
    "pairedResourceIds" TEXT[],
    "isPrimaryMaterial" BOOLEAN NOT NULL DEFAULT true,
    "isSplittable" BOOLEAN DEFAULT true,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "isOptional" BOOLEAN DEFAULT false,
    "schedulingPriority" TEXT DEFAULT 'medium'
);

-- Create the runs table to track solver jobs
CREATE TABLE runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    status TEXT NOT NULL DEFAULT 'PENDING',
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    objective_values JSONB,
    error_text TEXT
);

-- Create the schedule_slots table to store the results from the solver
CREATE TABLE schedule_slots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id UUID NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    resource_id TEXT NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    start_minute INTEGER NOT NULL,
    end_minute INTEGER NOT NULL,
    title TEXT,
    domain TEXT,
    type TEXT
);

-- Create a table to store the single, canonical study plan
CREATE TABLE study_plans (
    id INTEGER PRIMARY KEY,
    plan_data JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Ensure only one row can exist for the study plan
ALTER TABLE study_plans ADD CONSTRAINT single_plan_id CHECK (id = 1);

-- Enable Row Level Security (best practice, even if policies are permissive initially)
ALTER TABLE resources ENABLE ROW LEVEL SECURITY;
ALTER TABLE runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE schedule_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE study_plans ENABLE ROW LEVEL SECURITY;

-- Create policies to allow read access for authenticated users (for frontend)
CREATE POLICY "Allow read access to all users" ON resources FOR SELECT USING (true);
CREATE POLICY "Allow read access to all users" ON runs FOR SELECT USING (true);
CREATE POLICY "Allow read access to all users" ON schedule_slots FOR SELECT USING (true);
CREATE POLICY "Allow read access to all users" ON study_plans FOR SELECT USING (true);

-- Allow server-side roles (like the one used by your Vercel functions) to do everything
CREATE POLICY "Allow full access for service roles" ON resources FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow full access for service roles" ON runs FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow full access for service roles" ON schedule_slots FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow full access for service roles" ON study_plans FOR ALL USING (true) WITH CHECK (true);
