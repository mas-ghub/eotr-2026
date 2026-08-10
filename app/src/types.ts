export type ActType = 'music' | 'comedy' | 'literature' | 'cinema' | 'dj' | 'other';

export interface Day {
  key: string;
  label: string;
  short: string;
}

export interface Act {
  id: string;
  name: string;
  dayKey: string;
  stage: string;
  startMs: number;
  endMs: number;
  start: string;
  end: string;
  mbid: string | null;
  short: string | null;
  artistSlug: string | null;
  type: ActType;
  placeholder: boolean;
}

export interface PreviewTrack {
  track: string;
  album: string;
  url: string;
  local: string | null;
  artwork: string | null;
  durationMs: number | null;
}

export interface SocialLink {
  label: string;
  url: string;
}

export interface ArtistSet {
  dayKey: string;
  stage: string;
  start: string;
  end: string;
}

export interface Artist {
  slug: string;
  name: string;
  type: ActType;
  image: string | null;
  bio: string;
  links: SocialLink[];
  spotifyId: string | null;
  previews: PreviewTrack[];
  artwork: string | null;
  sets: ArtistSet[];
  isFilm?: boolean;
}

export interface FestivalMeta {
  festival: string;
  year: number;
  venue: string;
  dates: string;
  clashfinderUrl: string;
  officialSite: string;
  generatedAt: string;
  days: Day[];
  stages: string[];
  stats: {
    acts: number;
    artists: number;
    artistsWithPreviews: number;
    matchedArtists: number;
    unmatchedActs: number;
  };
}
