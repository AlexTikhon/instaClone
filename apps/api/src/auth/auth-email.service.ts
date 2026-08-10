import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import nodemailer, { type Transporter } from 'nodemailer';

import type { ApiEnvironment } from '@instaclone/config';

@Injectable()
export class AuthEmailService {
  private readonly transporter: Transporter;
  private readonly from: string;
  private readonly webAppUrl: string;

  constructor(config: ConfigService<ApiEnvironment, true>) {
    this.transporter = nodemailer.createTransport(config.get('AUTH_SMTP_URL', { infer: true }));
    this.from = config.get('AUTH_EMAIL_FROM', { infer: true });
    this.webAppUrl = config.get('WEB_APP_URL', { infer: true }).replace(/\/$/, '');
  }

  async sendEmailVerification(email: string, token: string): Promise<void> {
    const url = `${this.webAppUrl}/verify-email?token=${encodeURIComponent(token)}`;
    await this.transporter.sendMail({
      from: this.from,
      to: email,
      subject: 'Verify your InstaClone email',
      text: `Verify your email address: ${url}`,
    });
  }

  async sendPasswordReset(email: string, token: string): Promise<void> {
    const url = `${this.webAppUrl}/reset-password?token=${encodeURIComponent(token)}`;
    await this.transporter.sendMail({
      from: this.from,
      to: email,
      subject: 'Reset your InstaClone password',
      text: `Reset your password: ${url}`,
    });
  }
}
