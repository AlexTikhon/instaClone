import { Module } from '@nestjs/common';

import { IDENTITY_REPOSITORY } from './identity.repository';
import { PrismaIdentityRepository } from './prisma-identity.repository';

@Module({
  providers: [{ provide: IDENTITY_REPOSITORY, useClass: PrismaIdentityRepository }],
  exports: [IDENTITY_REPOSITORY],
})
export class IdentityModule {}
