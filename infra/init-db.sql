-- LAUP database initialization
-- Runs once on first container start

-- Enable pgvector extension for memory layer embeddings (DOC-204, ADR-003)
CREATE EXTENSION IF NOT EXISTS vector;

-- Enable uuid-ossp for UUID generation
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create laup schema to namespace all platform tables
CREATE SCHEMA IF NOT EXISTS laup;

-- Verify setup
DO $$
BEGIN
  RAISE NOTICE 'LAUP database initialized: pgvector %, schema laup created',
    (SELECT extversion FROM pg_extension WHERE extname = 'vector');
END $$;
