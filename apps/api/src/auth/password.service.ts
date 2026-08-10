import { Injectable } from '@nestjs/common';
import { Algorithm, hash, verify, Version } from '@node-rs/argon2';

const options = {
  algorithm: Algorithm.Argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
  outputLen: 32,
  version: Version.V0x13,
};

// Keeps unknown-email login work on the same expensive path without storing a real credential.
const dummyPasswordHash = hash('not-the-user-password', options);

@Injectable()
export class PasswordService {
  hash(password: string): Promise<string> {
    return hash(password, options);
  }

  verify(passwordHash: string, password: string): Promise<boolean> {
    return verify(passwordHash, password, options);
  }

  verifyDummy(password: string): Promise<boolean> {
    return dummyPasswordHash.then((passwordHash) => this.verify(passwordHash, password));
  }
}
