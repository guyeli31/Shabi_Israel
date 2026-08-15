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
 *   3. its subject matches SUBJECT_RE exactly — the match-report format,
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

/**
 * The match-report subject format:
 *
 *   Admin: A league match was played between NAME (S L PR LUCK) and NAME (S L PR LUCK) on SERVER in ID!
 *
 * The four numbers per player are score, match length, PR, luck — in that
 * order. Leading Fwd:/Re: are tolerated so a forwarded report still parses.
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
    '\\s+on\\s+(\\S+)\\s+in\\s+(\\d+)\\s*!?\\s*$'
);

// ── Entry point (the trigger calls this) ───────────────────────────────────
function checkMail() {
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(5000)) return;          // a previous run is still going
    try {
        var cfg = getConfig_();
        var done    = getOrCreateLabel_(LABEL_DONE);
        var ignored = getOrCreateLabel_(LABEL_IGNORED);

        // Threads carrying the inbound label but neither outcome label.
        var threads = GmailApp.search(inboxQuery_(), 0, BATCH_LIMIT);

        for (var t = 0; t < threads.length; t++) {
            var msgs = threads[t].getMessages();
            var anySent = false, anyIgnored = false;

            for (var i = 0; i < msgs.length; i++) {
                var outcome = handleMessage_(msgs[i], cfg);
                if (outcome === 'sent') anySent = true;
                else anyIgnored = true;
            }

            threads[t].addLabel(anySent ? done : ignored);
        }
    } finally {
        lock.releaseLock();
    }
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
function handleMessage_(msg, cfg) {
    if (!senderOk_(msg, cfg.sender)) return 'ignored';

    var data = parseSubject_(msg.getSubject());
    if (!data) return 'ignored';

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
    var needle = String(sender).toLowerCase();
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
        server:       m[11],
        external_id:  m[12]
    };

    // Every numeric slot must actually be a number, and the pairing must be
    // two different people. A half-parsed report is worse than a dropped one.
    var nums = ['score_a','pr_a','luck_a','score_b','pr_b','luck_b','match_length'];
    for (var i = 0; i < nums.length; i++) if (p[nums[i]] === null) return null;
    if (p.player_a === p.player_b) return null;

    return p;
}

function num_(s) {
    var v = parseFloat(s);
    return isNaN(v) ? null : v;
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
    var cfg = {
        url:    (p.getProperty('SUPABASE_URL')  || '').replace(/\/+$/, ''),
        anon:    p.getProperty('SUPABASE_ANON'),
        token:   p.getProperty('REPORT_TOKEN'),
        sender:  p.getProperty('SOURCE_SENDER')
    };
    var missing = [];
    for (var k in cfg) if (!cfg[k]) missing.push(k);
    if (missing.length) throw new Error('Missing Script Properties: ' + missing.join(', '));
    return cfg;
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
