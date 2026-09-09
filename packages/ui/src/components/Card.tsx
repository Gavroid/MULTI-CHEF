// Card — content container. Two visual variants: flat (default) and
'use client';

// elevated (with shadow-card). Used for recipe cards, list rows, sections.

import React from 'react';
import { cn } from '../cn';

export type CardVariant = 'default' | 'elevated';
export type CardElement = 'div' | 'article' | 'section' | 'li';

export interface CardProps extends React.HTMLAttributes<HTMLElement> {
  variant?: CardVariant;
  as?: CardElement;
}

const variantClasses: Record<CardVariant, string> = {
  default:
    'bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-lg)]',
  elevated: 'bg-[var(--color-surface)] rounded-[var(--radius-lg)] shadow-[var(--shadow-card)]',
};

export function Card({
  variant = 'default',
  as: Tag = 'div',
  className,
  children,
  ...rest
}: CardProps): React.ReactElement {
  return React.createElement(
    Tag,
    {
      className: cn('p-4 text-[var(--color-text)]', variantClasses[variant], className),
      ...rest,
    },
    children,
  );
}
