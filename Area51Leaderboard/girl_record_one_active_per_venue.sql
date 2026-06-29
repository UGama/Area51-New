-- Keep only the most recently updated active girl record per venue.
-- Older active duplicates are archived before the unique index is created.
WITH ranked_active_girl AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY venue
      ORDER BY updated_at DESC NULLS LAST,
               created_at DESC NULLS LAST,
               id DESC
    ) AS row_num
  FROM public.leaderboard
  WHERE board = 'girl'
    AND status = 1
)
UPDATE public.leaderboard AS leaderboard
SET status = 2
FROM ranked_active_girl
WHERE leaderboard.id = ranked_active_girl.id
  AND ranked_active_girl.row_num > 1;

-- Database-level guarantee: one active girl record per venue.
CREATE UNIQUE INDEX IF NOT EXISTS uq_leaderboard_one_active_girl_per_venue
ON public.leaderboard (venue)
WHERE board = 'girl'
  AND status = 1;
