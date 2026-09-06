-- ============================================================================
-- landing_settings.active_custom_order — does H1 obey the admin's card drag?
-- ============================================================================
-- The sibling of completed_custom_order (sql/landing_completed_custom_order.sql),
-- for the OTHER half of the landing page. H1 (Active Leagues) groups its cards
-- by league type — Doubling → UBC → Regular — and that grouping is the DEFAULT.
--
-- The grouping sort is stable, so a drag WITHIN one type group already survives:
-- display_order still decides the order inside a group. A drag ACROSS groups did
-- not. It was written to display_order, published, and then discarded by the
-- regrouping on the next render — the same silent loss A1 suffered, and the
-- reason a Regular league could not be moved ahead of a Doubling one however
-- many times you dragged it.
--
-- false (default) → group by type; true → display_order verbatim.
--
-- The flag is set only when a drag actually BREAKS the grouping, and clears
-- itself again if a later drag restores it, so it means exactly what its name
-- says. Like its sibling it is explicit rather than inferred: this site's
-- display_order is hand-arranged and is NOT type-grouped, so inferring the mode
-- from the data would have read as "custom" on day one and made the grouping
-- unreachable.
--
-- Additive and idempotent — safe to re-run. Apply to BOTH the cloud project
-- and the local Docker instance.
-- ============================================================================

alter table public.landing_settings
    add column if not exists active_custom_order boolean not null default false;

comment on column public.landing_settings.active_custom_order is
    'H1 (Active Leagues) card order: false = group by league type '
    '(Doubling → UBC → Regular, display_order deciding within each group); '
    'true = use display_order as stored, i.e. the admin arranged the cards by hand.';
