// Calibration cases: small components spread deliberately from clearly good, through
// genuinely ambiguous, to clearly bad, so a human can label Jev's answers across the
// whole probability range. Borderline cases matter most — calibration learns almost
// nothing from components everyone agrees on.
//
// They are exported under neutral names, and their stories are titled "Case NN",
// because the story name is part of the state Jev reads. A name like "VagueError"
// would hand it the answer. The comments here describe intent for maintainers only;
// neither Jev nor the human labeler ever sees them.
//
// None of them import the shared Button, so the Button import-graph integration
// check in scripts/example.mjs keeps its exact expected count.

// Sign-in: error states what went wrong; reasonable next step is implied. Borderline.
export function Case01() {
  return (
    <form>
      <h1>Sign in</h1>
      <p role="alert">Incorrect email or password.</p>
      <label htmlFor="c1-email">Email</label>
      <input id="c1-email" type="email" />
      <label htmlFor="c1-pw">Password</label>
      <input id="c1-pw" type="password" />
      <button type="submit">Sign in</button>
      <a href="#reset">Forgot your password?</a>
    </form>
  );
}

// Sign-in: bare failure, generic button. Clearly bad.
export function Case02() {
  return (
    <form>
      <h2>Login</h2>
      <p role="alert">Login failed.</p>
      <label htmlFor="c2-user">Username</label>
      <input id="c2-user" type="text" />
      <label htmlFor="c2-pw">Password</label>
      <input id="c2-pw" type="password" />
      <button type="submit">Submit</button>
    </form>
  );
}

// Sign-up: error names the exact rule. Clearly good.
export function Case03() {
  return (
    <form>
      <h1>Create your account</h1>
      <label htmlFor="c3-email">Email</label>
      <input id="c3-email" type="email" />
      <label htmlFor="c3-pw">Password</label>
      <input id="c3-pw" type="password" aria-describedby="c3-err" />
      <p id="c3-err" role="alert">Password must be at least 12 characters and include a number.</p>
      <button type="submit">Create account</button>
    </form>
  );
}

// Sign-up: says the password fails but not which requirement. Borderline.
export function Case04() {
  return (
    <form>
      <h1>Create your account</h1>
      <label htmlFor="c4-email">Email</label>
      <input id="c4-email" type="email" />
      <label htmlFor="c4-pw">Password</label>
      <input id="c4-pw" type="password" />
      <p role="alert">Password does not meet requirements.</p>
      <button type="submit">Create account</button>
    </form>
  );
}

// Payment: decline with two concrete remedies. Clearly good.
export function Case05() {
  return (
    <section>
      <h2>Payment</h2>
      <p role="alert">Your card was declined. Try another card, or contact your bank.</p>
      <label htmlFor="c5-card">Card number</label>
      <input id="c5-card" type="text" />
      <button type="submit">Pay $42.00</button>
      <button type="button">Back to cart</button>
    </section>
  );
}

// Payment: technical code only, generic buttons. Clearly bad.
export function Case06() {
  return (
    <section>
      <h2>Payment</h2>
      <p role="alert">Payment error (code 402).</p>
      <label htmlFor="c6-card">Card number</label>
      <input id="c6-card" type="text" />
      <button type="submit">Continue</button>
      <button type="button">Cancel</button>
    </section>
  );
}

// Search: empty results with specific advice. Clearly good.
export function Case07() {
  return (
    <section>
      <h2>Search results</h2>
      <p>No results for "blue velvet sofa".</p>
      <p>Try fewer words, or check the spelling.</p>
      <a href="#browse">Browse all sofas</a>
    </section>
  );
}

// Search: bare "No results." Clearly a dead end.
export function Case08() {
  return (
    <section>
      <h2>Results</h2>
      <p>No results.</p>
    </section>
  );
}

// Files: empty folder, an Upload button nearby but the text doesn't connect to it.
// Borderline.
export function Case09() {
  return (
    <section>
      <h2>Project files</h2>
      <p>This folder is empty.</p>
      <button type="button">Upload</button>
    </section>
  );
}

// Notifications: empty, but nothing needs doing. Is "all caught up" a dead end?
// Genuinely ambiguous.
export function Case10() {
  return (
    <section>
      <h2>Notifications</h2>
      <p>You're all caught up.</p>
    </section>
  );
}

// Account deletion: explicit warning and stated confirmation step. Clearly guarded.
export function Case11() {
  return (
    <section>
      <h2>Delete account</h2>
      <p>This permanently deletes your account and all of your data.</p>
      <p>You will be asked to type your email address to confirm.</p>
      <button type="button">Delete my account…</button>
    </section>
  );
}

