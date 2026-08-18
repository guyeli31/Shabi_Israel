/**
 * Code.gs — Google Apps Script that forwards External Source match reports
 *           from a mailbox to the league database.
 *
 * Runs inside the RECIPIENT's Google account (Extensions ▸ Apps Script, or
 * script.google.com). Nothing is installed on any machine; Google runs it.
 *
 * ── What leaves the mailbox ────────────────────────────────────────────────
 * Only the parsed match fields below. The sender address, every header, the
 * message body and the subject line itself are read in memory and dropped.
 * They are never transmitted, so there is nothing to delete on the other side.
 *
 * ── What is sent, and only what is sent ────────────────────────────────────
 * A message is transmitted ONLY when all four hold:
 *   1. it carries the configured Gmail label,
 *   2. it comes from the configured source address (also detected through a
 *      forward header),
 *   3. its subject OPENS with the match-report sentence and carries both
 *      players' figures — see SUBJECT_RE. Text after that sentence is ignored,
 *   4. every captured field parses as a number where a number is expected.
 * Anything else is labelled 'ignored' and never touches the network. This is
 * the "only match-report e-mails reach the DB" requirement, enforced by
 * whitelist: unknown formats are rejected, not guessed at.
 *
 * ── Setup ──────────────────────────────────────────────────────────────────
 * 1. Gmail ▸ Settings ▸ Filters: create a filter for mail from the source
 *    address, action "Apply label: match-reports". Do NOT add "Skip Inbox"
 *    unless you want to; the script does not care.
 * 2. Project Settings ▸ Script Properties — add:
 *        SUPABASE_URL     https://<project>.supabase.co
 *        SUPABASE_ANON    <the public anon key — the same one in the site's JS>
 *        REPORT_TOKEN     <the secret from sql/mail_sync.sql step 1>
 *        SOURCE_SENDER    <the address the reports come from>
 *    Script Properties are not part of the source and are not shared.
 * 3. Run `testParseOnly` once — it parses without sending, and prints what it
 *    would have transmitted. Read that output before going live.
 * 4. Triggers ▸ Add Trigger → checkMail → Time-driven → Minutes → Every minute.
 */

// ── Configuration ──────────────────────────────────────────────────────────
var LABEL_IN      = 'match-reports';   // set by the Gmail filter
var LABEL_DONE    = 'match-reports/sent';
var LABEL_IGNORED = 'match-reports/ignored';
var BATCH_LIMIT   = 25;                // threads per run
var SWEEP_LIMIT   = 100;               // ignored threads un-labelled per run

/**
 * ⚠ BUMP THIS whenever the sender check or the subject parser changes.
 *
 * 'ignored' is a permanent verdict — the search skips those threads forever —
 * and that verdict was reached by whatever code was running at the time. A
 * parser fix therefore leaves behind a pile of good matches marked bad, and
 * nothing in the mailbox knows the ruling is out of date.
 *
 * The first run after this number changes strips the 'ignored' label from
 * every thread carrying it, putting them all back in the queue to be judged by
 * the new code. Mail that genuinely is not a match report simply gets ignored
 * again, at the cost of one extra pass.
 *
 * Forgetting to bump it is not catastrophic — retryAllIgnored() does the same
 * thing by hand — but it is the difference between the fix applying itself and
 * someone having to remember.
 *
 * 3 — sender/token values trimmed; subject tail made optional; the trailing
 *     number sent as source_ref instead of external_id.
 * 4 — invisible bidi/zero-width characters stripped from the settings too, not
 *     just whitespace. A RIGHT-TO-LEFT MARK on the end of SOURCE_SENDER had
 *     been rejecting every report in a live mailbox; trim() does not touch it.
 * 5 — any score above the match length is capped to the match length. Covers
 *     the resign marker 1004 and the unexplained 13 with one rule. Reports
 *     already stored carry the raw figure, so this bump matters: it re-judges
 *     them rather than leaving them wrong for ever.
 */
var PARSER_VERSION = 5;

/**
 * The match-report subject format:
 *
 *   Admin: A league match was played between NAME (S L PR LUCK) and NAME (S L PR LUCK) on SERVER in ID!
 *   └──────────── the gate ────────────────┘└─────────── the data ───────────────────┘└─ optional ─┘
 *
 * The four numbers per player are score, match length, PR, luck — in that
 * order. Leading Fwd:/Re: are tolerated so a forwarded report still parses.
 *
 * The three parts do different jobs, and only the first two are required:
 *
 *   THE GATE is anchored to the start of the subject and is the whole of the
 *   "only match reports reach the database" rule. Without it, any subject
 *   carrying a word and four numbers in brackets would read as a report.
 *
 *   THE DATA is every field the league actually needs.
 *
 *   THE TAIL is captured when present and ignored when not. There is no `$`
 *   anchor, so trailing text cannot reject a report whose sentence has already
 *   been recognised in full — which is not hypothetical: a subject copied out
 *   of the Gmail UI arrives with the word "Inbox" stuck to the end, and under
 *   the old end-anchored pattern that silently discarded a perfectly good
 *   match. The gate has already done the filtering by that point; re-checking
 *   the tail bought no safety and cost real reports.
 *
 * ⚠ THE TRAILING NUMBER IS NOT A MATCH ID. It was originally read as one and
 * sent as `external_id`, which is the key submit_match_report uses to spot a
 * report it has already seen. Two real reports then arrived from the live
 * mailbox — different players, different scores, different days — both ending
 * "on Heroes in 325". The number identifies the COMPETITION, not the game.
 * Under the old name the first match would have been stored and every match
 * after it silently swallowed as a duplicate of it: no error, no rejection,
 * just a league that stopped updating. It is therefore sent as `source_ref`,
 * a field nothing keys on, and the duplicate check falls back to hashing the
 * whole payload — players, scores, figures and the message timestamp — which
 * is genuinely unique per match.
 *
 * ⚠ VERIFY BEFORE GOING LIVE: the score/length reading is inferred from a
 * single 7-point sample where both players showed "7" in slot 2. Run
 * testParseOnly against a report from a league of a DIFFERENT length; if slot 2
 * is not that league's length, this mapping is wrong and everything downstream
 * inherits the error.
 */
