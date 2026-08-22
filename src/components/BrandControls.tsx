import React from 'react';

/** The same mark is used by the launcher and the manager header. */
export const DISCORD_ICON_PATH = 'M19.5 5.3A18 18 0 0 0 15.2 4l-.5 1.1a16.4 16.4 0 0 0-5.4 0L8.7 4a17.7 17.7 0 0 0-4.3 1.3C1.7 9.3 1 13.2 1.4 17a17.5 17.5 0 0 0 5.3 2.7L8 18a11 11 0 0 1-1.7-.8l.4-.3a12.7 12.7 0 0 0 10.6 0l.4.3c-.5.3-1.1.6-1.7.8l1.3 1.7a17.4 17.4 0 0 0 5.3-2.7c.5-4.4-.8-8.3-3.1-11.7ZM8.3 14.7c-1 0-1.9-1-1.9-2.2 0-1.2.8-2.2 1.9-2.2 1 0 1.9 1 1.9 2.2s-.9 2.2-1.9 2.2Zm7.4 0c-1 0-1.9-1-1.9-2.2 0-1.2.8-2.2 1.9-2.2 1 0 1.9 1 1.9 2.2s-.8 2.2-1.9 2.2Z';

export const DiscordIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true" focusable="false">
    <path d={DISCORD_ICON_PATH} />
  </svg>
);
