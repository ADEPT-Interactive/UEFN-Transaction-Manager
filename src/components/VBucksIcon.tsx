import React from 'react';

export const VBucksIcon: React.FC<{ className?: string; title?: string }> = ({ className = 'h-4 w-4', title }) => (
  <span
    role={title ? 'img' : undefined}
    aria-label={title}
    aria-hidden={title ? undefined : 'true'}
    className={`inline-block shrink-0 bg-current ${className}`}
    style={{
      WebkitMaskImage: 'url(/vbucks-icon.png)',
      maskImage: 'url(/vbucks-icon.png)',
      WebkitMaskPosition: 'center',
      maskPosition: 'center',
      WebkitMaskRepeat: 'no-repeat',
      maskRepeat: 'no-repeat',
      WebkitMaskSize: 'contain',
      maskSize: 'contain',
    }}
  />
);