var SUBJECT_RE = new RegExp(
    '^(?:\\s*(?:Fwd|FW|Re):\\s*)*' +
    'Admin:\\s*A league match was played between\\s+' +
    '(\\S+?)\\s*\\(\\s*(-?[\\d.]+)\\s+(-?[\\d.]+)\\s+(-?[\\d.]+)\\s+(-?[\\d.]+)\\s*\\)' +
    '\\s+and\\s+' +
    '(\\S+?)\\s*\\(\\s*(-?[\\d.]+)\\s+(-?[\\d.]+)\\s+(-?[\\d.]+)\\s+(-?[\\d.]+)\\s*\\)' +
    '(?:\\s+on\\s+(\\S+))?' +
    '(?:\\s+in\\s+(\\d+))?'
);

// ── Entry point (the trigger calls this) ───────────────────────────────────
function checkMail() {
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(5000)) return;          // a previous run is still going
    try {
        var cfg = getConfig_();
        var done    = getOrCreateLabel_(LABEL_DONE);
        var ignored = getOrCreateLabel_(LABEL_IGNORED);

        // Before judging anything new, re-open old verdicts if the code that
        // reached them has since changed. Runs inside the lock and before the
        // search, so anything it releases is picked up in this same run.
        sweepIfUpgraded_();

        // Threads carrying the inbound label but neither outcome label.
        var threads = GmailApp.search(inboxQuery_(), 0, BATCH_LIMIT);
        var sent = 0, skipped = 0;

        for (var t = 0; t < threads.length; t++) {
            var msgs = threads[t].getMessages();
            var anySent = false;

            for (var i = 0; i < msgs.length; i++) {
                if (handleMessage_(msgs[i], cfg) === 'sent') { anySent = true; sent++; }
                else skipped++;
            }

            threads[t].addLabel(anySent ? done : ignored);
        }

        // ALWAYS report, including — especially — the empty run.
        //
        // This used to return in silence when the search found nothing, which
        // looks identical to a crash, a missing trigger, a broken label and a
        // script that was never saved. That ambiguity cost more diagnostic time
        // than every real fault in this file put together. One line, every run.
        if (!threads.length) {
            console.log('checkMail: nothing to do — no thread carries "' + LABEL_IN +
                        '" without an outcome label already. Query: ' + inboxQuery_());
        } else {
            console.log('checkMail: ' + threads.length + ' thread(s) — ' +
                        sent + ' message(s) sent, ' + skipped + ' ignored.');
        }
    } finally {
        lock.releaseLock();
    }
}


// ── Re-open old verdicts after an upgrade ─────────────────────────────────
//
// Called at the top of every run; does nothing at all unless PARSER_VERSION
// has moved since the last sweep.
//
// The version is recorded ONLY once the backlog has been fully drained. A
// half-finished sweep that recorded the new version would strand whatever it
// had not reached yet under a label nothing will ever look at again — the very
// failure this exists to undo. Recording late costs one redundant search on
// the next run; recording early loses matches.
function sweepIfUpgraded_() {
    var props = PropertiesService.getScriptProperties();
    var seen  = parseInt(props.getProperty('PARSER_VERSION_SEEN'), 10);

    // No version recorded means version UNKNOWN, which has to be read as "older
    // than this one" — never as "nothing to do".
    //
    // This branch originally adopted the current version without sweeping, on
    // the reasoning that a brand-new project has no backlog to re-judge. That
    // is exactly backwards for the case that matters: pasting a fixed script
    // into a mailbox gives you new CODE over an old BACKLOG, and the property
    // is missing precisely then. The result was a first run that silently
    // declared itself up to date and left every previously rejected match
    // buried — no sweep, no logging, nothing.
    //
    // Sweeping here is safe on a genuinely fresh mailbox too: it touches only
    // threads carrying LABEL_IGNORED, a label nothing but this script creates,
    // so when there is no backlog there is also nothing to find.
    if (isNaN(seen)) seen = 0;
    if (seen >= PARSER_VERSION) return;

    var label   = GmailApp.getUserLabelByName(LABEL_IGNORED);
    if (!label) {
        props.setProperty('PARSER_VERSION_SEEN', String(PARSER_VERSION));
        return;
    }

    var threads = GmailApp.search('label:"' + LABEL_IGNORED + '"', 0, SWEEP_LIMIT);
    threads.forEach(function (th) { th.removeLabel(label); });

    console.log('parser v' + seen + ' → v' + PARSER_VERSION + ': released ' +
                threads.length + ' previously ignored thread(s) for re-judging');

    // A full page means there is probably more behind it. Leave the version
    // unrecorded so the next run continues where this one stopped.
    if (threads.length < SWEEP_LIMIT) {
        props.setProperty('PARSER_VERSION_SEEN', String(PARSER_VERSION));
        console.log('backlog drained; now at parser v' + PARSER_VERSION);
    }
}

/**
 * Put every ignored message back in the queue, right now.
 *
 * The automatic sweep above reacts to a change in THIS FILE. It is blind to a
 * change in the Script Properties — a corrected REPORT_TOKEN or SOURCE_SENDER
 * fixes just as many rejections and leaves no trace the code can detect. Run
 * this by hand after fixing a setting.
 *
 * Removes labels only. Sends nothing; the next checkMail does the work.
 */
