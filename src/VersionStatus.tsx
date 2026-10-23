import { CheckCircleIcon, WarningCircleIcon } from '@phosphor-icons/react';
import type { SongVersion } from '../server/song-library-types';
import { availabilityText } from './api';
import { availabilityLabel } from './song-management';

export function VersionStatus({ version }: { version: SongVersion }) {
  return <span className={'version-status version-status-' + version.availability.state} title={'code' in version.availability ? availabilityText(version.availability.code) : undefined}>
    {version.availability.state === 'available' ? <CheckCircleIcon size={14}/> : version.availability.state !== 'unknown' ? <WarningCircleIcon size={14}/> : null}{availabilityLabel(version)}
  </span>;
}
