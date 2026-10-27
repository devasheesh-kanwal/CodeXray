import React from 'react';
import { Link } from 'react-router-dom';

export interface LogoProps {
  /** Size variant: sm = 22px (landing nav), md = 28px (sidebar header), lg = 36px (loader / 404) */
  size?: 'sm' | 'md' | 'lg';
  /** Optional link destination (can be route like "/" or hash like "#home") */
  href?: string;
  link?: string;
  to?: string;
  onClick?: (e: React.MouseEvent<HTMLAnchorElement>) => void;
  className?: string;
  style?: React.CSSProperties;
  as?: 'span' | 'h1' | 'h2' | 'div' | 'a';
}

const sizeClasses: Record<'sm' | 'md' | 'lg', string> = {
  sm: 'text-[22px]',
  md: 'text-[28px]',
  lg: 'text-[36px]',
};

export default function Logo({
  size = 'md',
  href,
  link,
  to,
  onClick,
  className = '',
  style,
  as: Component = 'span',
}: LogoProps) {
  const target = href ?? link ?? to;

  // Single source of truth for the logo typography:
  // - font: display serif via token (var(--font-display) -> Bodoni Moda, Georgia, Times New Roman, serif)
  // - weight: 500-600 (medium, not heavy)
  // - line-height: 1
  // - letter-spacing: 0.01em (0 to 0.01em)
  // - color: var(--text) mint (#CFF1E6)
  // - normal casing: "CodeXray"
  const classes = `font-display font-medium leading-none tracking-[0.01em] select-none ${sizeClasses[size]} ${className}`;
  const inlineStyles: React.CSSProperties = {
    color: 'var(--text, #CFF1E6)',
    lineHeight: 1,
    letterSpacing: '0.01em',
    fontWeight: 500,
    ...style,
  };

  if (target) {
    const isInternalRoute = target.startsWith('/') && !target.startsWith('//');
    if (isInternalRoute && !onClick) {
      return (
        <Link
          to={target}
          className={`${classes} inline-flex items-center hover:opacity-90 transition-opacity`}
          style={inlineStyles}
        >
          CodeXray
        </Link>
      );
    }

    return (
      <a
        href={target}
        onClick={onClick}
        className={`${classes} inline-flex items-center hover:opacity-90 transition-opacity`}
        style={inlineStyles}
      >
        CodeXray
      </a>
    );
  }

  return (
    <Component className={classes} style={inlineStyles}>
      CodeXray
    </Component>
  );
}