function retryAllIgnored() {
    return releaseLabel_(LABEL_IGNORED);
}

/**
 * Re-send EVERY report, including the ones that already went through.
 *
 * The automatic sweep and retryAllIgnored both leave 'sent' threads alone, on
 * the principle that a report which reached the database is finished. That
 * principle fails when the parser was WRONG rather than broken: the 1004
 * reports were transmitted successfully and labelled sent, carrying a score of
 * 1004 that the database faithfully stored. Nothing in the mailbox will ever
 * look at them again.
 *
 * Re-sending them is safe because the database keys duplicates on the content
 * of the report: a message that still parses identically hashes identically and
 * is swallowed as a duplicate, while one the fix has changed arrives as a new
 * report and is resolved properly. So the correct ones cost a wasted request
 * and the wrong ones get a second chance.
 *
 * Not automatic, and deliberately so: it re-sends the entire history, which is
 * the right move after a parser correction and pointless noise otherwise.
 */
function retryEverything() {
    return releaseLabel_(LABEL_IGNORED) + '\n' + releaseLabel_(LABEL_DONE);
}

function releaseLabel_(name) {
    var label = GmailApp.getUserLabelByName(name);
    if (!label) return 'Nothing to release — no "' + name + '" label exists.';

    var total = 0, page;
    do {
        page = GmailApp.search('label:"' + name + '"', 0, SWEEP_LIMIT);
        page.forEach(function (th) { th.removeLabel(label); });
        total += page.length;
    } while (page.length === SWEEP_LIMIT);

    var line = 'Released ' + total + ' thread(s) from "' + name +
               '". They will be re-judged on the next checkMail run.';
    console.log(line);
    return line;
}

/**
 * The Gmail search that finds untouched reports.
 *
 * Label names are QUOTED. Unquoted, Gmail reads the hyphen in `match-reports`
 * as its own NOT operator — `label:match` AND NOT `reports` — which quietly
 * matches nothing and looks exactly like "no mail has arrived yet". Quoting
 * also lets the nested `match-reports/sent` be written as it actually reads,
 * instead of relying on Gmail's slash-to-hyphen rewriting.
 */
function inboxQuery_() {
    return 'label:"' + LABEL_IN + '"' +
           ' -label:"' + LABEL_DONE + '"' +
           ' -label:"' + LABEL_IGNORED + '"';
}

// ── One message ────────────────────────────────────────────────────────────
//
// Every rejection is LOGGED with its reason. The two gates below fail in ways
// that look identical from the outside — the thread just lands under
// 'ignored' — and the only place the difference exists is here. Without these
// lines the sole diagnostic left is "it did not work", which is what actually
// happened the first time this ran against a real mailbox.
function handleMessage_(msg, cfg) {
    if (!senderOk_(msg, cfg.sender)) {
        console.warn('IGNORED (sender): expected to find "' + cfg.sender +
                     '" — From was: ' + msg.getFrom());
        return 'ignored';
    }

    var data = parseSubject_(msg.getSubject());
    if (!data) {
        console.warn('IGNORED (subject did not match the report format): ' +
                     msg.getSubject());
        return 'ignored';
    }

    data.played_at = msg.getDate().toISOString();
    return post_(data, cfg) ? 'sent' : 'ignored';
}

/**
 * Sender check. Direct delivery is the From header. A forwarded report has the
 * forwarder's address in From, so the original sender is looked for in the
 * forward block at the top of the body — bounded to the first 800 characters
 * so a quoted address deep in a thread cannot spoof it.
 */
function senderOk_(msg, sender) {
    var needle = clean_(sender).toLowerCase();
    if (String(msg.getFrom()).toLowerCase().indexOf(needle) !== -1) return true;
    var head = String(msg.getPlainBody()).slice(0, 800).toLowerCase();
    return head.indexOf(needle) !== -1;
}

/**
 * Subject → payload, or null if this is not a match report.
 * Null is the normal outcome for every other mail the source ever sends.
 */
function parseSubject_(subject) {
    var m = SUBJECT_RE.exec(String(subject || '').replace(/\s+/g, ' ').trim());
    if (!m) return null;

    var lenA = num_(m[3]), lenB = num_(m[8]);
    if (lenA === null || lenB === null || lenA !== lenB) return null;   // disagreeing lengths = not a report we understand

    var p = {
        player_a:     m[1],
        score_a:      num_(m[2]),
        pr_a:         num_(m[4]),
        luck_a:       num_(m[5]),
        player_b:     m[6],
        score_b:      num_(m[7]),
        pr_b:         num_(m[9]),
        luck_b:       num_(m[10]),
        match_length: lenA,
        // Optional groups: undefined when the tail is absent. Normalised to
        // null so the payload's shape never changes — an undefined value would
        // vanish from JSON.stringify and give the same match two different
        // payloads depending on the subject it arrived in.
        server:       m[11] || null,
        // NOT external_id — see the note on SUBJECT_RE. This number repeats
        // across unrelated matches, so it identifies the competition, not the
        // game. submit_match_report keys its duplicate check on 'external_id'
        // when that field is present, so emitting it under that name would
        // have made every match after the first one a "duplicate" of it.
        source_ref:   m[12] || null
    };

    // Every numeric slot must actually be a number, and the pairing must be
    // two different people. A half-parsed report is worse than a dropped one.
    var nums = ['score_a','pr_a','luck_a','score_b','pr_b','luck_b','match_length'];
    for (var i = 0; i < nums.length; i++) if (p[nums[i]] === null) return null;
    if (p.player_a === p.player_b) return null;

    return capScores_(p);
}

