-- ============================================================================
-- landing_settings.completed_custom_order — does A1 obey the admin's drag?
-- ============================================================================
-- A1 (Completed Leagues) sorts by the league's opening date, newest first, with
-- the canonical league-type order (Doubling → UBC → Regular) breaking a tie on
-- the date. That is the DEFAULT, and it is what a site with no opinion gets.
--
-- But landing edit mode lets an admin DRAG completed rows, and that drag writes
-- display_order. Until now A1 re-sorted by date on every render, so the dragged
-- arrangement was saved to the database and then silently thrown away on the
-- next load — the one thing a reorder UI must never do.
--
-- This flag is the answer to "who wins": false → the date sort (the default),
-- true → display_order exactly as stored. A drag on a completed row sets it;
-- the "Sort by date" button in edit mode clears it again.
--
-- It defaults to FALSE deliberately, INCLUDING for this site, whose existing
-- display_order was hand-arranged over time and therefore already differs from
-- date order. Detecting "is it custom?" by comparing the two would have put
-- every existing site permanently in custom mode and made the date sort
-- unreachable — which is why this is an explicit flag and not an inference.
--
-- Additive and idempotent — safe to re-run. Apply to BOTH the cloud project
-- and the local Docker instance.
-- ============================================================================

alter table public.landing_settings
    add column if not exists completed_custom_order boolean not null default false;

comment on column public.landing_settings.completed_custom_order is
    'A1 (Completed Leagues) row order: false = sort by league opening date '
    '(newest first, ties broken by league type Doubling → UBC → Regular); '
    'true = use display_order as stored, i.e. the admin arranged the rows by hand.';
