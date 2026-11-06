# How changes go live (plain version)

Everything in this file is written so you never have to open a terminal. Every step is a click on a web page.

## The short version

After the one-time setup below, **you do nothing to ship a change.**

1. You ask Claude for a change.
2. Claude puts it on GitHub as a "pull request" and switches on auto-merge.
3. GitHub runs the safety checks by itself (the check is called **gate**).
4. If the checks pass, the change merges by itself. If they fail, it does **not** merge and nothing goes live.
5. After it merges:
   - **The app** updates by itself, usually within a couple of minutes.
   - **Supabase edge functions** (the behind-the-scenes code) publish by themselves, usually within a minute.
   - **Database changes** apply by themselves once the optional step 4 below is done.

You can watch it happen on the **Actions** tab of the repo. Green check = good. Red x = something stopped, and the live app is untouched.

---

## One-time setup (about 15 minutes, once, ever)

Do these in order. Screens change a little over time, so the words in quotes matter more than where they sit.

### Step 1. Turn on auto-merge

1. Go to `github.com/nickspam16/spiro-os`.
2. Click **Settings** (top row of tabs, far right).
3. You land on **General**. Scroll down to the section called **Pull Requests**.
4. Tick **Allow auto-merge**.
5. While you are there, also tick **Automatically delete head branches** (keeps things tidy).

### Step 2. Make the safety check required

This is what makes "passes the checks" mean something. Without it, auto-merge would merge immediately, before the checks finish.

1. Same Settings page. In the left column click **Rules**, then **Rulesets**.
2. Click **New ruleset**, then **New branch ruleset**.
3. Name it `protect main`.
4. Set **Enforcement status** to **Active**.
5. Under **Target branches** click **Add target**, then **Include default branch**.
6. Under **Rules**, tick **Require status checks to pass**. A box opens. Click **Add checks**, type `gate`, and pick **gate** from the list. (If `gate` is not offered, open any pull request that has run the checks once and come back.)
7. Also tick **Require a pull request before merging**. Leave the approvals number at **0**.
8. Click **Create** at the bottom.

What this changes: nobody, including Claude, can put changes straight onto `main` any more. Everything goes through a pull request and the checks. That is the point.

### Step 3. Give GitHub permission to publish to Supabase (the one secret that matters)

You create a key on the Supabase website and paste it into the GitHub website. It goes straight into GitHub's locked storage. You never send it to Claude or anyone else, and nobody should ever ask you to.

1. Open `supabase.com/dashboard/account/tokens` (sign in if asked).
2. Click **Generate new token**.
3. Name it `github-deploy` and click **Generate token**.
4. Click the copy icon next to the long text starting `sbp_`. **This is the only time Supabase shows it.**
5. Go back to `github.com/nickspam16/spiro-os` > **Settings** > in the left column **Secrets and variables** > **Actions**.
6. Click **New repository secret**.
7. In **Name**, type exactly: `SUPABASE_ACCESS_TOKEN`
8. In **Secret**, paste what you copied.
9. Click **Add secret**.

### Step 4. (Optional, can wait) Let GitHub apply database changes too

Edge functions deploy with Step 3 alone. Database changes ("migrations") need one more secret per project. Until you do this, a pull request that contains a database change will show a **red x** after merging with a message saying the database secret is missing. That is on purpose, so a database change is never silently skipped.

Do this for the CRM project first. Repeat for the portal project if it ever gets database changes.

1. Open the project in Supabase (`supabase.com/dashboard`, click the project).
2. Click the **Connect** button at the top of the page.
3. Choose **Session pooler**. Copy the connection text (it starts with `postgresql://`). It contains `[YOUR-PASSWORD]`.
4. You need the database password to replace that bracketed part. Go to **Project Settings** > **Database** > **Reset database password**, make a new one, and copy it.
   - Heads up: resetting the password cuts off anything that was using the old one. Ask Claude to check what that might be before you do this step.
5. In a notes app, paste the connection text and replace `[YOUR-PASSWORD]` (including the square brackets) with the new password. This all stays on your screen.
6. In GitHub: **Settings** > **Secrets and variables** > **Actions** > **New repository secret**.
7. Name: `SUPABASE_CRM_DB_URL` (for the CRM project) or `SUPABASE_PORTAL_DB_URL` (for the portal project).
8. Paste the finished text as the secret and click **Add secret**.

### Step 5. Let GitHub open pull requests by itself

Only needed for the "copy from Supabase" button in Step 6.