function num_(s) {
    var v = parseFloat(s);
    return isNaN(v) ? null : v;
}

/**
 * Cap each score at the match length.
 *
 * A match ends the instant somebody reaches the match length, so no score above
 * it can be a score. This is not a rule inferred from one example: across all
 * 3,825 played matches in this league's database the winner's figure equals the
 * match length EVERY time — 3,476 sevens in 7-point leagues, 349 fives in
 * 5-point leagues, with no overshoot and no unfinished match. A number above
 * the length is therefore always the source saying something other than a
 * score, and the score it stands in for is always the same one.
 *
 * Two such values have turned up so far. 1004 is the source's marker for the
 * opponent RESIGNING: "OvedBenZeev (0 7 ...) and YKwin (1004 7 ...)" is the
 * match this was confirmed against, and the league already held it as YKwin
 * 7 - 0. A 13 in a 7-point match also appeared, meaning still unknown. Capping
 * resolves both without having to know what either one means, and resolves
 * whatever the source invents next.
 *
 * The original is kept as `raw_score_a` / `raw_score_b` whenever a cap bites,
 * so a corrected figure never silently masquerades as one the source sent — and
 * so the sentinels stay countable if their meaning is ever worth chasing.
 *
 * Capping cannot manufacture a valid-looking result out of nonsense: two capped
 * scores both land ON the length, which public.mail_score_ok rejects because it
 * requires exactly one winner. Those still stop for an admin.
 */
function capScores_(p) {
    var L = p.match_length;
    if (L == null) return p;

    if (p.score_a > L) { p.raw_score_a = p.score_a; p.score_a = L; }
    if (p.score_b > L) { p.raw_score_b = p.score_b; p.score_b = L; }

    return p;
}

// ── Transmit ───────────────────────────────────────────────────────────────
function post_(payload, cfg) {
    var res = UrlFetchApp.fetch(cfg.url + '/rest/v1/rpc/submit_match_report', {
        method: 'post',
        contentType: 'application/json',
        headers: { apikey: cfg.anon, Authorization: 'Bearer ' + cfg.anon },
        payload: JSON.stringify({ p_token: cfg.token, p_payload: payload }),
        muteHttpExceptions: true
    });

    var code = res.getResponseCode();
    if (code < 200 || code >= 300) {
        // Leave the thread unlabelled so the next run retries it.
        throw new Error('submit failed: HTTP ' + code + ' ' + res.getContentText().slice(0, 200));
    }

    var body = {};
    try { body = JSON.parse(res.getContentText()); } catch (e) {}

    // A rejection is either OUR fault or the message's, and the two must not be
    // treated alike.
    //
    //   unauthorized  → the token is wrong, revoked, or not yet pasted in. That
    //                   is a configuration problem someone is about to fix, and
    //                   the match is perfectly good. Throw, so the thread stays
    //                   unlabelled and the next run picks it up again. Rotating
    //                   a token would otherwise silently bin every match played
    //                   between the old one being revoked and the new one being
    //                   pasted — the reports would be marked "ignored" and never
    //                   looked at again.
    //
    //   anything else → the message itself is not a usable match report. No
    //                   number of retries changes that, so drop it.
    if (body && body.ok === false && body.error === 'unauthorized') {
        throw new Error('submit refused: token not accepted (check REPORT_TOKEN). Will retry next run.');
    }
    if (body && body.ok === false) {
        console.warn('rejected by DB: ' + JSON.stringify(body));
        return false;
    }
    console.log('sent ' + payload.player_a + ' vs ' + payload.player_b +
                ' → ' + JSON.stringify(body));
    return true;
}

// ── Config ─────────────────────────────────────────────────────────────────
function getConfig_() {
    var p = PropertiesService.getScriptProperties();
    // Every value goes through clean_(). All four are pasted by hand into a web
    // form, and what rides along is invisible in the settings pane, in the logs
    // and in any message quoting them back. On the token it surfaces as a flat
    // 'unauthorized'; on the sender it silently discards every report.
    var cfg = {
        url:    clean_(p.getProperty('SUPABASE_URL')).replace(/\/+$/, ''),
        anon:   clean_(p.getProperty('SUPABASE_ANON')),
        token:  clean_(p.getProperty('REPORT_TOKEN')),
        sender: clean_(p.getProperty('SOURCE_SENDER'))
    };

    // Report the SCRIPT PROPERTY name, not the internal field name. The two are
    // different vocabularies and only one of them exists on the settings screen
    // the reader is about to go and look at: "Missing Script Properties: sender"
    // sends them hunting for a field called "sender", which is not there.
    var PROP_OF = {
        url:    'SUPABASE_URL',
        anon:   'SUPABASE_ANON',
        token:  'REPORT_TOKEN',
        sender: 'SOURCE_SENDER'
    };
    var missing = [];
    for (var k in cfg) if (!cfg[k]) missing.push(PROP_OF[k]);
    if (missing.length) {
        throw new Error('Missing Script Properties: ' + missing.join(', ') +
            '. Set them under Project Settings > Script Properties. ' +
            '(A value made only of spaces or invisible characters counts as missing.)');
    }
    return cfg;
}

