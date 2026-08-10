import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';

import type { Profile, UpdateProfileInput } from '@instaclone/api-contracts';

import {
  IDENTITY_REPOSITORY,
  IdentityConflictError,
  type IdentityRepository,
} from '../identity/identity.repository';

@Injectable()
export class ProfilesService {
  constructor(@Inject(IDENTITY_REPOSITORY) private readonly identities: IdentityRepository) {}

  async findPublic(username: string): Promise<Profile> {
    const profile = await this.identities.findProfileByUsername(username.trim().toLowerCase());
    if (!profile) throw new NotFoundException('Profile not found');
    return profile;
  }

  async updateOwn(userId: string, input: UpdateProfileInput): Promise<Profile> {
    try {
      const { websiteUrl, ...profileFields } = input;
      const update =
        websiteUrl === undefined
          ? profileFields
          : { ...profileFields, websiteUrl: websiteUrl === '' ? null : websiteUrl };
      return await this.identities.updateProfile(userId, update);
    } catch (error) {
      if (error instanceof IdentityConflictError) {
        throw new ConflictException('Username is already in use');
      }
      throw error;
    }
  }
}
