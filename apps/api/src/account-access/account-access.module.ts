import { Module } from '@nestjs/common';

import { AccountAccessPolicy } from './account-access-policy';

@Module({ providers: [AccountAccessPolicy], exports: [AccountAccessPolicy] })
export class AccountAccessModule {}
