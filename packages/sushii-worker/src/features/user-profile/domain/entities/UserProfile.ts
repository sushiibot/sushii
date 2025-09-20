export interface UserProfileData {
  id: string;
  rep: bigint;
  fishies: bigint;
  isPatron: boolean;
  lastFishies: Date | null;
  lastRep: Date | null;
  lastfmUsername: string | null;
  patronEmoji: string | null;
  profileData: Record<string, unknown>;
}

export class UserProfile {
  private constructor(private readonly data: UserProfileData) {}

  static create(data: UserProfileData): UserProfile {
    return new UserProfile(data);
  }

  static createDefault(id: string): UserProfile {
    return new UserProfile({
      id,
      rep: BigInt(0),
      fishies: BigInt(0),
      isPatron: false,
      lastFishies: null,
      lastRep: null,
      lastfmUsername: null,
      patronEmoji: null,
      profileData: {},
    });
  }

  getId(): string {
    return this.data.id;
  }

  getRep(): bigint {
    return this.data.rep;
  }

  getFishies(): bigint {
    return this.data.fishies;
  }

  getIsPatron(): boolean {
    return this.data.isPatron;
  }

  getLastFishies(): Date | null {
    return this.data.lastFishies;
  }

  getLastRep(): Date | null {
    return this.data.lastRep;
  }

  getLastfmUsername(): string | null {
    return this.data.lastfmUsername;
  }

  getPatronEmoji(): string | null {
    return this.data.patronEmoji;
  }

  getProfileData(): Record<string, unknown> {
    return this.data.profileData;
  }

  updateRep(newRep: bigint): UserProfile {
    return new UserProfile({
      ...this.data,
      rep: newRep,
    });
  }

  updateFishies(newFishies: bigint): UserProfile {
    return new UserProfile({
      ...this.data,
      fishies: newFishies,
    });
  }

  updateLastFishiesTimestamp(): UserProfile {
    return new UserProfile({
      ...this.data,
      lastFishies: new Date(),
    });
  }

  updateLastRepTimestamp(): UserProfile {
    return new UserProfile({
      ...this.data,
      lastRep: new Date(),
    });
  }

  updatePatronStatus(
    isPatron: boolean,
    patronEmoji?: string | null,
  ): UserProfile {
    return new UserProfile({
      ...this.data,
      isPatron,
      patronEmoji: patronEmoji ?? this.data.patronEmoji,
    });
  }

  updateLastfmUsername(username: string | null): UserProfile {
    return new UserProfile({
      ...this.data,
      lastfmUsername: username,
    });
  }

  updateProfileData(profileData: Record<string, unknown>): UserProfile {
    return new UserProfile({
      ...this.data,
      profileData,
    });
  }

  toData(): UserProfileData {
    return { ...this.data };
  }
}
