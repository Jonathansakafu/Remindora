import nodemailer, { type Transporter } from 'nodemailer';

/** Transactional email with pluggable providers. Bodies are never logged except by the dev console provider. */

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface EmailSender {
  send(msg: EmailMessage): Promise<{ id: string | null }>;
}

export interface EmailConfig {
  provider: 'console' | 'smtp' | 'resend' | 'brevo';
  from: string;
  smtpUrl?: string;
  resendApiKey?: string;
  brevoApiKey?: string;
  /** Console provider output; defaults to console.log. */
  log?: (line: string) => void;
}

export function createEmailSender(cfg: EmailConfig): EmailSender {
  switch (cfg.provider) {
    case 'smtp': {
      if (!cfg.smtpUrl) throw new Error('SMTP_URL is required for EMAIL_PROVIDER=smtp');
      const transport: Transporter = nodemailer.createTransport(cfg.smtpUrl);
      return {
        async send(msg) {
          const info = await transport.sendMail({ from: cfg.from, ...msg });
          return { id: info.messageId ?? null };
        },
      };
    }
    case 'resend': {
      if (!cfg.resendApiKey) throw new Error('RESEND_API_KEY is required for EMAIL_PROVIDER=resend');
      return {
        async send(msg) {
          const res = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { Authorization: `Bearer ${cfg.resendApiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ from: cfg.from, to: [msg.to], subject: msg.subject, text: msg.text, html: msg.html }),
          });
          if (!res.ok) throw new Error(`Resend responded ${res.status}`);
          const body = (await res.json()) as { id?: string };
          return { id: body.id ?? null };
        },
      };
    }
    case 'brevo': {
      // HTTPS API, for hosts that block outbound SMTP. Sender must be verified in Brevo.
      if (!cfg.brevoApiKey) throw new Error('BREVO_API_KEY is required for EMAIL_PROVIDER=brevo');
      const m = /^\s*(?:"?([^"<]*?)"?\s*)?<([^>]+)>\s*$/.exec(cfg.from);
      const sender = m ? { name: m[1] || undefined, email: m[2]! } : { email: cfg.from.trim() };
      return {
        async send(msg) {
          const res = await fetch('https://api.brevo.com/v3/smtp/email', {
            method: 'POST',
            headers: { 'api-key': cfg.brevoApiKey!, 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({ sender, to: [{ email: msg.to }], subject: msg.subject, textContent: msg.text, htmlContent: msg.html }),
            signal: AbortSignal.timeout(15_000),
          });
          if (!res.ok) throw new Error(`Brevo responded ${res.status}`);
          const body = (await res.json()) as { messageId?: string };
          return { id: body.messageId ?? null };
        },
      };
    }
    default: {
      const log = cfg.log ?? ((line: string) => console.log(line));
      return {
        async send(msg) {
          log(`\n──── email to ${msg.to} ────\nSubject: ${msg.subject}\n\n${msg.text}\n────────────────────────────\n`);
          return { id: null };
        },
      };
    }
  }
}

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Minimal branded HTML shell (inline styles for email clients). */
export function emailLayout(title: string, bodyHtml: string, footer = 'You’re receiving this because of activity on your Remindora account.'): string {
  return `<!doctype html><html><body style="margin:0;background:#0B1330;font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#E8F4FF">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:40px 16px">
<table role="presentation" width="100%" style="max-width:520px;background:#111C3E;border:1px solid rgba(168,239,255,.18);border-radius:20px;padding:32px">
<tr><td style="font-size:13px;letter-spacing:.14em;text-transform:uppercase;color:#60E9FF;font-weight:600">Remindora</td></tr>
<tr><td style="padding-top:12px;font-size:22px;font-weight:600;color:#F5FCFF">${escape(title)}</td></tr>
<tr><td style="padding-top:16px;font-size:15px;line-height:1.6;color:#C9DAF0">${bodyHtml}</td></tr>
<tr><td style="padding-top:28px;font-size:12px;color:#7F92B5">${escape(footer)}</td></tr>
</table></td></tr></table></body></html>`;
}

export const templates = {
  signInCode(code: string, link: string, deviceName: string): EmailMessage & { to: '' } {
    return {
      to: '',
      subject: `${code} is your Remindora sign-in code`,
      text: `Your Remindora sign-in code is ${code}\n\nOr open this link to sign in "${deviceName}":\n${link}\n\nThe code and link expire in 10 minutes and work once. If you didn't request this, you can ignore this email.`,
      html: emailLayout(
        'Your sign-in code',
        `<p>Enter this code on <strong>${escape(deviceName)}</strong>:</p>
<p style="font-size:34px;letter-spacing:.3em;font-weight:700;color:#F5FCFF;margin:18px 0">${code}</p>
<p>Or <a href="${escape(link)}" style="color:#60E9FF">sign in with one click</a>.</p>
<p style="color:#7F92B5">Expires in 10 minutes and can be used once. If you didn’t request this, ignore this email — nobody can sign in without the code.</p>`,
      ),
    };
  },
  reauthCode(code: string): EmailMessage & { to: '' } {
    return {
      to: '',
      subject: `${code} — confirm it’s you`,
      text: `Use ${code} to confirm a sensitive action (like linking a new device) on Remindora. Expires in 10 minutes.`,
      html: emailLayout('Confirm it’s you', `<p>Use this code to continue linking a device or changing security settings:</p><p style="font-size:34px;letter-spacing:.3em;font-weight:700;color:#F5FCFF">${code}</p>`),
    };
  },
  newDevice(deviceName: string, method: string, when: string): EmailMessage & { to: '' } {
    return {
      to: '',
      subject: 'New device linked to your Remindora account',
      text: `"${deviceName}" was linked to your account via ${method} at ${when}. If this wasn't you, open Settings → Linked Devices and revoke it.`,
      html: emailLayout('New device linked', `<p><strong>${escape(deviceName)}</strong> was linked via ${escape(method)} at ${escape(when)}.</p><p>Not you? Open <em>Settings → Linked Devices</em> and revoke it immediately.</p>`),
    };
  },
  invite(workspace: string, inviter: string, link: string): EmailMessage & { to: '' } {
    return {
      to: '',
      subject: `${inviter} invited you to ${workspace} on Remindora`,
      text: `${inviter} invited you to collaborate in "${workspace}".\n\nAccept: ${link}\n\nThis invite expires in 7 days.`,
      html: emailLayout(`Join ${workspace}`, `<p>${escape(inviter)} invited you to collaborate in <strong>${escape(workspace)}</strong>.</p><p><a href="${escape(link)}" style="display:inline-block;background:#60E9FF;color:#06122E;padding:12px 20px;border-radius:12px;text-decoration:none;font-weight:600">Accept invite</a></p>`),
    };
  },
  reminder(title: string, when: string, priority: string, link: string): EmailMessage & { to: '' } {
    return {
      to: '',
      subject: `[${priority}] ${title}`,
      text: `${title}\nDue ${when}\n\nOpen: ${link}`,
      html: emailLayout(title, `<p>Due <strong>${escape(when)}</strong> · ${escape(priority)} priority</p><p><a href="${escape(link)}" style="color:#60E9FF">Open in Remindora</a> to complete, snooze or reschedule.</p>`),
    };
  },
  digest(heading: string, lines: string[], link: string): EmailMessage & { to: '' } {
    return {
      to: '',
      subject: heading,
      text: `${heading}\n\n${lines.map((l) => `• ${l}`).join('\n')}\n\n${link}`,
      html: emailLayout(heading, `<ul style="padding-left:18px">${lines.map((l) => `<li style="margin:6px 0">${escape(l)}</li>`).join('')}</ul><p><a href="${escape(link)}" style="color:#60E9FF">Plan your day</a></p>`),
    };
  },
};
