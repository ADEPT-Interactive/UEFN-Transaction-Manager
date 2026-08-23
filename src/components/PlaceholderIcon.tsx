import React from 'react';
import { PLACEHOLDER_ICON_DATA_URL } from '../constants/placeholderIcon';

export const PlaceholderIcon: React.FC<{ className?: string; alt?: string }> = ({ className = '', alt = 'UTM placeholder icon' }) => (
  <img src={PLACEHOLDER_ICON_DATA_URL} alt={alt} className={`object-contain ${className}`} />
);
