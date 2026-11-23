# LinkedIn Job Mailer

A Chrome extension that lists job posts on the LinkedIn page you already have open, drafts an email, and sends it from your mailbox after you approve it. You stay signed in to LinkedIn yourself. The extension does not ask for your LinkedIn password.

## What you need

- Google Chrome
- Node.js 22 or newer, for the mail program on this computer
- An API key from OpenAI, xAI, Groq, OpenRouter, or Cursor
- A mailbox that can send with SMTP. For Gmail, create a 16-character [App Password](https://myaccount.google.com/apppasswords) and use the Gmail address that owns it

## 1. Start the mail relay

A browser cannot open an SMTP port, so a small program on this computer sends the mail. It only listens on this machine.

```bash
cd mail-relay
npm install
node server.js
```

Leave that terminal open. It should print `Mail relay listening on http://127.0.0.1:8787`.

## 2. Install the extension

1. Open `chrome://extensions`.
2. Turn on **Developer mode**.
3. Click **Load unpacked**.
4. Choose the `extension` folder in this project.

After you pull a newer copy, click **Reload** on that card, then refresh the LinkedIn tab and open the panel again.

## 3. Configure

Open **Settings** from the panel, or open the extension’s options page from `chrome://extensions`.

### Model

Pick a provider. The API base URL is the provider root, and the API key must belong to that same provider.

| Provider | API base URL |
| --- | --- |
| OpenAI | `https://api.openai.com/v1` |
| xAI | `https://api.x.ai/v1` |
| Groq | `https://api.groq.com/openai/v1` |
| OpenRouter | `https://openrouter.ai/api/v1` |
| Cursor | `https://api.cursor.com` |

Cursor has no chat-completions route. A draft through `https://api.cursor.com` uses your Cursor account model and can take about a minute. The model name field is ignored for that address.

### Mailbox

For Gmail:

| Field | Value |
| --- | --- |
| SMTP host | `smtp.gmail.com` |
| Port | `587` |
| Encryption | STARTTLS |
| SMTP username | The full Gmail address that created the app password |
| SMTP password | The 16-character app password. Spaces can stay in the field. |
| From name | The name recipients should see |
| From email | The address recipients should see |
| Relay URL | `http://127.0.0.1:8787` |
| Relay token | Leave `the same token`. The relay does not check it. |

Click **Save**, then **Test mail connection**. The test should report that the mailbox accepted the login. The eye icon next to the password shows or hides it.

### Matching and signature

- **LinkedIn group or jobs URL.** An `https://www.linkedin.com/...` page. **Open saved group** uses this address.
- **Keywords.** Separate them with commas. A post matches when the whole phrase appears, or when every word of two or more letters appears. `full stock` does not match `full stack`.
- **Your name** and a **short background**. The draft may use only those facts plus the job post. It does not invent employers, degrees, or years of experience.

## 4. Scan and send

1. Sign in to LinkedIn and open the group.
2. Click the **LinkedIn Job Mailer** icon. The panel opens in the empty space on the right. Click the icon again to close it.
3. Click **Scan this page**. A spinner shows while the page scrolls and posts are collected. Matching posts are listed first. Others are marked “Outside your keywords.”
4. Click a result to scroll that post into view. Fix the recipient if the scanned address has extra characters.
5. Click **Draft email**. Review the subject and message. You can attach one file, up to 5 MB.
6. Check the approval box, then click **Send this email**.

The API key and SMTP password stay in Chrome storage on this computer. Do not put them in this repository.