// List row with an unexplained "Remove". Unguarded, and remove what?
export function Case12() {
  return (
    <ul>
      <li>
        <span>Quarterly report.pdf</span>
        <button type="button">Remove</button>
      </li>
      <li>
        <span>Budget 2026.xlsx</span>
        <button type="button">Remove</button>
      </li>
    </ul>
  );
}

// Project deletion: warns it is irreversible but mentions no confirmation. Borderline.
export function Case13() {
  return (
    <section>
      <h2>Danger zone</h2>
      <p>Deleting a project cannot be undone.</p>
      <button type="button">Delete project</button>
    </section>
  );
}

// Subscription cancel: reversible-ish, well explained. Is it even destructive?
// Ambiguous on the gate and on "guarded".
export function Case14() {
  return (
    <section>
      <h2>Your plan</h2>
      <p>Pro plan, renews on June 30.</p>
      <p>If you cancel, you keep Pro features until June 30 and can resubscribe any time.</p>
      <button type="button">Cancel subscription</button>
    </section>
  );
}

// Settings: three near-identical save actions. Primary action unclear.
export function Case15() {
  return (
    <form>
      <h2>Display settings</h2>
      <label htmlFor="c15-theme">Theme</label>
      <select id="c15-theme"><option>Light</option><option>Dark</option></select>
      <button type="button">Save</button>
      <button type="button">Save and close</button>
      <button type="button">Apply</button>
    </form>
  );
}

// Settings: one clear primary action. Clearly good.
export function Case16() {
  return (
    <form>
      <h2>Display settings</h2>
      <label htmlFor="c16-theme">Theme</label>
      <select id="c16-theme"><option>Light</option><option>Dark</option></select>
      <button type="submit">Save display settings</button>
      <button type="button">Cancel</button>
    </form>
  );
}

// Wizard: "Next"/"Back" are conventional here. Generic or fine? Borderline labels.
export function Case17() {
  return (
    <form>
      <p>Step 2 of 4</p>
      <h2>Shipping address</h2>
      <label htmlFor="c17-street">Street address</label>
      <input id="c17-street" type="text" />
      <label htmlFor="c17-city">City</label>
      <input id="c17-city" type="text" />
      <button type="submit">Next</button>
      <button type="button">Back</button>
    </form>
  );
}

// Confirmation dialog with no subject: sure about what? Clearly bad.
export function Case18() {
  return (
    <div role="dialog" aria-labelledby="c18-t">
      <h2 id="c18-t">Are you sure?</h2>
      <button type="button">Yes</button>
      <button type="button">No</button>
    </div>
  );
}

// Confirmation dialog done well. Clearly good.
export function Case19() {
  return (
    <div role="dialog" aria-labelledby="c19-t">
      <h2 id="c19-t">Discard unsaved changes?</h2>
      <p>Your edits to "Q3 roadmap" will be lost.</p>
      <button type="button">Discard changes</button>
      <button type="button">Keep editing</button>
    </div>
  );
}

// Dashboard tile: "Usage" of what? A number with no unit context. Borderline purpose.
export function Case20() {
  return (
    <section>
      <h3>Usage</h3>
      <p>72%</p>
      <button type="button">Details</button>
    </section>
  );
}

// Opaque feature panel: placeholder names, generic button. Clearly bad purpose.
export function Case21() {
  return (
    <section>
      <h3>Beta</h3>
      <label><input type="checkbox" /> Option A</label>
      <label><input type="checkbox" /> Option B</label>
      <button type="button">OK</button>
    </section>
  );
}

// Invite: short "Send" label in obvious context. Borderline label quality.
export function Case22() {
  return (
    <form>
      <h2>Invite</h2>
      <label htmlFor="c22-email">Email address</label>
      <input id="c22-email" type="email" />
      <button type="submit">Send</button>
    </form>
  );
}

// Newsletter signup. Clearly good.
export function Case23() {
  return (
    <form>
      <h2>Get product updates by email</h2>
      <p>One email a month. Unsubscribe any time.</p>
      <label htmlFor="c23-email">Email address</label>
      <input id="c23-email" type="email" />
      <button type="submit">Subscribe to updates</button>
    </form>
  );
}

// Generic failure with a Retry. Retry IS an action — actionable or not? Borderline.
export function Case24() {
  return (
    <section>
      <h2>Something went wrong</h2>
      <p role="alert">We couldn't load your dashboard.</p>
      <button type="button">Retry</button>
    </section>
  );
}

