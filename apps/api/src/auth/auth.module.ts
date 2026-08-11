import { Module } from '@nestjs/common';

import { IdentityModule } from '../identity/identity.module';
import { AccessAuthGuard } from './access-auth.guard';
import { AccessSessionAuthenticator } from './access-session-authenticator';
import { AuthCleanupService } from './auth-cleanup.service';
import { AuthController } from './auth.controller';
import { AuthEmailService } from './auth-email.service';
import { AuthRateLimitGuard } from './auth-rate-limit.guard';
import { AuthTokensService } from './auth-tokens.service';
import { AuthService } from './auth.service';
import { CsrfGuard } from './csrf.guard';
import { PasswordService } from './password.service';
import { VerifiedEmailGuard } from './verified-email.guard';

@Module({
  imports: [IdentityModule],
  controllers: [AuthController],
  providers: [
    AccessAuthGuard,
    AccessSessionAuthenticator,
    AuthCleanupService,
    AuthEmailService,
    AuthRateLimitGuard,
    AuthService,
    AuthTokensService,
    CsrfGuard,
    PasswordService,
    VerifiedEmailGuard,
  ],
  exports: [
    AccessAuthGuard,
    AccessSessionAuthenticator,
    AuthTokensService,
    CsrfGuard,
    VerifiedEmailGuard,
  ],
})
export class AuthModule {}
