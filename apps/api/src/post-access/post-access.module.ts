import { Module } from '@nestjs/common';

import { PostAccessPolicy } from './post-access-policy';

@Module({ providers: [PostAccessPolicy], exports: [PostAccessPolicy] })
export class PostAccessModule {}
