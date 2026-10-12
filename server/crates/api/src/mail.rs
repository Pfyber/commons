//! Sign-in emails over SMTP (any provider: Postmark, Brevo, SES, Mailgun…).
//!
//! `SMTP_URL` picks the server, e.g. `smtps://user:pass@smtp.example.org:465`
//! (implicit TLS) or `smtp://user:pass@smtp.example.org:587?tls=required`
//! (STARTTLS). `MAIL_FROM` is the sender, e.g. `Commons <hello@example.org>`.

use anyhow::Context;
use lettre::message::{Mailbox, MultiPart};
use lettre::{AsyncSmtpTransport, AsyncTransport, Message, Tokio1Executor};

pub struct Mailer {
    transport: AsyncSmtpTransport<Tokio1Executor>,
    from: Mailbox,
}

impl Mailer {
    /// The mailer from `SMTP_URL` / `MAIL_FROM`, or `None` if unset.
    pub fn from_env() -> anyhow::Result<Option<Self>> {
        let url = std::env::var("SMTP_URL").unwrap_or_default();
        if url.is_empty() {
            return Ok(None);
        }
        let transport = AsyncSmtpTransport::<Tokio1Executor>::from_url(&url)
            .context("SMTP_URL")?
            .build();
        let from = std::env::var("MAIL_FROM")
            .context("MAIL_FROM must be set with SMTP_URL")?
            .parse()
            .context("MAIL_FROM")?;
        Ok(Some(Mailer { transport, from }))
    }

    /// Checks the connection and credentials (at startup).
    pub async fn check(&self) -> anyhow::Result<()> {
        anyhow::ensure!(
            self.transport.test_connection().await?,
            "SMTP server refused the connection"
        );
        Ok(())
    }

    pub async fn send_link(&self, to: &str, link: &str) -> anyhow::Result<()> {
        let (text, html) = link_email(link);
        let msg = Message::builder()
            .from(self.from.clone())
            .to(to.parse().context("recipient")?)
            .subject("Your way into Commons")
            .multipart(MultiPart::alternative_plain_html(text, html))?;
        self.transport.send(msg).await?;
        Ok(())
    }
}

/// Plain-text and HTML bodies of the sign-in email.
pub fn link_email(link: &str) -> (String, String) {
    let text = format!(
        "Hello!\n\nHere's your way into Commons:\n\n{link}\n\n\
         The link works once and for 15 minutes. If you didn't ask for it, \
         you can ignore this email.\n\nSee you in the park 🌱\n"
    );
    let html = format!(
        r#"<!doctype html><html><body style="margin:0;background:#eef3e6;font-family:system-ui,sans-serif;color:#2f3a2a">
<div style="max-width:440px;margin:32px auto;background:#fffdf6;border:2px solid #3b3a2e;border-radius:10px;padding:28px">
<h1 style="font-size:20px;margin:0 0 12px">Here's your way into Commons</h1>
<p style="line-height:1.5;margin:0 0 20px">Tap the button to step into the park.</p>
<p style="margin:0 0 24px"><a href="{link}" style="display:inline-block;background:#5f8f4e;color:#fff;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:8px">Enter Commons</a></p>
<p style="font-size:13px;line-height:1.5;color:#6b7563;margin:0">The link works once and for 15 minutes. If you didn't ask for it, you can ignore this email.</p>
</div></body></html>"#
    );
    (text, html)
}