1. Repo **Settings** > **Actions** > **General**.
2. Scroll to **Workflow permissions**.
3. Tick **Allow GitHub Actions to create and approve pull requests**.
4. Click **Save**.

### Step 6. Copy what is live in Supabase into the repo (one click per project)

Right now the Supabase functions only exist inside Supabase, not in the repo. Until they are copied in, there is nothing for the automatic publishing to publish. This button copies them over. It does not change Supabase.

1. In the repo, click the **Actions** tab.
2. In the left column click **Copy backend from Supabase into the repo**.
3. On the right click **Run workflow** (grey button). A small box opens.
4. Leave **crm** selected and click the green **Run workflow** button.
5. Wait about two minutes. Refresh. A green check means it worked.
6. Click the **Pull requests** tab. Open the new one called **Backend: copy crm from Supabase**.
7. Wait for the checks at the bottom to go green. Then click **Enable auto-merge** and confirm. It merges itself.
8. Repeat from step 3, choosing **portal**.

Notes:
- The copy tool scans for passwords and keys first. If it finds one it stops, creates no pull request, and the run shows red. Tell Claude. The fix is for Claude to rotate that credential and clean the file, not to override the scan.
- When the copy merges, the publisher re-publishes those same functions once. They are identical to what is live, so nothing should change.

That is the whole setup. After this, "nothing" is the correct answer to "what do I have to do to ship?"

---

## Day to day: what is automatic and what is not

| What | Happens by itself? |
|---|---|
| Safety checks on every pull request | Yes |
| Merging a pull request that passes | Yes, once auto-merge is switched on for that pull request (Claude does this when it opens one) |
| App update going live after merge | Yes |
| Edge functions publishing after merge | Yes (needs Step 3 and Step 6) |
| Database changes applying after merge | Yes (needs Step 4) |
| Netlify site for the buyer portal | Yes, it already publishes itself from its own repo. This setup does not touch it. |

If a pull request was opened by a robot (like the copy button in Step 6), nobody has switched on auto-merge for it. Open it and click **Enable auto-merge** yourself, or ask Claude to.

---

## Undoing something (also no terminal)

### Undo any change, app or backend (the normal way)

1. Go to the repo's **Pull requests** tab, click **Closed**, and open the pull request that caused the problem.
2. Near the bottom click **Revert**. GitHub creates a new pull request that does the opposite.
3. Click **Enable auto-merge** on it. It passes the checks, merges, and everything republishes as it was.

### Undo edge functions right now (the fast way)

Use this when something is broken and waiting a few minutes hurts.

1. **Actions** tab > left column **Undo last backend change**.
2. **Run workflow**. Pick the project (**crm** or **portal**). Leave the commit box **blank**. Click the green **Run workflow**.
3. About a minute later the functions are back to how they were before the last backend change.
4. Then do the normal Revert above, so the repo matches what is live. If you skip this, the bad change is still in the repo and will come back the next time anything in that project is deployed.

### Database changes cannot be undone with a button

A database change moves forward only. There is no safe automatic "un-apply". If one goes wrong, Claude writes a new change that fixes it, and that goes through the same automatic path. This is why the checks on database changes matter more than the rest.

---

## The secrets, all in one place

These live only in GitHub's locked storage (Settings > Secrets and variables > Actions). The names must match exactly.

| Secret name | What it is | Required for |
|---|---|---|
| `SUPABASE_ACCESS_TOKEN` | Lets GitHub publish functions to your Supabase projects | Publishing functions, the copy button |
| `SUPABASE_CRM_DB_URL` | Lets GitHub apply database changes to the CRM project | Database changes (Step 4) |
| `SUPABASE_PORTAL_DB_URL` | Same, for the portal project | Portal database changes (Step 4) |

You never need to give Claude, or anyone, a Supabase service-role key. No step here uses one. If anyone asks you for one, say no.

---

## If something looks wrong

- **A pull request is stuck on "Waiting for status to be reported"**: the checks did not start. Ask Claude to re-run them.
- **A red x on "Deploy backend" after a merge**: open it, read the one-line message at the top, and send that line to Claude. The app is unaffected. To go back right away, use "Undo edge functions right now" above.
- **Red x that says the database secret is missing**: you have not done Step 4 yet. The database change was not applied and no functions from that merge were published. Do Step 4, then on the **Actions** tab choose **Deploy backend** and click **Run workflow**.
- **Someone changed Supabase by hand**: the repo no longer matches. Run the Step 6 button again. It opens a pull request showing exactly what differs.
