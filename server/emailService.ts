import { Resend } from 'resend';
import { randomBytes } from 'crypto';
import { logger } from './logger';

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

// Log email service status on startup (use console.log for reliability)
if (resend) {
  console.log('[EMAIL] ✅ Resend email service initialized with FROM:', process.env.FROM_EMAIL || 'onboarding@resend.dev');
  logger.info('[EMAIL] Resend email service initialized', { fromEmail: process.env.FROM_EMAIL || 'onboarding@resend.dev' });
} else {
  console.warn('[EMAIL] ⚠️ Resend not configured - RESEND_API_KEY missing');
  logger.warn('[EMAIL] Resend not configured - RESEND_API_KEY missing');
}

const APP_NAME = 'Quant Edge Labs';
const APP_URL = process.env.APP_URL || 'https://quantedgelabs.net';
const FROM_EMAIL = process.env.FROM_EMAIL || 'onboarding@resend.dev';

export function generateInviteToken(): string {
  return randomBytes(32).toString('hex');
}

export function getInviteLink(token: string): string {
  return `${APP_URL}/invite?code=${token}`;
}

export async function sendBetaInviteEmail(
  email: string,
  token: string,
  options?: {
    tierOverride?: string;
    personalMessage?: string;
  }
): Promise<{ success: boolean; error?: string }> {
  console.log('[EMAIL] 📧 sendBetaInviteEmail called:', { to: email, hasToken: !!token, hasTier: !!options?.tierOverride });
  logger.info('[EMAIL] sendBetaInviteEmail called', { to: email, hasToken: !!token, hasTier: !!options?.tierOverride });
  
  if (!resend) {
    console.error('[EMAIL] ❌ Resend not configured - RESEND_API_KEY missing');
    logger.warn('[EMAIL] Resend not configured - RESEND_API_KEY missing');
    return { success: false, error: 'Email service not configured' };
  }
  
  console.log('[EMAIL] 📤 Attempting to send to:', email, 'from:', FROM_EMAIL);

  const inviteLink = getInviteLink(token);
  const tierBadge = options?.tierOverride 
    ? `<span style="background: #262626; color: #22d3ee; padding: 6px 14px; border-radius: 4px; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 1px;">${options.tierOverride} Access</span>`
    : '';

  const unsubscribeUrl = `${APP_URL}/unsubscribe?email=${encodeURIComponent(email)}`;
  const unsubscribeMailto = 'unsubscribe@quantedgelabs.net';
  
  try {
    const { data, error } = await resend.emails.send({
      from: `${APP_NAME} <${FROM_EMAIL}>`,
      replyTo: 'support@quantedgelabs.net',
      to: email,
      subject: `Beta access for ${APP_NAME}`,
      headers: {
        'List-Unsubscribe': `<${unsubscribeUrl}>, <mailto:${unsubscribeMailto}>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        'List-ID': `<beta.quantedgelabs.net>`,
        'Precedence': 'bulk',
        'X-Auto-Response-Suppress': 'OOF, AutoReply',
      },
      text: `Hello,

You have been invited to join ${APP_NAME}, a quantitative trading research platform for educational purposes.

${options?.personalMessage ? `Note: ${options.personalMessage}\n\n` : ''}Your access link: ${inviteLink}

Platform features:
- Market analysis tools
- Technical indicators (RSI, VWAP, ADX)
- Chart pattern detection
- Trading journal

This link expires in 7 days.

---
${APP_NAME}
For educational and research purposes only.

To stop receiving emails: ${unsubscribeUrl}
`,
      html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Beta Invitation - ${APP_NAME}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #0a0a0a; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #0a0a0a; padding: 48px 24px;">
    <tr>
      <td align="center">
        <table width="520" cellpadding="0" cellspacing="0" style="max-width: 520px;">
          
          <!-- Logo with Q mark -->
          <tr>
            <td style="padding: 0 0 32px; text-align: center;">
              <table cellpadding="0" cellspacing="0" style="display: inline-table;">
                <tr>
                  <td style="width: 36px; height: 36px; background: linear-gradient(135deg, #22d3ee, #0891b2); border-radius: 8px; text-align: center; vertical-align: middle;">
                    <span style="font-size: 18px; font-weight: 700; color: #ffffff;">Q</span>
                  </td>
                  <td style="padding-left: 12px;">
                    <span style="font-size: 20px; font-weight: 700; color: #ffffff; letter-spacing: -0.5px;">QUANT EDGE</span>
                    <span style="color: #404040; margin: 0 6px;">|</span>
                    <span style="font-size: 12px; font-weight: 500; color: #737373; letter-spacing: 2px;">LABS</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Main Content Card -->
          <tr>
            <td style="background: #111111; border: 1px solid #1f1f1f; border-radius: 16px; padding: 0; overflow: hidden;">
              
              <!-- Top accent line -->
              <div style="height: 2px; background: linear-gradient(90deg, transparent, #22d3ee, transparent);"></div>
              
              <div style="padding: 40px;">
                <!-- Badge -->
                <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom: 20px;">
                  <tr>
                    <td align="center">
                      <span style="display: inline-block; background: rgba(34, 211, 238, 0.1); border: 1px solid rgba(34, 211, 238, 0.2); color: #22d3ee; padding: 6px 14px; border-radius: 20px; font-size: 11px; font-weight: 600; letter-spacing: 0.5px;">BETA ACCESS</span>
                    </td>
                  </tr>
                </table>
                
                <!-- Header -->
                <h1 style="color: #fafafa; font-size: 26px; font-weight: 600; margin: 0 0 8px; text-align: center;">
                  Platform Access
                </h1>
                <p style="color: #737373; font-size: 14px; margin: 0 0 28px; text-align: center;">
                  Your account for Quant Edge Labs is ready.
                </p>
                
                ${tierBadge ? `<div style="text-align: center; margin-bottom: 24px;">${tierBadge}</div>` : ''}
                
                ${options?.personalMessage ? `
                <div style="background: #1a1a1a; border-left: 2px solid #22d3ee; padding: 14px 16px; margin: 0 0 24px; border-radius: 0 8px 8px 0;">
                  <p style="color: #a3a3a3; font-size: 13px; margin: 0; font-style: italic;">"${options.personalMessage}"</p>
                </div>
                ` : ''}

                <!-- CTA Button -->
                <table width="100%" cellpadding="0" cellspacing="0" style="margin: 0 0 28px;">
                  <tr>
                    <td align="center">
                      <a href="${inviteLink}" style="display: inline-block; background: #22d3ee; color: #0a0a0a; text-decoration: none; padding: 14px 36px; border-radius: 10px; font-size: 14px; font-weight: 600;">
                        Accept Invitation →
                      </a>
                    </td>
                  </tr>
                </table>

                <!-- Features with icons -->
                <table width="100%" cellpadding="0" cellspacing="0" style="border-top: 1px solid #1f1f1f; padding-top: 24px;">
                  <tr>
                    <td style="padding: 10px 0;">
                      <table cellpadding="0" cellspacing="0">
                        <tr>
                          <td style="width: 32px; height: 32px; background: #1a1a1a; border: 1px solid #262626; border-radius: 8px; text-align: center; vertical-align: middle;">
                            <span style="color: #22d3ee; font-size: 14px;">✦</span>
                          </td>
                          <td style="padding-left: 12px; color: #d4d4d4; font-size: 13px;">AI-powered analysis</td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding: 10px 0;">
                      <table cellpadding="0" cellspacing="0">
                        <tr>
                          <td style="width: 32px; height: 32px; background: #1a1a1a; border: 1px solid #262626; border-radius: 8px; text-align: center; vertical-align: middle;">
                            <span style="color: #22d3ee; font-size: 14px;">◆</span>
                          </td>
                          <td style="padding-left: 12px; color: #d4d4d4; font-size: 13px;">Quantitative signals</td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding: 10px 0;">
                      <table cellpadding="0" cellspacing="0">
                        <tr>
                          <td style="width: 32px; height: 32px; background: #1a1a1a; border: 1px solid #262626; border-radius: 8px; text-align: center; vertical-align: middle;">
                            <span style="color: #22d3ee; font-size: 14px;">▲</span>
                          </td>
                          <td style="padding-left: 12px; color: #d4d4d4; font-size: 13px;">Chart pattern detection</td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding: 10px 0;">
                      <table cellpadding="0" cellspacing="0">
                        <tr>
                          <td style="width: 32px; height: 32px; background: #1a1a1a; border: 1px solid #262626; border-radius: 8px; text-align: center; vertical-align: middle;">
                            <span style="color: #22d3ee; font-size: 14px;">◉</span>
                          </td>
                          <td style="padding-left: 12px; color: #d4d4d4; font-size: 13px;">Trading journal</td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                </table>
              </div>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 24px 0 0; text-align: center;">
              <p style="color: #525252; font-size: 11px; margin: 0 0 8px;">
                This link expires in 7 days.
              </p>
              <p style="color: #404040; font-size: 10px; margin: 0 0 8px;">
                ${APP_NAME} • For educational and research purposes only
              </p>
              <p style="color: #404040; font-size: 10px; margin: 0;">
                <a href="${unsubscribeUrl}" style="color: #525252; text-decoration: underline;">Unsubscribe</a>
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
      `,
    });

    if (error) {
      console.error('[EMAIL] ❌ Failed to send invite:', error.message, error.name);
      logger.error('[EMAIL] Failed to send invite', { error: error.message, name: error.name, to: email });
      return { success: false, error: error.message };
    }

    console.log('[EMAIL] ✅ Beta invite sent successfully to:', email, 'messageId:', data?.id);
    logger.info('[EMAIL] Beta invite sent successfully', { to: email, messageId: data?.id });
    return { success: true };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    console.error('[EMAIL] ❌ Exception sending invite:', errorMessage);
    logger.error('[EMAIL] Error sending invite', { error: errorMessage, to: email });
    return { success: false, error: errorMessage };
  }
}

export async function sendWelcomeEmail(
  email: string,
  firstName?: string
): Promise<{ success: boolean; error?: string }> {
  if (!resend) {
    console.warn('[Email] Resend not configured - RESEND_API_KEY missing');
    return { success: false, error: 'Email service not configured' };
  }

  const name = firstName || 'Trader';

  try {
    const { data, error } = await resend.emails.send({
      from: `${APP_NAME} <${FROM_EMAIL}>`,
      to: email,
      subject: `Welcome to ${APP_NAME}, ${name}!`,
      html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; background-color: #0f172a; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #0f172a; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="max-width: 600px; background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%); border-radius: 16px; border: 1px solid #334155;">
          
          <tr>
            <td style="padding: 40px; text-align: center;">
              <div style="font-size: 28px; font-weight: 700; color: #22d3ee; margin-bottom: 16px;">
                Welcome to ${APP_NAME}!
              </div>
              <p style="color: #cbd5e1; font-size: 16px; line-height: 1.6; margin: 0 0 24px;">
                Hey ${name}, you're officially part of the beta! We're excited to have you on board.
              </p>
              <a href="${APP_URL}/dashboard" style="display: inline-block; background: linear-gradient(135deg, #06b6d4, #0891b2); color: #ffffff; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-size: 16px; font-weight: 600;">
                Go to Dashboard →
              </a>
            </td>
          </tr>

          <tr>
            <td style="padding: 0 40px 40px;">
              <div style="background: #1e293b; border-radius: 12px; padding: 20px;">
                <p style="color: #f1f5f9; font-size: 14px; font-weight: 600; margin: 0 0 12px;">Quick Start:</p>
                <p style="color: #94a3b8; font-size: 14px; margin: 0;">
                  1. Explore the <strong style="color: #22d3ee;">Trade Desk</strong> for AI-powered research<br>
                  2. Check out <strong style="color: #22d3ee;">Chart Analysis</strong> for pattern recognition<br>
                  3. Join our <a href="https://discord.gg/3QF8QEKkYq" style="color: #22d3ee;">Discord</a> for community support
                </p>
              </div>
            </td>
          </tr>

          <tr>
            <td style="padding: 24px 40px; border-top: 1px solid #334155; text-align: center;">
              <p style="color: #475569; font-size: 11px; margin: 0;">
                ${APP_NAME} • For Educational & Research Purposes Only
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
      `,
    });

    if (error) {
      console.error('[Email] Failed to send welcome email:', error);
      return { success: false, error: error.message };
    }

    console.log('[Email] Welcome email sent:', data?.id);
    return { success: true };
  } catch (err) {
    console.error('[Email] Error sending welcome email:', err);
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}

export function isEmailServiceConfigured(): boolean {
  return !!resend;
}

export async function sendPasswordResetEmail(
  email: string,
  token: string
): Promise<{ success: boolean; error?: string }> {
  if (!resend) {
    console.warn('[Email] Resend not configured - RESEND_API_KEY missing');
    return { success: false, error: 'Email service not configured' };
  }

  const resetLink = `${APP_URL}/reset-password?token=${token}`;

  try {
    const { data, error } = await resend.emails.send({
      from: `${APP_NAME} <${FROM_EMAIL}>`,
      replyTo: 'support@quantedgelabs.net',
      to: email,
      subject: `Reset your ${APP_NAME} password`,
      headers: {
        'List-Unsubscribe': '<mailto:unsubscribe@quantedgelabs.net>',
        'X-Priority': '3',
      },
      text: `Password Reset Request

You requested to reset your password for ${APP_NAME}.

Click here to reset your password: ${resetLink}

This link expires in 1 hour. If you didn't request this, you can safely ignore this email.

${APP_NAME} - For Educational & Research Purposes Only
`,
      html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; background-color: #050b16; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #050b16; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="max-width: 600px; background: linear-gradient(180deg, #0a1628 0%, #050b16 100%); border-radius: 16px; border: 1px solid rgba(6, 182, 212, 0.15); overflow: hidden;">
          
          <tr>
            <td style="padding: 40px; text-align: center;">
              <div style="font-size: 24px; font-weight: 700; color: #22d3ee; margin-bottom: 16px;">
                Password Reset Request
              </div>
              <p style="color: #cbd5e1; font-size: 16px; line-height: 1.6; margin: 0 0 24px;">
                You requested to reset your password. Click the button below to create a new password.
              </p>
              <a href="${resetLink}" style="display: inline-block; background: linear-gradient(135deg, #06b6d4, #0891b2); color: #ffffff; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-size: 16px; font-weight: 600;">
                Reset Password
              </a>
              <p style="color: #64748b; font-size: 12px; margin-top: 24px;">
                This link expires in 1 hour. If you didn't request this, you can safely ignore this email.
              </p>
            </td>
          </tr>

          <tr>
            <td style="padding: 24px 40px; border-top: 1px solid #334155; text-align: center;">
              <p style="color: #475569; font-size: 11px; margin: 0;">
                ${APP_NAME} • For Educational & Research Purposes Only
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
      `,
    });

    if (error) {
      console.error('[Email] Failed to send password reset email:', error);
      return { success: false, error: error.message };
    }

    console.log('[Email] Password reset email sent:', data?.id);
    return { success: true };
  } catch (err) {
    console.error('[Email] Error sending password reset email:', err);
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}