/**
 * Strip the characters a pasted value carries without showing them.
 *
 * trim() is not enough, and the gap is not academic. A live mailbox had
 * SOURCE_SENDER set to the correct address of 31 characters, stored as 32 —
 * the address followed by a RIGHT-TO-LEFT MARK, picked up when it was copied
 * in a right-to-left context. (Not reproduced literally here: pasting the
 * character into this comment to illustrate it would make the comment carry
 * the same invisible passenger it is warning about.)
 *
 * U+200F is a FORMAT character, not whitespace, so
 * trim() leaves it exactly where it is; the value renders identically
 * everywhere, has no visible difference from the correct one, and yet a From
 * header containing the address verbatim reported "not found". Every match
 * report that mailbox received was discarded for two days.
 *
 * Removed here: zero-width spaces and joiners (200B–200D), the directional
 * marks and embeddings (200E–200F, 202A–202E), the isolates (2066–2069) and a
 * stray byte-order mark (FEFF). None of them can legitimately appear inside a
 * URL, a key, a token or an e-mail address.
 */
// Ranges tested by CODE POINT rather than matched by a character class. A
// class spelled with these characters looks like an empty pair of brackets on
// screen — unreadable, unreviewable, and one "tidy-up" away from deletion.
var INVISIBLE_RANGES = [
    [0x200B, 0x200F],   // zero-width space/joiners, LEFT-TO-RIGHT & RIGHT-TO-LEFT MARK
    [0x202A, 0x202E],   // bidi embeddings and overrides
    [0x2066, 0x2069],   // bidi isolates
    [0xFEFF, 0xFEFF]    // byte-order mark
];

function clean_(s) {
    var src = String(s == null ? '' : s), out = '';
    outer: for (var i = 0; i < src.length; i++) {
        var c = src.charCodeAt(i);
        for (var r = 0; r < INVISIBLE_RANGES.length; r++) {
            if (c >= INVISIBLE_RANGES[r][0] && c <= INVISIBLE_RANGES[r][1]) continue outer;
        }
        out += src.charAt(i);
    }
    return out.trim();
}

function getOrCreateLabel_(name) {
    return GmailApp.getUserLabelByName(name) || GmailApp.createLabel(name);
}

// ── Dry run — parses, prints, sends nothing ──────────────────────────────
//
// Output goes to BOTH console.log and Logger.log on purpose: the two land in
// different panes of the Apps Script editor depending on version, and a dry run
// that appears to print nothing is indistinguishable from one that found
// nothing. Every branch prints, including the empty ones.
function testParseOnly() {
    var out = [];
    var say = function (line) { out.push(line); console.log(line); Logger.log(line); };

    say('── Dry run ─────────────────────────────');

    // 1. Are the four Script Properties set? testParseOnly never sends, so it
    //    does not strictly need them — but the run after this one does, and
    //    finding out now is cheaper than finding out at 2am.
    var p = PropertiesService.getScriptProperties();
    ['SUPABASE_URL', 'SUPABASE_ANON', 'REPORT_TOKEN', 'SOURCE_SENDER'].forEach(function (k) {
        var v = p.getProperty(k);
        say('  ' + k + ': ' + (v ? 'set (' + String(v).length + ' chars)' : '*** MISSING ***'));
    });

    // 2. Does the inbound label exist at all? A filter that was never saved is
    //    the single most common reason nothing is found.
    var label = GmailApp.getUserLabelByName(LABEL_IN);
    say('  Label "' + LABEL_IN + '": ' + (label ? 'exists' : '*** NOT FOUND — create the Gmail filter first ***'));

    // 3. What does the real query match?
    var q = inboxQuery_();
    say('  Query: ' + q);
    var threads = GmailApp.search(q, 0, 10);
    say('  Threads matched: ' + threads.length);

    if (!threads.length && label) {
        // Distinguish "no NEW mail" from "no mail at all" — they need different fixes.
        var all = GmailApp.search('label:"' + LABEL_IN + '"', 0, 10);
        say('  (Messages under the label ignoring the already-handled ones: ' + all.length + ')');
        threads = all;
    }

    // 4. Per message: would it be sent, and as what?
    threads.forEach(function (th) {
        th.getMessages().forEach(function (msg) {
            var parsed = parseSubject_(msg.getSubject());
            say((parsed ? '  WOULD SEND  ' : '  IGNORED     ') + msg.getSubject());
            if (parsed) say('              ' + JSON.stringify(parsed));
        });
    });

    say('── End of dry run ──────────────────────');

    // Returned as well, so the value shows in the editor even if neither log
    // pane is being watched.
    return out.join('\n');
}

