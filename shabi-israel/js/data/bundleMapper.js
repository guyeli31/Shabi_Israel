/**
 * bundleMapper.js — snake_case DB row → domain object mapping for the
 * get_site_bundle() RPC response (see docs/data-architecture/01-architecture.md
 * §A5). This is the ONLY place this mapping should live (see
 * docs/data-architecture/02-query-standards.md rule 8) — reused by both
 * js/data/store.js (production) and scripts/verify-csv-parity.mjs
 * (verification), so both exercise the identical mapping logic.
 *
 * Mirrors js/data/supabaseLoader.js's mappers (same shapes) — that file
 * stays as the admin-only granular read path (see 02-query-standards.md
 * rule 9).
 */

export function mapLeagueRow(row) {
    return {
        LeagueTitle: row.title,
        LeagueType: row.league_type,
        Running: row.running,
        Hidden: row.hidden,
        GoldCount: row.gold_count,
        SilverCount: row.silver_count,
        BronzeCount: row.bronze_count,
        MatchLength: row.match_length,
        IssueDate: row.issue_date,
        // How long the league runs (sql/league_duration.sql). A DB that predates
        // those columns yields undefined, which durationMode() reads as 'month' —
        // the default every league ran on before the setting existed.
        DurationMode: row.duration_mode || undefined,
        DurationDays: row.duration_days ?? undefined,
        // Opt-OUT semantics: a DB that predates sql/league_in_leaderboard.sql
        // has no such column, and `undefined !== false` keeps those leagues in
        // their leaderboards rather than blanking every one of them.
        InLeaderboard: row.in_leaderboard !== false,
        EntryFee: row.entry_fee ?? 0,
        Prizes: row.prizes || { Gold: 0, Silver: 0, Bronze: 0 },
        CustomFlags: row.custom_flags || {},
        RetiredPlayers: row.retired_players || [],
        ExternalSourceSync: row.external_source_sync || undefined,
        LastUpdated: row.last_updated || undefined,
    };
}

export function mapMatchRow(row) {
    return {
        playerA: row.player_a,
        prA: row.pr_a,
        luckA: row.luck_a,
        scoreA: row.score_a,
        playerB: row.player_b,
        prB: row.pr_b,
        luckB: row.luck_b,
        scoreB: row.score_b,
    };
}

export function mapMatchRowAll(row) {
    return { ...mapMatchRow(row), round: row.round, played: row.played };
}

export function mapOverrideRow(row) {
    return {
        type: row.type,
        playerA: row.player_a,
        playerB: row.player_b,
        winner: row.winner || undefined,
        scoreA: row.score_a ?? undefined,
        scoreB: row.score_b ?? undefined,
        prA: row.pr_a ?? undefined,
        prB: row.pr_b ?? undefined,
        luckA: row.luck_a ?? undefined,
        luckB: row.luck_b ?? undefined,
        reason: row.reason || undefined,
    };
}

export function mapHistoryRow(row) {
    return {
        playerA: row.player_a,
        playerB: row.player_b,
        scoreA: row.score_a,
        scoreB: row.score_b,
        prA: row.pr_a,
        prB: row.pr_b,
        luckA: row.luck_a,
        luckB: row.luck_b,
        round: row.round,
        updatedAt: row.updated_at,
        source: row.source,
    };
}

export function mapPlayerMetaRow(row) {
    return {
        fullName: row.full_name || undefined,
        bmabTitle: row.bmab_title || undefined,
        championshipTitles: row.championship_titles || [],
        hidden: row.hidden === true,
        photoPath: row.photo_path || undefined,
        inactive: row.inactive === true,
        joined: row.joined || undefined,
    };
}

export function mapLandingSettingsRow(row) {
    return {
        title: row.title || 'Shabi Israel',
        subtitle: row.subtitle || '',
        logoPath: row.logo_path || 'assets/logo/logo.png',
        displayOrder: row.display_order || [],
    };
}
