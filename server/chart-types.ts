export type ChartSource = 'netease' | 'qq' | 'bilibili' | 'apple';
export type ChartKind = 'hot' | 'new' | 'rising' | 'most-played';
export type ChartUpdateFrequency = 'daily' | 'weekly';
export interface ChartItem { rank: number; title: string; artists?: string[]; artwork?: string }
export interface ChartPeriod { id: number; number: number; publishedAt: number }
export interface MusicChart {
  source: ChartSource;
  chart: ChartKind;
  title: string;
  items: ChartItem[];
  fetchedAt: number;
  /** Reuse this response without a request until this time. */
  refreshAfter?: number;
  updateFrequency?: ChartUpdateFrequency;
  updatedAt?: number;
  sourceUrl: string;
  period?: ChartPeriod;
  periods?: ChartPeriod[];
  /** A source failure retained the last successfully read chart. */
  issue?: string;
}