// ── Why was the last one rejected? ────────────────────────────────────────
//
// Takes the MOST RECENT message filed under 'ignored' and walks it through
// every gate the live path applies, printing the verdict of each one.
//
// Deliberately one message, not all of them. The diagnostic loop here is "send
// a test mail, run this, read the answer, fix, repeat" — and in that loop only
// the newest attempt is the one being asked about. Reporting the whole backlog
// buried it under earlier failures that had already been fixed, which is
// exactly the noise that makes a log go unread.
//
// It answers one question outright: WOULD THIS MESSAGE GO THROUGH NEXT TIME?
// All three gates are exercised, the third by asking the database directly
// (see tokenProbe_) rather than inferring an answer from the label.
//
// No match is submitted, no row is written, no counter moves and no label is
// changed. The one network call it makes carries a deliberately empty report,
// which the database refuses by design. Safe to run repeatedly.
function whyIgnored() {
    var out = [];
    var say = function (line) { out.push(line); console.log(line); Logger.log(line); };

    say('══ whyIgnored — the most recent rejected report ══');
    say('');

    // ── Configuration ─────────────────────────────────────────────────────
    // Printed first because a missing property explains everything below it,
    // and because the secrets are shown only as lengths — enough to catch a
    // truncated paste or a stray space, never enough to leak the value.
    var p = PropertiesService.getScriptProperties();
    var sender = p.getProperty('SOURCE_SENDER');
    say('CONFIGURATION');
    say('  SUPABASE_URL  : ' + (p.getProperty('SUPABASE_URL') || '*** MISSING ***'));
    ['SUPABASE_ANON', 'REPORT_TOKEN'].forEach(function (k) {
        var v = p.getProperty(k);
        say('  ' + pad_(k, 14) + ': ' + (v ? 'set (' + v.length + ' chars)' : '*** MISSING ***'));
    });
    // QUOTED, with its length. Printed bare, a value carrying a trailing space
    // or newline is indistinguishable from a clean one — which is how a From
    // header containing the address verbatim came back "not found" with nothing
    // in the log to explain it.
    if (sender === null) {
        say('  SOURCE_SENDER : *** MISSING ***');
    } else {
        var cleaned = clean_(sender);
        say('  SOURCE_SENDER : ' + JSON.stringify(sender) + '  (' + sender.length + ' chars)');
        if (cleaned !== sender) {
            // Say it outright. The whole reason this cost days is that the two
            // values print identically, so "looks right" was never evidence.
            say('     ⚠ CONTAINS INVISIBLE CHARACTERS — stripped before use.');
            say('       as stored : ' + codes_(sender));
            say('       as used   : ' + codes_(cleaned) + '  (' + cleaned.length + ' chars)');
        }
    }
    say('');

    // ── Locate the newest ignored message ─────────────────────────────────
    if (!GmailApp.getUserLabelByName(LABEL_IGNORED)) {
        say('Label "' + LABEL_IGNORED + '" does not exist yet.');
        say('Nothing has ever been rejected — checkMail has not run, or found no mail.');
        return finish_(say, out);
    }

    var msgs = [];
    GmailApp.search('label:"' + LABEL_IGNORED + '"', 0, 20).forEach(function (th) {
        msgs = msgs.concat(th.getMessages());
    });
    if (!msgs.length) {
        say('The "' + LABEL_IGNORED + '" label exists but holds no messages.');
        return finish_(say, out);
    }

    // Gmail orders threads newest-first, but a thread's own messages run
    // oldest-first — so the last rejection is not simply the first hit.
    //
    // The backlog SIZE is deliberately not printed. This report answers one
    // question, about one message; how many older failures are sitting behind
    // it is a separate, operational matter and reporting it here only competes
    // with the answer.
    msgs.sort(function (a, b) { return b.getDate() - a.getDate(); });
    var msg = msgs[0];

    say('THE MESSAGE');
    say('  Received : ' + msg.getDate());
    say('  From     : ' + msg.getFrom());
    say('  To       : ' + msg.getTo());
    say('  Subject  : ' + msg.getSubject());
    say('');

    // ── Gate 1: sender ────────────────────────────────────────────────────
    say('GATE 1 — SENDER');
    if (!sender) {
        say('  SOURCE_SENDER is not set, so this gate rejects everything.');
        say('  → FAILED. Set it to the address the reports arrive from.');
        return finish_(say, out);
    }
    var needle = clean_(sender).toLowerCase();
    var from   = String(msg.getFrom());
    var inFrom = from.toLowerCase().indexOf(needle) !== -1;
    var head   = String(msg.getPlainBody()).slice(0, 800);
    var inBody = head.toLowerCase().indexOf(needle) !== -1;
    say('  Looking for : ' + JSON.stringify(needle));
    say('  From header : ' + JSON.stringify(from));
    say('    in the From header       : ' + (inFrom ? 'FOUND' : 'not found'));
    say('    in the first 800 chars   : ' + (inBody ? 'FOUND' : 'not found'));
    if (!inFrom && !inBody) {
        say('  → FAILED — and the subject was never even read.');
        say('    Either SOURCE_SENDER names the wrong address, or this mail came');
        say('    from somewhere else.');
        // Whitespace is trimmed before comparing, so anything that gets here is
        // a genuine difference in the characters themselves — most often a
        // look-alike glyph, which no amount of staring at the two strings will
        // reveal. Print the codes.
        say('    Both strings, character by character:');
        say('      wanted: ' + codes_(needle));
        say('      got   : ' + codes_(from.toLowerCase()));
        say('    Body begins: ' + JSON.stringify(head.slice(0, 120)));
        return finish_(say, out);
    }
    say('  → PASSED');
    say('');

    // ── Gate 2: subject ───────────────────────────────────────────────────
    say('GATE 2 — SUBJECT');
    var verdict = explainSubject_(msg.getSubject());
    verdict.lines.forEach(function (l) { say('  ' + l); });
    if (!verdict.ok) {
        say('  → FAILED. Nothing was sent.');
        return finish_(say, out);
    }
    say('  → PASSED');
    say('');

    // ── Gate 3: by elimination, the database ──────────────────────────────
    // Gate 3 cannot be settled by inspection. The 'ignored' label was written
    // in the PAST, possibly by an older version of this script, while the gates
    // above just ran the CURRENT one — so after any fix, every previously
    // rejected message reaches here and "the database refused it" would be a
    // guess dressed as a finding. Ask the database instead.
    say('GATE 3 — THE DATABASE');
    var probe = tokenProbe_();
    probe.lines.forEach(function (l) { say('  ' + l); });
    say('');

    var payload = verdict.payload;
    payload.played_at = msg.getDate().toISOString();
    say('  This is exactly what would be sent:');
    say('    ' + JSON.stringify(payload));
    say('');

    // ── The answer the reader actually came for ───────────────────────────
    say('VERDICT');
    if (probe.ok) {
        say('  This message WILL BE ACCEPTED on the next run.');
        say('  All three gates pass. It is sitting under "' + LABEL_IGNORED + '"');
        say('  only because an earlier version of this script put it there.');
        say('');
        // Whether anything needs doing depends on whether the automatic sweep
        // is still owed. Telling the reader to act when the script is about to
        // act for them teaches them to distrust the instruction.
        var seen = parseInt(
            PropertiesService.getScriptProperties().getProperty('PARSER_VERSION_SEEN'), 10);
        if (isNaN(seen) || seen < PARSER_VERSION) {
            say('  NOTHING TO DO — the parser has been upgraded since this label');
            say('  was written (v' + (isNaN(seen) ? '?' : seen) + ' → v' + PARSER_VERSION + '), so the next checkMail run will');
            say('  release every ignored thread automatically and re-judge them.');
        } else {
            say('  The automatic re-sweep for v' + PARSER_VERSION + ' has already run, so this');
            say('  message was judged by the current code and still ended up here');
            say('  — most likely a setting was corrected afterwards, which the');
            say('  script cannot detect.');
            say('  → Run retryAllIgnored(), then checkMail.');
        }
    } else {
        say('  This message will still be REFUSED on the next run.');
        say('  The mailbox is fine — both gates pass — but the database will not');
        say('  accept the token.');
        say('  → Fix REPORT_TOKEN, then run retryAllIgnored() and checkMail.');
        say('    Retrying before the token is fixed only sends it round the same');
        say('    loop and puts the label straight back.');
    }
    say('');
    say('  Nothing was stored and no label was changed by this run.');

    return finish_(say, out);
}