// Field error "Required." next to an obvious field. Borderline actionable.
export function Case25() {
  return (
    <form>
      <h2>Contact details</h2>
      <label htmlFor="c25-name">Full name</label>
      <input id="c25-name" type="text" />
      <label htmlFor="c25-phone">Phone number</label>
      <input id="c25-phone" type="tel" aria-describedby="c25-err" />
      <p id="c25-err" role="alert">Required.</p>
      <button type="submit">Save contact details</button>
    </form>
  );
}

// Upload error that states the problem but not the limit. Borderline.
export function Case26() {
  return (
    <section>
      <h2>Upload a photo</h2>
      <p role="alert">File too large.</p>
      <button type="button">Choose file</button>
    </section>
  );
}

// Upload error with the limit spelled out. Clearly good.
export function Case27() {
  return (
    <section>
      <h2>Upload a photo</h2>
      <p role="alert">That file is 14 MB. Photos must be 10 MB or smaller.</p>
      <button type="button">Choose a smaller photo</button>
    </section>
  );
}

// Rate limit with a concrete wait time. Actionable, but nothing to click.
export function Case28() {
  return (
    <section>
      <h2>Sign in</h2>
      <p role="alert">Too many attempts. Try again in 15 minutes.</p>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Round three: empty states, destructive actions and competing actions, the
// questions with too few labels to earn blocking. In every case the condition is
// unmistakably PRESENT, so the gate question opens and the labeled question has
// something to judge; only the quality of the handling varies.
// ---------------------------------------------------------------------------

// Empty inbox that explains how content arrives, with nothing to click. Borderline.
export function Case29() {
  return (
    <section>
      <h2>Inbox</h2>
      <p>No messages yet.</p>
      <p>Messages from your team will appear here.</p>
    </section>
  );
}

// Empty orders with a clear next step. Good.
export function Case30() {
  return (
    <section>
      <h2>Your orders</h2>
      <p>You haven't placed any orders yet.</p>
      <button type="button">Start shopping</button>
    </section>
  );
}

// Empty chart widget. Dead end. Bad.
export function Case31() {
  return (
    <section>
      <h3>Weekly signups</h3>
      <p>No data.</p>
    </section>
  );
}

// Filters matched nothing, with the fix offered. Good.
export function Case32() {
  return (
    <section>
      <h2>Invoices</h2>
      <p>No invoices match these filters.</p>
      <button type="button">Clear filters</button>
    </section>
  );
}

// Empty team list. Bad.
export function Case33() {
  return (
    <section>
      <h2>Team</h2>
      <p>No members.</p>
    </section>
  );
}

// Empty saved list that teaches the gesture. Good, with nothing to click.
export function Case34() {
  return (
    <section>
      <h2>Saved articles</h2>
      <p>Nothing saved yet. Tap the bookmark icon on any article to save it for later.</p>
    </section>
  );
}

// Empty with a documentation link rather than an action. Borderline.
export function Case35() {
  return (
    <section>
      <h2>Reports</h2>
      <p>No reports available.</p>
      <a href="#docs">Learn about reports</a>
    </section>
  );
}

// Empty day where nothing needs doing. Is that a dead end? Ambiguous.
export function Case36() {
  return (
    <section>
      <h2>Today</h2>
      <p>No events scheduled.</p>
    </section>
  );
}

// First-run empty state. Good.
export function Case37() {
  return (
    <section>
      <h2>Projects</h2>
      <p>Create your first project to get started.</p>
      <button type="button">New project</button>
    </section>
  );
}

// Empty log whose only action probably won't help. Borderline.
export function Case38() {
  return (
    <section>
      <h2>Activity</h2>
      <p>No activity.</p>
      <button type="button">Refresh</button>
    </section>
  );
}

// A heading and nothing else. Bad.
export function Case39() {
  return (
    <section>
      <h2>Uploads</h2>
      <p>Empty</p>
    </section>
  );
}

// Empty state that explains the concept and offers the action. Good.
export function Case40() {
  return (
    <section>
      <h2>API keys</h2>
      <p>You don't have any API keys. API keys let other apps access your account.</p>
      <button type="button">Create API key</button>
    </section>
  );
}

// Workspace deletion: scope spelled out, typed confirmation. Guarded.
export function Case41() {
  return (
    <section>
      <h2>Delete workspace</h2>
      <p>This deletes every project and file in the workspace, for everyone in it.</p>
      <p>You will be asked to type the workspace name to confirm.</p>
      <button type="button">Delete workspace…</button>
    </section>
  );
}

// Bare destructive button. Unguarded.
export function Case42() {
  return (
    <section>
      <h2>Browsing history</h2>
      <button type="button">Clear history</button>
    </section>
  );
}

// Consequence stated, no confirmation mentioned. Borderline.
export function Case43() {
  return (
    <section>
      <h3>Priya Shah</h3>
      <p>Editor</p>
      <p>Removing a member takes away their access immediately.</p>
      <button type="button">Remove member</button>
    </section>
  );
}

// The confirmation step itself, well written. Guarded.
export function Case44() {
  return (
    <div role="dialog" aria-labelledby="c44-t">
      <h2 id="c44-t">Reset all settings?</h2>
      <p>All 14 settings go back to their defaults. This can't be undone.</p>
      <button type="button">Reset all settings</button>
      <button type="button">Keep my settings</button>
    </div>
  );
}

// Permanence stated, no confirmation. Borderline.
export function Case45() {
  return (
    <section>
      <h2>Trash</h2>
      <p>12 items</p>
      <p>Items you empty from the trash are deleted permanently.</p>
      <button type="button">Empty trash</button>
    </section>
  );
}

// Terse revoke on a production credential. Unguarded.
export function Case46() {
  return (
    <ul>
      <li>
        <span>prod-key-3</span>
        <span>Last used 2 minutes ago</span>
        <button type="button">Revoke</button>
      </li>
    </ul>
  );
}

// Cancelling an order, explained, partially reversible. Ambiguous.
export function Case47() {
  return (
    <section>
      <h2>Order #4471</h2>
      <p>You can cancel within 30 minutes of ordering. Refunds take 3 to 5 days.</p>
      <button type="button">Cancel order</button>
    </section>
  );
}

// Guarded by undo rather than confirmation. A real safety pattern, but is it
// "confirmed first"? Genuinely ambiguous.
export function Case48() {
  return (
    <section>
      <h3>Design review notes</h3>
      <p>After you delete a note, you have 10 seconds to undo.</p>
      <button type="button">Delete note</button>
    </section>
  );
}

// Reversible account deactivation. Is it destructive at all? Ambiguous.
export function Case49() {
  return (
    <section>
      <h2>Deactivate account</h2>
      <p>Your profile is hidden while deactivated. Sign in any time to reactivate.</p>
      <button type="button">Deactivate account</button>
    </section>
  );
}

// Discard confirmation, well written. Guarded.
export function Case50() {
  return (
    <div role="dialog" aria-labelledby="c50-t">
      <h2 id="c50-t">Discard this draft?</h2>
      <p>Your draft "Launch announcement" will be deleted.</p>
      <button type="button">Discard draft</button>
      <button type="button">Keep draft</button>
    </div>
  );
}

// Device wipe with no context at all. Unguarded.
export function Case51() {
  return (
    <section>
      <h3>Pixel 8</h3>
      <button type="button">Wipe device</button>
    </section>
  );
}

// Soft delete to a 30-day trash. Barely destructive; guarded by recoverability.
// Ambiguous.
export function Case52() {
  return (
    <section>
      <p>3 files selected</p>
      <p>Deleted files move to Trash and are kept for 30 days.</p>
      <button type="button">Delete 3 files</button>
    </section>
  );
}

// Four overlapping save actions. Competing.
export function Case53() {
  return (
    <div role="toolbar" aria-label="Document">
      <button type="button">Save</button>
      <button type="button">Save as</button>
      <button type="button">Save a copy</button>
      <button type="button">Export</button>
    </div>
  );
}

// Primary action plus a way back. Not competing.
export function Case54() {
  return (
    <section>
      <h2>Review your order</h2>
      <p>2 items, $58.00 including delivery.</p>
      <button type="button">Place order</button>
      <button type="button">Continue shopping</button>
    </section>
  );
}

// Three near-synonyms for the same act. Competing.
export function Case55() {
  return (
    <div role="dialog" aria-labelledby="c55-t">
      <h2 id="c55-t">Add people to "Q3 roadmap"</h2>
      <label htmlFor="c55-email">Email address</label>
      <input id="c55-email" type="email" />
      <button type="button">Share</button>
      <button type="button">Send</button>
      <button type="button">Invite</button>
    </div>
  );
}

// Three distinct actions with distinct purposes. Not competing.
export function Case56() {
  return (
    <form>
      <h2>Job application</h2>
      <label htmlFor="c56-name">Full name</label>
      <input id="c56-name" type="text" />
      <button type="submit">Submit application</button>
      <button type="button">Save draft</button>
      <button type="button">Cancel</button>
    </form>
  );
}
