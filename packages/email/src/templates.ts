export type EmailContent = { subject: string; text: string; html: string };

export function waitlistEntryEmail(input: { platformName: string; email: string; joinedAt: Date }): EmailContent {
  const joined = input.joinedAt.toISOString().replace("T", " ").replace(/\.\d{3}Z$/, " UTC");
  const name = escapeHtml(input.platformName);
  const email = escapeHtml(input.email);
  return {
    subject: `Someone joined the ${input.platformName} waitlist`.replace(/[\r\n]+/g, " "),
    text: `A new person is waiting for ${input.platformName}.\n\nEmail: ${input.email}\nJoined: ${joined}\nSource: Website waitlist\n\nThey agreed to receive a launch notification. This is a new entry, not a duplicate submission.`,
    html: `<!doctype html><html lang="en"><body style="margin:0;padding:32px 16px;background:#f4f5f0;font-family:Arial,sans-serif;color:#20251e">
<table role="presentation" style="width:100%;max-width:540px;margin:0 auto;border-collapse:collapse"><tr><td style="padding:30px;background:#ffffff;border-top:5px solid #b9db79">
<p style="margin:0 0 28px;font-size:17px;font-weight:bold">${name}</p>
<p style="margin:0 0 10px;color:#4d6630;font-size:12px;font-weight:bold;letter-spacing:1px">NEW WAITLIST SIGN-UP</p>
<h1 style="margin:0 0 14px;font-size:28px;line-height:1.2">Someone is looking forward to launch.</h1>
<p style="margin:0 0 26px;color:#596051;line-height:1.6">One more person wants to hear when ${name} opens.</p>
<table role="presentation" style="width:100%;background:#f4f5f0;border-collapse:collapse"><tr><td style="padding:20px">
<p style="margin:0 0 6px;font-size:12px;color:#596051">EMAIL ADDRESS</p><p style="margin:0 0 20px;font-size:18px;word-break:break-all">${email}</p>
<p style="margin:0 0 6px;font-size:12px;color:#596051">JOINED</p><p style="margin:0;font-size:14px">${joined}</p>
</td></tr></table><p style="margin:24px 0 0;font-size:13px;line-height:1.6;color:#596051">Source: website waitlist.<br>Consent recorded for a launch notification.</p>
</td></tr><tr><td style="padding:18px 0;font-size:12px;color:#777e70;text-align:center">${name} · Waitlist updates</td></tr></table></body></html>`,
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderHtml(input: { platformName: string; greeting: string; intro: string; action: string; url: string; outro: string }): string {
  const url = escapeHtml(input.url);
  return `<!doctype html>
<html lang="en">
<body style="margin:0;padding:24px;background:#f6f6f6;font-family:system-ui,-apple-system,Segoe UI,sans-serif;color:#111">
<div style="max-width:480px;margin:0 auto;background:#fff;padding:32px;border-radius:8px">
<p style="margin:0 0 16px;font-size:18px;font-weight:600">${escapeHtml(input.platformName)}</p>
<p style="margin:0 0 16px">${escapeHtml(input.greeting)}</p>
<p style="margin:0 0 24px">${escapeHtml(input.intro).replace(/\n/g, "<br>")}</p>
<p style="margin:0 0 24px"><a href="${url}" style="display:inline-block;background:#111;color:#fff;padding:12px 20px;border-radius:6px;text-decoration:none">${escapeHtml(input.action)}</a></p>
<p style="margin:0 0 16px;font-size:14px;color:#555">Or paste this link into your browser:<br><a href="${url}" style="color:#555;word-break:break-all">${url}</a></p>
<p style="margin:0;font-size:14px;color:#555">${escapeHtml(input.outro)}</p>
</div>
</body>
</html>`;
}

function render(input: { platformName: string; subject: string; name: string; intro: string; action: string; url: string; outro: string }): EmailContent {
  const greeting = `Hi ${input.name},`;
  return {
    // A caller-supplied name can land in the subject; CR/LF must not survive into the header.
    subject: input.subject.replace(/[\r\n]+/g, " "),
    text: [greeting, "", input.intro, input.url, "", input.outro].join("\n"),
    html: renderHtml({ platformName: input.platformName, greeting, intro: input.intro, action: input.action, url: input.url, outro: input.outro }),
  };
}

// Shared by the notice builders: one action email with an escaped, clickable link.
export function renderActionEmail(input: {
  platformName: string;
  subject: string;
  name: string;
  intro: string;
  action: string;
  url: string;
  outro: string;
}): EmailContent {
  return render(input);
}

export function verificationEmail(input: { platformName: string; name: string; url: string }): EmailContent {
  return render({
    platformName: input.platformName,
    subject: `Verify your email for ${input.platformName}`,
    name: input.name,
    intro: `Confirm your email address to finish creating your ${input.platformName} account.`,
    action: "Verify email",
    url: input.url,
    outro: `This link expires in 1 hour. If you did not sign up for ${input.platformName}, you can ignore this email.`,
  });
}

export function passwordResetEmail(input: { platformName: string; name: string; url: string }): EmailContent {
  return render({
    platformName: input.platformName,
    subject: `Reset your ${input.platformName} password`,
    name: input.name,
    intro: `Use this link to choose a new password for your ${input.platformName} account.`,
    action: "Choose a new password",
    url: input.url,
    outro:
      "This link expires in 1 hour. If you did not ask to reset your password, you can ignore this email; your password stays the same.",
  });
}

export function quoteRequestLinkEmail(input: { platformName: string; clientName: string; teamName: string; url: string }): EmailContent {
  return render({
    platformName: input.platformName,
    subject: `Your request to ${input.teamName}`,
    name: input.clientName,
    intro: `${input.teamName} received your request. Follow it, and accept or discuss the quote, on your private page:`,
    action: "Open your page",
    url: input.url,
    outro: "Keep this link; it is the way back to your page. If you did not send this request, you can ignore this email.",
  });
}

export function clientLinkEmail(input: {
  platformName: string;
  clientName: string;
  teamName: string;
  projectTitle: string;
  url: string;
}): EmailContent {
  return render({
    platformName: input.platformName,
    subject: `Your project with ${input.teamName}`,
    name: input.clientName,
    intro: `${input.teamName} sent you the link to your page for "${input.projectTitle}". Follow the work, and accept or discuss quotes and deliveries, there:`,
    action: "Open your page",
    url: input.url,
    outro: "Keep this link; it is the way back to your page. Links sent to you before for this project may no longer work.",
  });
}

export function quoteRequestNoticeEmail(input: {
  platformName: string;
  teamName: string;
  clientName: string;
  clientEmail: string;
  serviceName: string;
  description: string;
  answers: { question: string; answer: string }[];
  url: string;
}): EmailContent {
  const answerLines = input.answers.map(({ question, answer }) => `${question}\n${answer}`);
  const details = [
    `${input.clientName} (${input.clientEmail}) asks about ${input.serviceName}:`,
    "",
    input.description,
    ...(answerLines.length > 0 ? ["", ...answerLines] : []),
  ].join("\n");
  return render({
    platformName: input.platformName,
    subject: `New request from ${input.clientName}`,
    name: input.teamName,
    intro: details,
    action: "Open the project",
    url: input.url,
    outro: "Reply to the client from the project page; their link is in their email.",
  });
}

export function orderDownloadEmail(input: { platformName: string; teamName: string; productTitle: string; url: string }): EmailContent {
  return render({
    platformName: input.platformName,
    subject: `Your download: ${input.productTitle}`,
    name: "there",
    intro: `Thanks for your purchase from ${input.teamName}. Download ${input.productTitle} from your order page:`,
    action: "Download",
    url: input.url,
    outro:
      "The link works for 7 days and 5 downloads. After that, open it and ask for a new link; it comes to this address.",
  });
}