function finish_(say, out) {
    say('');
    say('══ End ══════════════════════════════════════════');
    return out.join('\n');
}

/**
 * Ask the database whether REPORT_TOKEN is accepted — WITHOUT storing anything.
 *
 * submit_match_report checks the token BEFORE it validates the report, and its
 * shape gate returns before both the insert and the use_count bump. So an
 * empty payload separates the two answers cleanly:
 *
 *     unauthorized    → the token is wrong, revoked, or mistyped
 *     invalid_payload → the token is GOOD; the empty report was refused, which
 *                       is exactly what was asked for
 *
 * Nothing is written, no counter moves, and no real match is submitted. This is
 * the only network call whyIgnored makes.
 */
function tokenProbe_() {
    var lines = [];
    var cfg;
    try {
        cfg = getConfig_();
    } catch (e) {
        lines.push('SKIPPED — ' + e.message);
        lines.push('Configuration must be complete before the token can be tested.');
        return { ok: false, lines: lines };
    }

    lines.push('Testing REPORT_TOKEN against ' + cfg.url);
    lines.push('(an intentionally empty report — it cannot be stored)');

    var res;
    try {
        res = UrlFetchApp.fetch(cfg.url + '/rest/v1/rpc/submit_match_report', {
            method: 'post',
            contentType: 'application/json',
            headers: { apikey: cfg.anon, Authorization: 'Bearer ' + cfg.anon },
            payload: JSON.stringify({ p_token: cfg.token, p_payload: {} }),
            muteHttpExceptions: true
        });
    } catch (e) {
        lines.push('  NETWORK ERROR: ' + e.message);
        lines.push('  The database could not be reached at all. Check SUPABASE_URL.');
        return { ok: false, lines: lines };
    }

    var code = res.getResponseCode(), text = res.getContentText();
    lines.push('  HTTP ' + code + ' → ' + text.slice(0, 200));

    if (code === 401 || code === 403) {
        lines.push('  FAILED — SUPABASE_ANON was not accepted (this is the public');
        lines.push('  key from the site, not the report token).');
        return { ok: false, lines: lines };
    }
    if (code < 200 || code >= 300) {
        lines.push('  FAILED — the database answered with an error.');
        return { ok: false, lines: lines };
    }

    var body = {};
    try { body = JSON.parse(text); } catch (e) {}

    if (body.error === 'unauthorized') {
        lines.push('  FAILED — REPORT_TOKEN is not accepted. It is wrong, revoked,');
        lines.push('  or was pasted with a character missing.');
        return { ok: false, lines: lines };
    }
    if (body.error === 'invalid_payload') {
        lines.push('  PASSED — the token was accepted, and the empty report was');
        lines.push('  refused on its own merits, as intended. Nothing was stored.');
        return { ok: true, lines: lines };
    }

    // Neither answer: the contract changed and this probe no longer proves what
    // it claims. Say so rather than reading a pass into an unfamiliar reply.
    lines.push('  UNEXPECTED reply — cannot judge the token from it.');
    return { ok: false, lines: lines };
}

/**
 * Render a string so invisible and look-alike characters become visible.
 * Plain ASCII passes through; anything else is shown as its code point.
 */
function codes_(s) {
    var outp = [];
    for (var i = 0; i < String(s).length; i++) {
        var c = String(s).charCodeAt(i);
        outp.push(c > 32 && c < 127 ? String(s).charAt(i) : '[' + c + ']');
    }
    return outp.join('');
}

function pad_(s, n) {
    s = String(s);
    while (s.length < n) s += ' ';
    return s;
}

/**
 * The subject gate, narrated.
 *
 * parseSubject_ answers yes or no, which is useless when the answer is no —
 * five separate conditions collapse into the same null. This walks the same
 * conditions in the same order and reports each one, so a rejection names
 * itself instead of having to be guessed at.
 *
 * Returns { ok, lines, payload }. Kept in step with parseSubject_ by hand;
 * a condition added there must be added here too.
 */
