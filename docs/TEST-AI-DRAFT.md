# How to test the AI-drafted explanation

This guide walks you through running Halqa with a real Anthropic API key and checking that the **AI-drafted patient explanation** works before the hackathon demo.

It has never been tested against the real API, only with a stand-in response. One person needs to do this once, on their own computer or on Vercel.

**Time needed:** about 10 minutes the first time.

---

## Before you start

You need:

1. **An Anthropic API key.** Create one at <https://console.anthropic.com> → *API Keys* → *Create Key*. It starts with `sk-ant-`.
   - Never paste the key into chat, a GitHub issue, a commit, or a file in this repo.
   - Set a monthly spend limit on the key in the console, because the drafting route has no login.
2. **One of these two routes:**
   - **Option A (your own computer):** Node.js 18 or newer and Git installed.
   - **Option B (Vercel, no terminal):** a Vercel account linked to GitHub. This also gives us the live URL we need for submission.

Pick one option below. You don't need both.

---

## Option A: on your own computer

### 1. Check Node.js and Git are installed

Open a terminal (see step 2 for how) and run:

```bash
node --version
```

```bash
git --version
```

If `node` prints `v18` or higher, you're fine. If either command is "not found", install Node.js from <https://nodejs.org> (the LTS version) and Git from <https://git-scm.com>, then close and reopen the terminal.

### 2. Open a terminal

- **Windows:** press the Windows key, type `cmd`, press Enter.
- **Mac:** press Cmd + Space, type `Terminal`, press Enter.

### 3. Get the code

If you **don't** have the project on your computer yet:

```bash
git clone https://github.com/karakaraye/Halqa.git
```

```bash
cd Halqa
```

If you **already** have it, go into the folder (`cd` followed by the path to your Halqa folder), then:

```bash
git fetch origin
```

### 4. Switch to the branch with the AI feature

```bash
git checkout claude/affectionate-wozniak-5mdcyy
```

```bash
git pull
```

(If the pull request has already been merged, use `git checkout main` and `git pull` instead.)

### 5. Install dependencies

```bash
npm install
```

This takes a minute. Warnings are normal; red `ERR!` lines are not.

### 6. Set your API key

Replace `sk-ant-...` with your real key. This only lasts for this terminal window.

**Mac or Linux:**

```bash
export ANTHROPIC_API_KEY=sk-ant-...
```

**Windows (Command Prompt / cmd):**

```bash
set ANTHROPIC_API_KEY=sk-ant-...
```

**Windows (PowerShell):**

```bash
$env:ANTHROPIC_API_KEY="sk-ant-..."
```

### 7. Build and start the app

```bash
npm run build
```

```bash
npm start
```

Leave this terminal open. When you see `Ready` or `started server on ... http://localhost:3000`, go to the next section: [Run the test](#run-the-test).

To stop the app later, click the terminal and press Ctrl + C.

---

## Option B: on Vercel (no terminal)

1. Go to <https://vercel.com> and sign in with GitHub.
2. Click **Add New… → Project** and import **karakaraye/Halqa**. If you don't see it, click *Adjust GitHub App Permissions* and give Vercel access to the repo.
3. Before clicking Deploy, open **Environment Variables** and add:
   - **Name:** `ANTHROPIC_API_KEY`
   - **Value:** your key
   - **Environments:** tick **Production** and **Preview** (Preview is needed to test the branch before it's merged)
4. Click **Deploy** and wait for it to finish (2–3 minutes).
5. To test the AI branch before it's merged: go to the project's **Deployments** tab, find the deployment for branch `claude/affectionate-wozniak-5mdcyy`, and open its URL. (If the pull request has been merged into `main`, the main production URL is enough.)
   - If the key was added after a deployment already ran, click **⋯ → Redeploy** on it so the key is picked up.
6. Open the deployment URL and continue with [Run the test](#run-the-test).

Keep the production URL: it's the live link for the submission.

---

## Run the test

Open the app (`http://localhost:3000` for Option A, or your Vercel URL for Option B).

### Test 1: Hindi draft

1. In the **Command Centre**, click the row for **Priya Nair**. A case panel opens on the right.
   - If you don't see her, click the **All open** queue button first.
2. Scroll to the card **"Explanation the patient reads"**.
3. Click **Draft one for this result in Hindi**. Start a timer.
4. Wait for the draft. **Write down how many seconds it took.**
5. Check what appears:
   - [ ] Hindi text in the big box, marked **"Draft · not visible to patient"**
   - [ ] An **English back-translation** below it
   - [ ] Possibly some yellow **review notes** (it's fine if there are none)
   - [ ] The back-translation makes medical sense and doesn't diagnose cancer

### Test 2: Approve and publish

1. At the top right, change **"Acting as"** to the GP (**Dr. Mariam Al Zaabi · Primary Care Physician**).
2. Optionally edit a word in the draft.
3. Click **Approve & publish to patient**.
   - [ ] The card turns green: **"Live in patient app"**, approved by the doctor's name.
4. Close the case panel (✕ at top right) and click the **Patient App** tab.
   - [ ] Priya's result screen shows the new text, with **"Written for your result · reviewed by …"** underneath.
   - [ ] Switching the phone's language to **English** shows the standard text instead (expected: the draft is Hindi only).

### Test 3: Right-to-left language

1. Back in the **Command Centre**, open **Sultan Al Mansoori** (Arabic) and click **Draft one for this result in Arabic**.
   - [ ] The Arabic text reads right-to-left and isn't garbled.
   - [ ] Note the time it took.

### Test 4: Without a key (optional)

Start the app without setting the key (or remove it in Vercel and redeploy), then click **Draft one…**.

- [ ] A yellow message says AI drafting **is not configured**, and everything else still works.

---

## If something goes wrong

| What you see | What it means | What to do |
|---|---|---|
| "AI drafting is not configured on this deployment" | The key isn't set where the app is running | Option A: run the `export` / `set` line again **in the same terminal** before `npm start`. Option B: add the variable, then **Redeploy**. |
| "The server's Anthropic API key was rejected" | Key is wrong, revoked, or the account has no credit | Check the key in the console and that billing is set up. |
| "The AI service is busy" | Rate limit | Wait 30 seconds and try again. |
| "The AI service returned an error" | The API rejected the request | Find the error line (below) and send it to the team. |
| "The model declined to draft…" | A safety filter declined | Note which patient it was and send it to the team. |
| Button spins for more than 60 seconds | Slow response or network issue | Note it; we'll skip this step in the live demo. |

**Where the real error is:**

- **Option A:** in the terminal running `npm start`, on a line starting with `draft-explanation`.
- **Option B:** Vercel project → **Logs** tab → filter for `draft-explanation`.

Copy that line and send it to the team. It never contains the API key.

---

## Report back

Send the team:

1. **Did it work?** Yes / No (and the error line if no)
2. **Time per draft:** Hindi ___ s, Arabic ___ s
3. **One Hindi draft and its back-translation** (copy-paste both), so the wording can be reviewed
4. **Anything that looked wrong** (garbled text, a diagnosis, a scary tone)

**Demo decision:** if a draft takes more than ~20 seconds or fails at all, we skip the optional AI step (2b in `PITCH.md`) on stage. Nothing else in the demo depends on it.

---

## After judging

The drafting route has no login or rate limit. On a public URL, anyone who finds it can spend credit on the key. After judging, either:

- delete the key in the Anthropic console, or
- remove `ANTHROPIC_API_KEY` from Vercel and redeploy.
