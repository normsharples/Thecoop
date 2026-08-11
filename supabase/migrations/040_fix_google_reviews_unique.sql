-- 040: Fix google_reviews upsert failures
-- ────────────────────────────────────────
-- The unique index on google_review_id (added in 004) was PARTIAL:
--   create unique index ... on google_reviews(google_review_id) where google_review_id is not null;
-- PostgREST / supabase-js `upsert(row, { onConflict: "google_review_id" })` cannot infer a
-- conflict target from a PARTIAL unique index, so every review write failed with:
--   "there is no unique or exclusion constraint matching the ON CONFLICT specification"
--
-- Replace it with a FULL unique index. Postgres still treats NULLs as distinct, so any legacy
-- rows with a null google_review_id remain allowed; non-null uniqueness is unchanged (and was
-- already enforced by the partial index, so this conversion cannot hit a duplicate).

drop index if exists public.idx_google_reviews_google_id;

create unique index if not exists idx_google_reviews_google_id
  on public.google_reviews (google_review_id);
