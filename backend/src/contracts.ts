export interface Directory { id: string; path: string; addedAt: string }
export interface AudioVariant { quality:string; format:string; size?:number; sizeText?:string; bitrate?:number }
export interface Track { id: string; directoryId: string; title: string; artist: string; album: string; duration: number; format: string; size: number; modified: number; addedAt?: number; hasCover: boolean; hasLyrics: boolean; available: boolean; online?:boolean; fileLocation?:string; platform?:string; qualities?:string[]; audioVariants?:AudioVariant[] }
export interface ScanStatus { running: boolean; scanned: number; failed: number; errors: string[]; startedAt?: string; finishedAt?: string }
export interface LibraryState { directories: Directory[]; tracks: Track[]; scan: ScanStatus; favorites: string[]; history: string[]; onlineTracks?:Track[] }

export interface AlbumSearchResult { id: string; platform: 'local' | 'wy' | 'tx' | 'kw' | 'kg' | 'mg'; name: string; artist: string; image?: string; coverTrackId?: string }