function explainSubject_(subject) {
    var raw   = String(subject || '');
    var s     = raw.replace(/\s+/g, ' ').trim();
    var lines = [];

    lines.push('Raw        : ' + JSON.stringify(raw));
    if (s !== raw) lines.push('Normalised : ' + JSON.stringify(s) + '   (whitespace collapsed)');
    else           lines.push('Normalised : identical — no stray whitespace');

    var m = SUBJECT_RE.exec(s);
    if (!m) {
        lines.push('');
        lines.push('The report sentence was NOT recognised. Clause by clause:');
        subjectProbes_(s).forEach(function (l) { lines.push(l); });
        return { ok: false, lines: lines, payload: null };
    }

    lines.push('');
    lines.push('The report sentence was recognised. Captured fields:');
    lines.push('  player A     : ' + m[1]);
    lines.push('    score      : ' + m[2]);
    lines.push('    length     : ' + m[3]);
    lines.push('    PR         : ' + m[4]);
    lines.push('    luck       : ' + m[5]);
    lines.push('  player B     : ' + m[6]);
    lines.push('    score      : ' + m[7]);
    lines.push('    length     : ' + m[8]);
    lines.push('    PR         : ' + m[9]);
    lines.push('    luck       : ' + m[10]);
    lines.push('  server       : ' + (m[11] || '(absent — optional)'));
    lines.push('  source_ref   : ' + (m[12] || '(absent — optional)') +
               '   — the competition number, NOT a match id');

    // The checks parseSubject_ applies AFTER the pattern matches. Each one can
    // reject a subject that looks perfectly well-formed above.
    lines.push('');
    lines.push('Post-checks:');

    var lenA = num_(m[3]), lenB = num_(m[8]);
    if (lenA === null || lenB === null) {
        lines.push('  FAILED  match length is not a number');
        return { ok: false, lines: lines, payload: null };
    }
    if (lenA !== lenB) {
        lines.push('  FAILED  the two players report different match lengths (' +
                   lenA + ' vs ' + lenB + ').');
        lines.push('          Both figures come from the same match, so a disagreement');
        lines.push('          means the subject is not the format we parse.');
        return { ok: false, lines: lines, payload: null };
    }
    lines.push('  ok      both players agree the match was to ' + lenA);

    var payload = {
        player_a: m[1], score_a: num_(m[2]), pr_a: num_(m[4]), luck_a: num_(m[5]),
        player_b: m[6], score_b: num_(m[7]), pr_b: num_(m[9]), luck_b: num_(m[10]),
        match_length: lenA, server: m[11] || null, source_ref: m[12] || null
    };

    var nums = ['score_a', 'pr_a', 'luck_a', 'score_b', 'pr_b', 'luck_b'];
    var bad  = nums.filter(function (k) { return payload[k] === null; });
    if (bad.length) {
        lines.push('  FAILED  these fields did not read as numbers: ' + bad.join(', '));
        return { ok: false, lines: lines, payload: null };
    }
    lines.push('  ok      all six figures read as numbers');

    if (payload.player_a === payload.player_b) {
        lines.push('  FAILED  both players are "' + payload.player_a + '" — nobody plays themselves');
        return { ok: false, lines: lines, payload: null };
    }
    lines.push('  ok      two distinct players');

    return { ok: true, lines: lines, payload: payload };
}

/**
 * Localise a subject-format failure to a single clause.
 *
 * SUBJECT_RE is one long alternation-free pattern, so it answers only yes/no —
 * useless when the answer is no. These probes walk the same sentence piece by
 * piece and name the first piece that is not there.
 */
function subjectProbes_(subject) {
    var s = String(subject || '').replace(/\s+/g, ' ').trim();

    // Only the REQUIRED clauses are probed. The server name and the match id
    // are optional and can never be the reason a report was rejected, so
    // listing them here would send the reader hunting for a fault that is not
    // there.
    var probes = [
        ['opening "Admin: A league match was played between"',
         /Admin:\s*A league match was played between\s/i.test(s)],
        ['a "(number number number number)" group for player A',
         /\(\s*-?[\d.]+\s+-?[\d.]+\s+-?[\d.]+\s+-?[\d.]+\s*\)/.test(s)],
        ['the word "and" separating the two players',
         /\)\s+and\s+/i.test(s)],
        ['a "(number number number number)" group for player B',
         /\)\s+and\s+\S+?\s*\(\s*-?[\d.]+\s+-?[\d.]+\s+-?[\d.]+\s+-?[\d.]+\s*\)/i.test(s)]
    ];

    var lines = probes.map(function (p) {
        return (p[1] ? '   ok  ' : '  MISSING  ') + p[0];
    });

    lines.push('  (the "on SERVER in ID" tail is optional and is never a reason to reject)');

    // Look-alike characters survive a copy-paste and defeat the pattern while
    // reading perfectly on screen. A non-breaking space is NOT among them — the
    // whitespace normalisation above already folds it away — so only genuine
    // impostors reach here: a curly quote for a straight one, an en dash for a
    // hyphen, a Hebrew or Cyrillic letter shaped like a Latin one.
    var odd = [];
    for (var i = 0; i < s.length; i++) {
        var c = s.charCodeAt(i);
        if (c > 126 && odd.indexOf(c) === -1) odd.push(c);
    }
    if (odd.length) {
        lines.push('  NOTE: look-alike non-ASCII characters present (codes ' + odd.join(', ') + '),');
        lines.push('        e.g. a curly quote or an en dash. Retype the subject by hand.');
    }

    // Both players must report the SAME match length — slot 2 of each group.
    var groups = s.match(/\(\s*-?[\d.]+\s+(-?[\d.]+)\s+-?[\d.]+\s+-?[\d.]+\s*\)/g);
    if (groups && groups.length === 2) {
        var len = groups.map(function (g) { return g.match(/-?[\d.]+/g)[1]; });
        if (len[0] !== len[1]) {
            lines.push('  MISMATCH: the two players report different match lengths (' +
                       len[0] + ' vs ' + len[1] + '). A report is only accepted when they agree.');
        }
    }
    return lines;
}
