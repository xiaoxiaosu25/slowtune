export type DisabledDisplay = 'show' | 'dim' | 'hide';
export interface SourceSettings { revision: string; youtube: { enabled: boolean; disabledDisplay: DisabledDisplay } }
export interface YoutubeStatus { enabled: boolean; available: boolean; checking: boolean; toolVersion?: string; issue?: string }
export interface SourceSettingsState extends SourceSettings { sequence?:number; youtube: SourceSettings['youtube'] & YoutubeStatus }
