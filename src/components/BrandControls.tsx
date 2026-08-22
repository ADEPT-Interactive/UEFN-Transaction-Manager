import React from 'react';
import discordIconUrl from '../../electron/assets/discord-icon.svg';

export const DISCORD_CONTROL_SIZE = 48;
export const DISCORD_ICON_SIZE = 30;

export const DiscordIcon: React.FC<{ className?: string; style?: React.CSSProperties }> = ({ className, style }) => (
  <img src={discordIconUrl} alt="" className={className} style={style} aria-hidden="true" />
);
