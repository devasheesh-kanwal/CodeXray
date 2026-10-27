import React from 'react';
import { Link } from 'react-router-dom';

export interface LogoProps {
  /** Size variant (image height): sm = 34px (landing nav, sidebar), md = 42px, lg = 64px (loader / 404) */
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

/** Logo image height per size; the width follows the image's own proportions. */
const sizeHeights: Record<'sm' | 'md' | 'lg', number> = {
  sm: 34,
  md: 42,
  lg: 64,
};

/** The CodeXray wordmark: "Code" in white, the red spider as the X, "ray" in red. */
const LOGO_SRC = '/assets/codexray-logo.png';

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

  // Single source of truth for the logo: one image, sized by height.
  const classes = `inline-flex items-center leading-none select-none ${className}`;
  const inlineStyles: React.CSSProperties = { lineHeight: 1, ...style };
  const image = (
    <img
      src={LOGO_SRC}
      alt="CodeXray"
      draggable={false}
      style={{ height: sizeHeights[size], width: 'auto', display: 'block' }}
    />
  );

  if (target) {
    const isInternalRoute = target.startsWith('/') && !target.startsWith('//');
    if (isInternalRoute && !onClick) {
      return (
        <Link
          to={target}
          className={`${classes} hover:opacity-90 transition-opacity`}
          style={inlineStyles}
        >
          {image}
        </Link>
      );
    }

    return (
      <a
        href={target}
        onClick={onClick}
        className={`${classes} hover:opacity-90 transition-opacity`}
        style={inlineStyles}
      >
        {image}
      </a>
    );
  }

  return (
    <Component className={classes} style={inlineStyles}>
      {image}
    </Component>
  );
}
